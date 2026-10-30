// NEXUS — Chat com o Claude (conversas pessoais), com resposta em tempo real (SSE).
// POST { conversation_id, message, attachments?: [{ name, type, kind: 'image'|'pdf'|'text', data }] }
import { corsHeaders, fail, handleError, HttpError, preflight, readJson } from '../_shared/http.ts';
import { adminClient, requireUser, rpc, userClient } from '../_shared/supabase.ts';
import { apiKey, estimateCost, streamMessage, type ChatMessage, type ContentBlock } from '../_shared/anthropic.ts';
import { baseSystemPrompt, projectContext } from '../_shared/context.ts';

interface Body {
  conversation_id: string;
  message?: string;
  attachments?: Array<{ name: string; type: string; kind: 'image' | 'pdf' | 'text'; data: string }>;
}

interface Quota {
  allowed: boolean;
  reason: string | null;
}

const MAX_HISTORY = 40;
const MAX_ATTACH_BYTES = 18 * 1024 * 1024;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const { user, token } = await requireUser(req);
    const body = await readJson<Body>(req);
    const text = (body.message ?? '').trim();
    const attachments = (body.attachments ?? []).slice(0, 8);
    if (!body.conversation_id) throw new HttpError(400, 'Conversa não informada.');
    if (!text && !attachments.length) throw new HttpError(400, 'Mensagem vazia.');
    const totalBytes = attachments.reduce((s, a) => s + (a.data?.length ?? 0), 0);
    if (totalBytes > MAX_ATTACH_BYTES) throw new HttpError(413, 'Anexos grandes demais (máx. ~13 MB no total).');

    const admin = adminClient();
    const { data: conv } = await admin.from('ai_conversations').select('*').eq('id', body.conversation_id).maybeSingle();
    if (!conv || conv.owner_id !== user.id) throw new HttpError(404, 'Conversa não encontrada.');

    const quota = (await rpc<Quota[]>(admin, '_claude_quota', { p_user: user.id }))[0];
    if (!quota?.allowed) throw new HttpError(403, quota?.reason ?? 'Claude indisponível para você.');
    apiKey(); // falha cedo se a chave não estiver configurada

    const [{ data: profile }, { data: settings }, { data: history }] = await Promise.all([
      admin.from('profiles').select('display_name, username').eq('id', user.id).single(),
      admin.from('app_settings').select('claude_model').single(),
      admin
        .from('ai_messages')
        .select('role, content, attachments, status')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY),
    ]);
    const model: string = settings?.claude_model ?? 'claude-sonnet-5-5';

    // Contexto do projeto (consultado com a identidade da pessoa).
    let context = '';
    if (conv.project_id) {
      try {
        context = await projectContext(userClient(token), conv.project_id);
      } catch (err) {
        console.error('contexto do projeto falhou', err);
      }
    }
    const system = baseSystemPrompt(profile ?? { display_name: 'Pessoa', username: 'usuario' }, context ? `\n# Contexto atual\n${context}` : '');

    // Histórico (anexos antigos viram uma nota, para economizar tokens).
    const messages: ChatMessage[] = [];
    for (const m of (history ?? []).reverse()) {
      if (m.status === 'error' || (!m.content && m.role === 'assistant')) continue;
      const notes = Array.isArray(m.attachments) && m.attachments.length ? `\n[anexos enviados antes: ${m.attachments.map((a: { name: string }) => a.name).join(', ')}]` : '';
      const content = `${m.content ?? ''}${notes}`.trim() || '(sem texto)';
      const last = messages[messages.length - 1];
      if (last && last.role === m.role && typeof last.content === 'string') last.content += `\n\n${content}`;
      else messages.push({ role: m.role, content });
    }
    while (messages.length && messages[0].role !== 'user') messages.shift();

    const blocks: ContentBlock[] = [];
    for (const a of attachments) {
      if (a.kind === 'image' && /^image\/(png|jpeg|webp|gif)$/.test(a.type)) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } });
      } else if (a.kind === 'pdf') {
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name });
      } else if (a.kind === 'text') {
        blocks.push({ type: 'text', text: `Arquivo "${a.name}":\n\`\`\`\n${a.data.slice(0, 300_000)}\n\`\`\`` });
      }
    }
    blocks.push({ type: 'text', text: text || 'Analise os anexos.' });
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      // Junta com a última mensagem do usuário (ex.: resposta anterior falhou).
      const prev = typeof last.content === 'string' ? [{ type: 'text', text: last.content } as ContentBlock] : last.content;
      last.content = [...prev, ...blocks];
    } else {
      messages.push({ role: 'user', content: blocks });
    }

    // Registra a pergunta e uma resposta "em andamento".
    const meta = attachments.map((a) => ({ name: a.name, type: a.type, size: Math.round((a.data.length * 3) / 4) }));
    await admin.from('ai_messages').insert({ conversation_id: conv.id, role: 'user', content: text, attachments: meta });
    const { data: answer } = await admin
      .from('ai_messages')
      .insert({ conversation_id: conv.id, role: 'assistant', content: '', status: 'streaming', model })
      .select('id')
      .single();

    const encoder = new TextEncoder();
    const upstream = new AbortController();
    req.signal?.addEventListener('abort', () => upstream.abort());

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          } catch {
            // cliente saiu
          }
        };
        send({ type: 'start', message_id: answer?.id });
        let partial = '';
        try {
          const result = await streamMessage({ model, max_tokens: 8192, system, messages }, (chunk) => {
            partial += chunk;
            send({ type: 'delta', text: chunk });
          }, upstream.signal);
          const cost = estimateCost(result.model, result.inputTokens, result.outputTokens);
          await admin
            .from('ai_messages')
            .update({
              content: result.text,
              status: 'done',
              model: result.model,
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
            })
            .eq('id', answer!.id);
          await admin.rpc('_record_ai_usage', { p_user: user.id, p_input: result.inputTokens, p_output: result.outputTokens, p_cost: cost });
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), model: result.model };
          if (conv.title === 'Nova conversa' && text) {
            patch.title = text.slice(0, 60);
            send({ type: 'title', title: patch.title });
          }
          await admin.from('ai_conversations').update(patch).eq('id', conv.id);
          if (result.stopReason === 'max_tokens') send({ type: 'notice', message: 'A resposta foi cortada pelo limite de tamanho.' });
          send({ type: 'done', usage: { input: result.inputTokens, output: result.outputTokens } });
        } catch (err) {
          const aborted = upstream.signal.aborted;
          const message = err instanceof HttpError ? err.message : aborted ? 'Interrompido' : 'Falha ao falar com o Claude.';
          await admin
            .from('ai_messages')
            .update({ content: partial, status: aborted ? 'cancelled' : 'error', error: aborted ? null : message })
            .eq('id', answer!.id);
          if (!aborted) send({ type: 'error', message });
        } finally {
          try {
            controller.close();
          } catch {
            // já fechado
          }
        }
      },
      cancel() {
        upstream.abort();
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (err) {
    return handleError(err);
  }
});

void fail;
