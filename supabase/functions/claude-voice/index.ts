// NEXUS — Claude na call (voz em tempo real).
// POST { action: 'invite', channel_id }  → chama o Claude para a call (pessoa logada)
// POST { action: 'remove', channel_id }  → tira o Claude da call (quem chamou ou quem pode mover membros)
// POST { action: 'reply', ... }          → (agente de voz, com x-nexus-internal) devolve a fala do Claude em texto, em stream
// POST { action: 'event', ... }          → (agente de voz) entrou / saiu / erro
//
// O agente de voz roda na LiveKit Cloud (apps/voice-agent) e só entra numa sala
// quando esta função despacha ele. A chave da Anthropic fica só aqui no servidor.
import { env, handleError, HttpError, json, preflight, readJson, runInBackground } from '../_shared/http.ts';
import { adminClient, isInternal, requireUser, rpc } from '../_shared/supabase.ts';
import { apiKey, estimateCost, streamMessage } from '../_shared/anthropic.ts';
import { nowBrasilia } from '../_shared/context.ts';
import {
  AGENT_NAME,
  buildMessages,
  cleanSpoken,
  isAddressed,
  isSilence,
  livekitAdminToken,
  livekitHttpUrl,
  shouldConsider,
  voiceSystemPrompt,
  type VoiceTurn,
} from '../_shared/voice.ts';

type Admin = ReturnType<typeof adminClient>;

const roomFor = (channelId: string) => `nexus-${channelId}`;

function lkEnv() {
  const url = env('LIVEKIT_URL');
  const key = env('LIVEKIT_API_KEY');
  const secret = env('LIVEKIT_API_SECRET');
  if (!url || !key || !secret) throw new HttpError(503, 'As calls ainda não foram configuradas no servidor (faltam os segredos da LiveKit).');
  return { url, key, secret };
}

async function twirp(service: string, method: string, body: Record<string, unknown>, room: string) {
  const { url, key, secret } = lkEnv();
  const token = await livekitAdminToken(key, secret, room);
  const res = await fetch(`${livekitHttpUrl(url)}/twirp/livekit.${service}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, `A LiveKit recusou o pedido (${res.status}). ${text.slice(0, 160)}`);
  return text ? (JSON.parse(text) as Record<string, any>) : {};
}

async function log(admin: Admin, owner: string | null, level: string, event: string, message: string, details: Record<string, unknown> = {}) {
  if (!owner) return;
  await admin.rpc('_companion_log', { p_owner: owner, p_task: null, p_level: level, p_event: event, p_message: message, p_details: details });
}

async function activeSession(admin: Admin, channelId: string) {
  const { data } = await admin
    .from('voice_sessions')
    .select('*')
    .eq('channel_id', channelId)
    .in('status', ['chamando', 'na_call'])
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------- convite
async function invite(req: Request, channelId: string) {
  const { user } = await requireUser(req);
  const admin = adminClient();
  const reason = await rpc<string | null>(admin, '_voice_invite_check', { p_channel: channelId, p_user: user.id });
  if (reason) throw new HttpError(403, reason);
  const quota = (await rpc<Array<{ allowed: boolean; reason: string | null }>>(admin, '_claude_quota', { p_user: user.id }))[0];
  if (!quota?.allowed) throw new HttpError(403, quota?.reason ?? 'Sem cota do Claude.');
  lkEnv();
  apiKey();

  const existing = await activeSession(admin, channelId);
  if (existing) return json({ status: 'ja_na_call', session_id: existing.id });

  const { data: channel } = await admin.from('channels').select('id, server_id, name').eq('id', channelId).single();
  const { data: settings } = await admin
    .from('companion_settings')
    .select('mode, voice_option, voice_speed, voice_greeting')
    .eq('user_id', user.id)
    .maybeSingle();
  const room = roomFor(channelId);
  const { data: session, error } = await admin
    .from('voice_sessions')
    .insert({ server_id: channel!.server_id, channel_id: channelId, room, inviter_id: user.id })
    .select('id')
    .single();
  if (error) {
    const again = await activeSession(admin, channelId);
    if (again) return json({ status: 'ja_na_call', session_id: again.id });
    throw new HttpError(500, 'Não foi possível registrar a sessão de voz.');
  }

  try {
    const dispatch = await twirp(
      'AgentDispatchService',
      'CreateDispatch',
      {
        agent_name: AGENT_NAME,
        room,
        metadata: JSON.stringify({
          session_id: session.id,
          server_id: channel!.server_id,
          channel_id: channelId,
          inviter_id: user.id,
          mode: settings?.mode ?? 'hibrido',
          voice: settings?.voice_option ?? 'voz1',
          speed: settings?.voice_speed ?? 'normal',
          greeting: settings?.voice_greeting ?? true,
        }),
      },
      room,
    );
    await admin.from('voice_sessions').update({ dispatch_id: dispatch.id ?? dispatch.dispatch_id ?? null }).eq('id', session.id);
  } catch (err) {
    await admin
      .from('voice_sessions')
      .update({ status: 'falhou', ended_at: new Date().toISOString(), ended_reason: (err as Error).message.slice(0, 300) })
      .eq('id', session.id);
    throw err;
  }
  await log(admin, user.id, 'info', 'voice.invited', `Chamou o Claude para a call #${channel!.name}`, { channel_id: channelId, session_id: session.id });
  return json({ status: 'chamando', session_id: session.id });
}

// ---------------------------------------------------------------- remover
async function remove(req: Request, channelId: string) {
  const { user } = await requireUser(req);
  const admin = adminClient();
  const can = await rpc<boolean>(admin, '_voice_can_remove', { p_channel: channelId, p_user: user.id });
  if (!can) throw new HttpError(403, 'Só quem chamou o Claude (ou quem pode mover membros) pode tirá-lo da call.');
  const session = await activeSession(admin, channelId);
  if (!session) return json({ status: 'fora_da_call' });
  const room = session.room as string;
  try {
    const list = await twirp('RoomService', 'ListParticipants', { room }, room);
    for (const p of (list.participants ?? []) as Array<Record<string, any>>) {
      const isAgent = p.kind === 'AGENT' || p.kind === 4 || String(p.identity ?? '').startsWith('agent-');
      if (isAgent) await twirp('RoomService', 'RemoveParticipant', { room, identity: p.identity }, room).catch(() => undefined);
    }
    if (session.dispatch_id) await twirp('AgentDispatchService', 'DeleteDispatch', { dispatch_id: session.dispatch_id, room }, room).catch(() => undefined);
  } catch (err) {
    // A sala pode já ter acabado; segue encerrando a sessão.
    console.warn('[voice] remover', (err as Error).message);
  }
  await admin
    .from('voice_sessions')
    .update({ status: 'encerrada', ended_at: new Date().toISOString(), ended_reason: 'Removido da call' })
    .eq('id', session.id);
  await log(admin, session.inviter_id, 'info', 'voice.removed', 'Claude saiu da call (removido)', { session_id: session.id, by: user.id });
  return json({ status: 'removido' });
}

// ---------------------------------------------------------------- contexto falado
async function allHave(admin: Admin, serverId: string, users: string[], perm: string): Promise<boolean> {
  if (!users.length) return false;
  for (const id of users) {
    const ok = await rpc<boolean>(admin, '_has_server_perm', { p_server: serverId, p_user: id, p_perm: perm });
    if (!ok) return false;
  }
  return true;
}

const STATUS: Record<string, string> = {
  a_fazer: 'a fazer',
  em_andamento: 'em andamento',
  em_revisao: 'em revisão',
  concluida: 'concluída',
  cancelada: 'cancelada',
};

const TASK_STATE: Record<string, string> = {
  aguardando: 'aguardando',
  executando: 'executando',
  aguardando_confirmacao: 'esperando uma decisão',
  bloqueada: 'pausada',
  concluida: 'concluída',
  falhou: 'falhou',
  cancelada: 'cancelada',
};

async function voiceContext(admin: Admin, serverId: string, listeners: string[], inviterId: string | null): Promise<string> {
  const lines: string[] = [];
  if (await allHave(admin, serverId, listeners, 'view_projects')) {
    const { data: projects } = await admin
      .from('projects')
      .select('id, name, status, description, updated_at')
      .eq('server_id', serverId)
      .order('updated_at', { ascending: false })
      .limit(3);
    for (const p of projects ?? []) {
      const { data: tasks } = await admin
        .from('project_tasks')
        .select('title, status, priority, assignee_id, updated_at')
        .eq('project_id', p.id)
        .neq('status', 'cancelada')
        .order('updated_at', { ascending: false })
        .limit(60);
      const open = (tasks ?? []).filter((t) => t.status !== 'concluida');
      const done = (tasks ?? []).filter((t) => t.status === 'concluida');
      const ids = Array.from(new Set(open.map((t) => t.assignee_id).filter(Boolean))) as string[];
      const { data: people } = ids.length ? await admin.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
      const who = (id: string | null) => (id ? people?.find((x) => x.id === id)?.display_name ?? 'alguém' : 'sem responsável');
      lines.push(`Projeto ${p.name} (situação: ${p.status}). Fonte: quadro de tarefas do NEXUS.`);
      lines.push(`${open.length} tarefas abertas e ${done.length} concluídas.`);
      for (const t of open.slice(0, 8)) lines.push(`- ${t.title}: ${STATUS[t.status] ?? t.status}, prioridade ${t.priority}, com ${who(t.assignee_id)}`);
      for (const t of done.slice(0, 3)) lines.push(`- concluída recentemente: ${t.title}`);
    }
    if (!projects?.length) lines.push('Nenhum projeto cadastrado neste servidor.');
  } else {
    lines.push('Tarefas dos projetos: nem todos na call têm permissão para ver, então não comente.');
  }

  if (inviterId) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: work } = await admin
      .from('companion_tasks')
      .select('title, status, progress, progress_note, updated_at')
      .eq('owner_id', inviterId)
      .or(`status.in.(aguardando,executando,aguardando_confirmacao,bloqueada),updated_at.gte.${since}`)
      .order('updated_at', { ascending: false })
      .limit(5);
    if (work?.length) {
      lines.push('Tarefas do Claude Companion de quem chamou você (status ao vivo):');
      for (const w of work) lines.push(`- ${w.title}: ${TASK_STATE[w.status] ?? w.status}, ${w.progress}%${w.progress_note ? ` (${w.progress_note})` : ''}`);
    }
  }

  if (await allHave(admin, serverId, listeners, 'view_roblox')) {
    const { data: exps } = await admin.from('roblox_experiences').select('universe_id, name').eq('server_id', serverId).limit(3);
    for (const e of exps ?? []) {
      const { data: st } = await admin
        .from('roblox_stats')
        .select('playing, visits, favorites, source, fetched_at')
        .eq('universe_id', e.universe_id)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (st) {
        const mins = Math.max(0, Math.round((Date.now() - new Date(st.fetched_at).getTime()) / 60000));
        lines.push(`Roblox ${e.name ?? e.universe_id}: ${st.playing} jogando, ${st.visits} visitas, ${st.favorites} favoritos (fonte ${st.source}, coletado há ${mins} minutos).`);
      }
    }
  }
  lines.push('Receita, Robux e finanças: não fale disso na call.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- resposta falada
interface ReplyBody {
  session_id: string;
  speaker_id: string;
  text: string;
  history?: VoiceTurn[];
  listeners?: string[];
  addressed?: boolean;
}

function textStream(produce: (push: (s: string) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await produce((s) => controller.enqueue(encoder.encode(s)));
      } catch (err) {
        console.error('[voice] resposta', err);
        controller.enqueue(encoder.encode(' Desculpa, tive um problema para responder agora.'));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function reply(req: Request, body: ReplyBody) {
  if (!isInternal(req)) throw new HttpError(401, 'Somente o agente de voz do NEXUS.');
  const admin = adminClient();
  const { data: session } = await admin.from('voice_sessions').select('*').eq('id', body.session_id).maybeSingle();
  if (!session || !['chamando', 'na_call'].includes(session.status)) throw new HttpError(404, 'Sessão de voz encerrada.');
  const text = String(body.text ?? '').trim().slice(0, 2000);
  if (!text) return new Response('', { status: 200 });

  const { data: settings } = await admin.from('companion_settings').select('mode').eq('user_id', session.inviter_id).maybeSingle();
  const mode = settings?.mode ?? 'hibrido';
  const addressed = body.addressed ?? isAddressed(text);
  const decision = shouldConsider(mode, addressed);
  if (decision === 'ignorar') return new Response('', { status: 200 });

  const quota = (await rpc<Array<{ allowed: boolean; reason: string | null }>>(admin, '_claude_quota', { p_user: session.inviter_id }))[0];
  if (!quota?.allowed) {
    return new Response(addressed ? `Agora não consigo responder. ${quota?.reason ?? ''}` : '', { status: 200 });
  }
  try {
    apiKey();
  } catch {
    return new Response(addressed ? 'Ainda não consigo pensar aqui: falta configurar a chave da API do Claude no servidor do NEXUS.' : '', { status: 200 });
  }

  // Quem está na call (só membros do servidor contam como ouvintes)
  const listeners: string[] = [];
  for (const id of Array.from(new Set([...(body.listeners ?? []), body.speaker_id].filter(Boolean)))) {
    if (await rpc<boolean>(admin, '_is_server_member', { p_server: session.server_id, p_user: id })) listeners.push(id);
  }
  const ids = Array.from(new Set([...listeners, session.inviter_id].filter(Boolean)));
  const { data: people } = await admin.from('profiles').select('id, display_name').in('id', ids);
  const nameOf = (id: string | null) => people?.find((p) => p.id === id)?.display_name ?? 'Alguém';
  const [{ data: channel }, { data: server }, { data: app }] = await Promise.all([
    admin.from('channels').select('name').eq('id', session.channel_id).maybeSingle(),
    admin.from('servers').select('name').eq('id', session.server_id).maybeSingle(),
    admin.from('app_settings').select('claude_model').single(),
  ]);

  const context = await voiceContext(admin, session.server_id, listeners, session.inviter_id);
  const system = voiceSystemPrompt({
    mode,
    addressed,
    speakerName: nameOf(body.speaker_id),
    inviterName: nameOf(session.inviter_id),
    channelName: channel?.name ?? 'call',
    serverName: server?.name ?? 'NEXUS',
    participants: listeners.map(nameOf),
    context,
    now: nowBrasilia(),
  });
  const messages = buildMessages(body.history ?? [], nameOf(body.speaker_id), text);
  const model = app?.claude_model ?? 'claude-sonnet-5-5';

  return textStream(async (push) => {
    // Quando ninguém chamou o Claude, ele pode decidir ficar quieto ([SILENCIO]).
    // Seguramos o começo da resposta até saber se é silêncio.
    let state: 'avaliando' | 'falando' | 'silencio' = decision === 'responder' ? 'falando' : 'avaliando';
    let head = '';
    const result = await streamMessage({ model, max_tokens: 400, system, messages, temperature: 0.4 }, (chunk) => {
      if (state === 'silencio') return;
      if (state === 'avaliando') {
        head += chunk;
        const ready = head.trimStart().startsWith('[') ? head.trim().length >= 10 : /\s/.test(head.trim()) || head.length >= 10;
        if (!ready) return;
        if (isSilence(head)) {
          state = 'silencio';
          return;
        }
        state = 'falando';
        push(cleanSpoken(head));
        return;
      }
      push(chunk.replace(/[*_#>`]/g, ''));
    });
    if (state === 'avaliando') {
      if (head.trim() && !isSilence(head)) push(cleanSpoken(head));
      else state = 'silencio';
    }
    const cost = estimateCost(result.model, result.inputTokens, result.outputTokens);
    runInBackground(
      (async () => {
        await admin.rpc('_record_ai_usage', { p_user: session.inviter_id, p_input: result.inputTokens, p_output: result.outputTokens, p_cost: cost });
        if (state !== 'silencio') {
          await log(admin, session.inviter_id, 'info', 'voice.answered', `Respondeu ${nameOf(body.speaker_id)} na call`, { session_id: session.id });
        }
      })(),
    );
  });
}

// ---------------------------------------------------------------- eventos do agente
async function event(req: Request, body: { session_id: string; event: string; detail?: string }) {
  if (!isInternal(req)) throw new HttpError(401, 'Somente o agente de voz do NEXUS.');
  const admin = adminClient();
  const { data: session } = await admin.from('voice_sessions').select('*').eq('id', body.session_id).maybeSingle();
  if (!session) throw new HttpError(404, 'Sessão não encontrada.');
  const detail = String(body.detail ?? '').slice(0, 300);
  if (body.event === 'joined') {
    await admin.from('voice_sessions').update({ status: 'na_call' }).eq('id', session.id).in('status', ['chamando', 'na_call']);
    await log(admin, session.inviter_id, 'info', 'voice.joined', 'Claude entrou na call', { session_id: session.id });
  } else if (body.event === 'left' || body.event === 'error') {
    await admin
      .from('voice_sessions')
      .update({ status: body.event === 'error' ? 'falhou' : 'encerrada', ended_at: new Date().toISOString(), ended_reason: detail || null })
      .eq('id', session.id)
      .in('status', ['chamando', 'na_call']);
    await log(admin, session.inviter_id, body.event === 'error' ? 'erro' : 'info', body.event === 'error' ? 'voice.error' : 'voice.left', body.event === 'error' ? `Problema na voz: ${detail}` : 'Claude saiu da call', { session_id: session.id });
  } else if (body.event === 'state') {
    // estados como "pausado" ficam só na própria sala (atributos do participante)
  }
  return json({ ok: true });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    const body = await readJson<Record<string, any>>(req);
    switch (body.action) {
      case 'invite':
        if (!body.channel_id) throw new HttpError(400, 'Canal não informado.');
        return await invite(req, String(body.channel_id));
      case 'remove':
        if (!body.channel_id) throw new HttpError(400, 'Canal não informado.');
        return await remove(req, String(body.channel_id));
      case 'reply':
        return await reply(req, body as ReplyBody);
      case 'event':
        return await event(req, body as { session_id: string; event: string; detail?: string });
      default:
        throw new HttpError(400, 'Ação desconhecida.');
    }
  } catch (err) {
    return handleError(err);
  }
});
