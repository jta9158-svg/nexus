// NEXUS — Token de acesso às calls (LiveKit / WebRTC).
// POST { channel_id }  → { url, token, room }
// Confere no banco se a pessoa pode entrar no canal de voz e o que pode publicar
// (microfone, câmera, tela) conforme os cargos dela.
import { env, handleError, HttpError, json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, requireUser, rpc } from '../_shared/supabase.ts';
import { signJwt } from '../_shared/jwt.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const { user } = await requireUser(req);
    const { channel_id } = await readJson<{ channel_id: string }>(req);
    const url = env('LIVEKIT_URL');
    const key = env('LIVEKIT_API_KEY');
    const secret = env('LIVEKIT_API_SECRET');
    if (!url || !key || !secret) {
      throw new HttpError(503, 'As calls ainda não foram configuradas no servidor (faltam LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET — veja docs/CONFIGURACAO.md).');
    }
    if (!channel_id) throw new HttpError(400, 'Canal não informado.');

    const admin = adminClient();
    const canJoin = await rpc<boolean>(admin, '_can_join_voice', { p_channel: channel_id, p_user: user.id });
    if (!canJoin) throw new HttpError(403, 'Você não tem permissão para entrar nesta call.');
    const { data: channel } = await admin.from('channels').select('id, server_id, name').eq('id', channel_id).single();
    const perms = await rpc<string[]>(admin, '_user_permissions', { p_server: channel!.server_id, p_user: user.id });
    const has = (p: string) => perms.includes('admin') || perms.includes(p);
    const { data: profile } = await admin.from('profiles').select('display_name').eq('id', user.id).single();

    const sources: string[] = [];
    if (has('speak')) sources.push('microphone');
    if (has('video')) sources.push('camera');
    if (has('share_screen')) sources.push('screen_share', 'screen_share_audio');

    const room = `nexus-${channel_id}`;
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        iss: key,
        sub: user.id,
        name: profile?.display_name ?? 'Participante',
        nbf: now - 10,
        exp: now + 6 * 3600,
        metadata: JSON.stringify({ server_id: channel!.server_id, channel_id }),
        video: {
          room,
          roomJoin: true,
          canSubscribe: true,
          canPublish: sources.length > 0,
          canPublishData: true,
          canPublishSources: sources,
          canUpdateOwnMetadata: false,
        },
      },
      secret,
    );
    return json({ url, token, room });
  } catch (err) {
    return handleError(err);
  }
});
