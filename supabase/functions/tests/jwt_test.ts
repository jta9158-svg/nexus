// Confere se o token das calls é um JWT HS256 válido no formato do LiveKit.
import { assertEquals } from 'jsr:@std/assert@1';
import { jwtVerify } from 'npm:jose@6';
import { signJwt } from '../_shared/jwt.ts';

Deno.test('token do LiveKit assina e valida (HS256)', async () => {
  const secret = 'segredo-de-teste-com-tamanho-suficiente-123';
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(
    { iss: 'APIkey', sub: 'user-1', name: 'José', nbf: now - 10, exp: now + 60, video: { room: 'nexus-abc', roomJoin: true, canPublishSources: ['microphone'] } },
    secret,
  );
  const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(secret));
  assertEquals(protectedHeader.alg, 'HS256');
  assertEquals(payload.sub, 'user-1');
  assertEquals(payload.name, 'José');
  assertEquals((payload.video as { room: string }).room, 'nexus-abc');
});
