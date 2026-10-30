// Testa o cliente da API da Anthropic contra um servidor local que imita o
// formato oficial (SSE de streaming e resposta com tool_use).
// Uso: deno test --allow-net --allow-env supabase/functions/tests/anthropic_test.ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

const PORT = 18765;
Deno.env.set('ANTHROPIC_BASE_URL', `http://127.0.0.1:${PORT}`);
Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-teste');

const { streamMessage, createMessage, estimateCost, textOf } = await import('../_shared/anthropic.ts');

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

let mode: 'stream' | 'tool' | 'error' = 'stream';
const server = Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  const body = await req.json();
  if (req.headers.get('x-api-key') !== 'sk-ant-teste' || req.headers.get('anthropic-version') !== '2023-06-01') {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad' } }), { status: 401 });
  }
  if (mode === 'error') {
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }), { status: 400 });
  }
  if (mode === 'tool') {
    return Response.json({
      id: 'msg_1',
      model: body.model,
      content: [
        { type: 'text', text: 'Vou ler o arquivo.' },
        { type: 'tool_use', id: 'toolu_1', name: 'ler_arquivo', input: { arquivo_id: 'abc' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 120, output_tokens: 30 },
    });
  }
  // Streaming: os pedaços chegam quebrados em pontos arbitrários.
  const payload = sse([
    { type: 'message_start', message: { id: 'msg_x', type: 'message', role: 'assistant', content: [], model: body.model, stop_reason: null, usage: { input_tokens: 25, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'ping' },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá, ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'equipe do ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ALPHA!' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 15 } },
    { type: 'message_stop' },
  ]);
  const bytes = new TextEncoder().encode(payload);
  const stream = new ReadableStream({
    async start(c) {
      for (let i = 0; i < bytes.length; i += 37) {
        c.enqueue(bytes.slice(i, i + 37));
        await new Promise((r) => setTimeout(r, 1));
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
});

Deno.test('streaming junta o texto e lê o uso de tokens', async () => {
  mode = 'stream';
  const chunks: string[] = [];
  const r = await streamMessage({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'oi' }] }, (c) => chunks.push(c));
  assertEquals(r.text, 'Olá, equipe do ALPHA!');
  assertEquals(chunks.length, 3);
  assertEquals(r.inputTokens, 25);
  assertEquals(r.outputTokens, 15);
  assertEquals(r.stopReason, 'end_turn');
});

Deno.test('resposta com tool_use', async () => {
  mode = 'tool';
  const r = await createMessage({ model: 'claude-opus-5-5', max_tokens: 100, messages: [{ role: 'user', content: 'leia' }] });
  assertEquals(r.stop_reason, 'tool_use');
  assertEquals(textOf(r.content), 'Vou ler o arquivo.');
  const call = r.content.find((b) => b.type === 'tool_use');
  assertEquals(call && call.type === 'tool_use' ? call.name : '', 'ler_arquivo');
});

Deno.test('erro de crédito vira mensagem clara em português', async () => {
  mode = 'error';
  await assertRejects(
    () => createMessage({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    Error,
    'créditos',
  );
});

Deno.test('estimativa de custo usa a tabela oficial', () => {
  assertEquals(estimateCost('claude-sonnet-5-5', 1_000_000, 0), 2);
  assertEquals(estimateCost('claude-sonnet-5-5', 0, 1_000_000), 10);
  assertEquals(estimateCost('claude-haiku-5-5', 50_000, 0), 0.005);
  assertEquals(Math.round(estimateCost('claude-haiku-5-5', 200_000, 0) * 1000) / 1000, 0.1);
});

Deno.test({
  name: 'encerra o servidor de teste',
  fn: async () => {
    await server.shutdown();
  },
});
