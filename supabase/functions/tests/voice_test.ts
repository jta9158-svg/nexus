import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import { buildMessages, cleanSpoken, isAddressed, isSilence, livekitHttpUrl, shouldConsider, voiceSystemPrompt } from '../_shared/voice.ts';
import { jwtVerify } from 'npm:jose@6';
import { livekitAdminToken, listVoicePeers } from '../_shared/voice.ts';

Deno.test('reconhece quando chamam a IA pelo nome (NEXUS IA ou Claude)', () => {
  assert(isAddressed('Claude, qual é o status do ALPHA?'));
  assert(isAddressed('Nexus IA, qual é o status do ALPHA?'));
  assert(isAddressed('nexus i.a. me ajuda aqui'));
  assert(isAddressed('Néxus, IA, tá aí?'));
  assert(!isAddressed('abre o NEXUS no celular'), 'falar do app não chama a IA');
  assert(!isAddressed('vou mandar no nexus'));
  assert(isAddressed('Nexus, qual é o status do ALPHA?'), 'Nexus no começo da fala chama');
  assert(isAddressed('Ei, Nexus, me ajuda'));
  assert(isAddressed('nexus aí, tá ouvindo?'));
  assert(!isAddressed('Nexusfan entrou no servidor'));
  assert(isAddressed('ô Cláude, me ajuda'));
  assert(isAddressed('e aí clóde'));
  assertFalse(isAddressed('o Cláudio vai fazer o mapa'));
  assertFalse(isAddressed('salvei tudo na cloud'));
  assertFalse(isAddressed('vamos testar a skill de raio'));
});

Deno.test('modos: só o participante ativo avalia falas sem ser chamado (Teste B)', () => {
  assertEquals(shouldConsider('quando_chamado', false), 'ignorar');
  assertEquals(shouldConsider('hibrido', false), 'ignorar');
  assertEquals(shouldConsider('segundo_plano', false), 'ignorar');
  assertEquals(shouldConsider('participante_ativo', false), 'avaliar');
  for (const m of ['quando_chamado', 'hibrido', 'segundo_plano', 'participante_ativo']) assertEquals(shouldConsider(m, true), 'responder');
});

Deno.test('silêncio e limpeza do texto falado', () => {
  assert(isSilence('[SILENCIO]'));
  assert(isSilence('  [SILÊNCIO] nada'));
  assertFalse(isSilence('Oi, tudo certo'));
  assertEquals(cleanSpoken('**Pronto!** O mapa está # em revisão'), 'Pronto! O mapa está  em revisão');
  assertStringIncludes(cleanSpoken('Use isto: ```lua\nprint(1)\n```'), 'mandei o código no chat');
});

Deno.test('histórico vira mensagens alternadas começando pelo usuário', () => {
  const msgs = buildMessages(
    [
      { role: 'assistant', text: 'Oi!' },
      { role: 'user', speaker: 'Matheus', text: 'bora' },
      { role: 'user', speaker: 'Marina', text: 'beleza' },
      { role: 'assistant', text: 'Certo.' },
    ],
    'José',
    'Claude, e o ALPHA?',
  );
  assertEquals(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assertStringIncludes(msgs[0].content, 'Matheus: bora');
  assertStringIncludes(msgs[0].content, 'Marina: beleza');
  assertStringIncludes(msgs[2].content, 'José: Claude, e o ALPHA?');
});

Deno.test('prompt de voz proíbe finanças e manda ficar quieto quando não chamado', () => {
  const p = voiceSystemPrompt({ mode: 'participante_ativo', addressed: false, speakerName: 'A', inviterName: 'B', channelName: 'Geral', serverName: 'ALPHA', participants: ['A', 'B'], context: 'x', now: 'agora' });
  assertStringIncludes(p, '[SILENCIO]');
  assertStringIncludes(p, 'Nunca fale de dinheiro');
});

Deno.test('URL e token de servidor da LiveKit', async () => {
  assertEquals(livekitHttpUrl('wss://nexus-abc.livekit.cloud/'), 'https://nexus-abc.livekit.cloud');
  const token = await livekitAdminToken('APIkey', 'segredo-de-teste-com-32-caracteres!!', 'nexus-123');
  const { payload } = await jwtVerify(token, new TextEncoder().encode('segredo-de-teste-com-32-caracteres!!'));
  assertEquals(payload.iss, 'APIkey');
  assertEquals((payload.video as Record<string, unknown>).roomAdmin, true);
  assertEquals((payload.video as Record<string, unknown>).room, 'nexus-123');
});

Deno.test('quem está em cada canal de voz vem da LiveKit (sem gravação, com a IA marcada)', async () => {
  const secret = 'segredo-de-teste-com-32-caracteres!!';
  const calls: Array<{ method: string; body: Record<string, unknown>; room: unknown }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = url.split('/').pop()!;
    const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ method, body, room: (payload.video as Record<string, unknown>).room });
    if (!url.startsWith('https://nexus-abc.livekit.cloud/twirp/livekit.RoomService/')) return new Response('url errada', { status: 404 });
    if (method === 'ListRooms') {
      // A LiveKit pode devolver salas fora do pedido: só as do servidor contam
      return Response.json({ rooms: [{ name: 'nexus-c1', num_participants: 3 }, { name: 'nexus-c2' }, { name: 'nexus-outro' }] });
    }
    if (method === 'ListParticipants' && body.room === 'nexus-c1') {
      return Response.json({
        participants: [
          { identity: 'u1', name: 'Mari', state: 'ACTIVE', kind: 'STANDARD' },
          { identity: 'agent-AJ_x', name: 'NEXUS IA', state: 'ACTIVE', kind: 'AGENT' },
          { identity: 'EG_rec', name: '', state: 'ACTIVE', kind: 'EGRESS' },
          { identity: 'u2', name: 'Zé', state: 'DISCONNECTED', kind: 'STANDARD' },
          { identity: 'u3', name: 'Ana', state: 2, kind: 0 },
        ],
      });
    }
    return Response.json({ participants: [] });
  }) as typeof fetch;
  const out = await listVoicePeers({ url: 'wss://nexus-abc.livekit.cloud', key: 'APIkey', secret, channelIds: ['c1', 'c2', 'c3'], fetchImpl: fakeFetch });
  assertEquals(out, {
    c1: [
      { identity: 'u1', name: 'Mari', agent: false },
      { identity: 'agent-AJ_x', name: 'NEXUS IA', agent: true },
      { identity: 'u3', name: 'Ana', agent: false },
    ],
  });
  assertEquals(calls[0].method, 'ListRooms');
  assertEquals(calls[0].body.names, ['nexus-c1', 'nexus-c2', 'nexus-c3']);
  // Cada sala é consultada com um token só daquela sala; a sala de fora nem é consultada
  assertEquals(calls.filter((c) => c.method === 'ListParticipants').map((c) => [c.body.room, c.room]).sort(), [['nexus-c1', 'nexus-c1'], ['nexus-c2', 'nexus-c2']]);
  assertEquals(await listVoicePeers({ url: 'wss://x', key: 'k', secret, channelIds: [], fetchImpl: fakeFetch }), {});
});
