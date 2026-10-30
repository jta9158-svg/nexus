import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import { buildMessages, cleanSpoken, isAddressed, isSilence, livekitHttpUrl, shouldConsider, voiceSystemPrompt } from '../_shared/voice.ts';
import { jwtVerify } from 'npm:jose@6';
import { livekitAdminToken } from '../_shared/voice.ts';

Deno.test('reconhece quando chamam o Claude pelo nome', () => {
  assert(isAddressed('Claude, qual é o status do ALPHA?'));
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
