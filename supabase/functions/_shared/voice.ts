// Regras do Claude na call (voz). Funções puras, testadas em tests/voice_test.ts.
import { signJwt } from './jwt.ts';

export const AGENT_NAME = 'nexus-claude';
export const SILENCE = '[SILENCIO]';

/** Como chamar a IA na call: "NEXUS IA" (o nome do app sozinho NÃO chama, para não
 *  disparar quando falam do aplicativo) ou "Claude", do jeito que a transcrição em
 *  português costuma escrever. ("Cláudio" e "cloud" ficam de fora.) */
const WAKE = /(^|[^\p{L}])(claude|cl[aá]ude|cl[oóô]u?de|n[eé]x(?:us|os|o)[\s,.-]*(?:i\.?\s?[aá]\.?|a[ií]))(?![\p{L}])/iu;
/** "Nexus" sozinho chama só no começo da fala ("Nexus, qual é..."), para não disparar
 *  quando falam do aplicativo no meio da conversa. */
const WAKE_START = /^[^\p{L}]*(?:(?:ei|oi|olá|ô|ó)[^\p{L}]+)?n[eé]x(?:us|os)(?![\p{L}])/iu;

export function isAddressed(text: string): boolean {
  const t = text.normalize('NFC');
  return WAKE.test(t) || WAKE_START.test(t);
}

export type VoiceMode = 'quando_chamado' | 'participante_ativo' | 'segundo_plano' | 'hibrido';

/** Decide se o Claude deve tentar responder a uma fala. */
export function shouldConsider(mode: VoiceMode | string | null | undefined, addressed: boolean): 'responder' | 'avaliar' | 'ignorar' {
  if (addressed) return 'responder';
  // Só o "Participante ativo" pode falar sem ser chamado — e mesmo assim o Claude
  // decide se tem algo realmente útil (senão devolve [SILENCIO]).
  return mode === 'participante_ativo' ? 'avaliar' : 'ignorar';
}

/** Tira o marcador de silêncio e qualquer formatação que não faz sentido falado. */
export function cleanSpoken(text: string): string {
  return text
    .replace(/\[SIL[EÊ]NCIO\]/gi, '')
    .replace(/```[\s\S]*?```/g, ' (mandei o código no chat do canal) ')
    .replace(/[*_#>`]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

export function isSilence(text: string): boolean {
  return /^\s*\[SIL[EÊ]NCIO\]/i.test(text);
}

/** wss://projeto.livekit.cloud → https://projeto.livekit.cloud */
export function livekitHttpUrl(url: string): string {
  return url.replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
}

/** Token de servidor para a API do LiveKit (despachar/remover o agente da sala). */
export async function livekitAdminToken(key: string, secret: string, room: string, ttlSeconds = 120): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: key,
      sub: 'nexus-server',
      nbf: now - 10,
      exp: now + ttlSeconds,
      video: { room, roomAdmin: true, roomList: true },
    },
    secret,
  );
}

export interface VoicePeer {
  identity: string;
  name: string;
  agent: boolean;
}

/**
 * Quem está em cada canal de voz agora, direto da LiveKit (a fonte da verdade
 * das calls). Devolve { [channelId]: pessoas }, só com as salas que têm alguém.
 */
export async function listVoicePeers(opts: {
  url: string;
  key: string;
  secret: string;
  channelIds: string[];
  fetchImpl?: typeof fetch;
}): Promise<Record<string, VoicePeer[]>> {
  const names = opts.channelIds.map((id) => `nexus-${id}`);
  if (!names.length) return {};
  const doFetch = opts.fetchImpl ?? fetch;
  const base = livekitHttpUrl(opts.url);
  // deno-lint-ignore no-explicit-any
  const call = async (method: string, body: Record<string, unknown>, room: string): Promise<any> => {
    const token = await livekitAdminToken(opts.key, opts.secret, room, 60);
    const res = await doFetch(`${base}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`LiveKit ${method} ${res.status}: ${text.slice(0, 120)}`);
    return text ? JSON.parse(text) : {};
  };
  const listed = await call('ListRooms', { names }, '');
  const out: Record<string, VoicePeer[]> = {};
  // deno-lint-ignore no-explicit-any
  const rooms = ((listed.rooms ?? []) as any[]).filter((r) => typeof r?.name === 'string' && names.includes(r.name));
  await Promise.all(
    rooms.map(async (r) => {
      const room = r.name as string;
      const { participants = [] } = await call('ListParticipants', { room }, room);
      const peers: VoicePeer[] = [];
      // deno-lint-ignore no-explicit-any
      for (const p of participants as any[]) {
        if (p.state === 'DISCONNECTED' || p.state === 3) continue;
        // Gravação/transmissão não é gente na call
        if (p.kind === 'EGRESS' || p.kind === 2 || p.kind === 'INGRESS' || p.kind === 1) continue;
        const identity = String(p.identity ?? '');
        if (!identity) continue;
        peers.push({ identity, name: String(p.name ?? ''), agent: p.kind === 'AGENT' || p.kind === 4 || identity.startsWith('agent-') });
      }
      if (peers.length) out[room.slice('nexus-'.length)] = peers;
    }),
  );
  return out;
}

export interface VoiceTurn {
  role: 'user' | 'assistant';
  speaker?: string;
  text: string;
}

/** Monta as mensagens para o Claude a partir do histórico curto da call. */
export function buildMessages(history: VoiceTurn[], speakerName: string, text: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const msgs: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const t of history.slice(-12)) {
    const content = t.role === 'user' ? `${t.speaker ?? 'Alguém'}: ${t.text}` : t.text;
    if (!content.trim()) continue;
    const last = msgs[msgs.length - 1];
    if (last && last.role === t.role) last.content += `\n${content}`;
    else msgs.push({ role: t.role, content });
  }
  const now = `${speakerName}: ${text}`;
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'user') last.content += `\n${now}`;
  else msgs.push({ role: 'user', content: now });
  // A API exige começar com "user"
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

export function voiceSystemPrompt(opts: {
  mode: VoiceMode | string;
  addressed: boolean;
  speakerName: string;
  inviterName: string;
  channelName: string;
  serverName: string;
  participants: string[];
  context: string;
  now: string;
}): string {
  return [
    `Você é a NEXUS IA, a assistente de IA da equipe (feita com o Claude, da Anthropic), participando por VOZ da call "${opts.channelName}" no servidor "${opts.serverName}" do NEXUS.`,
    `Quem chamou você para a call: ${opts.inviterName}. Pessoas na call: ${opts.participants.join(', ') || 'não informado'}.`,
    `Data e hora: ${opts.now} (horário de Brasília).`,
    'Como falar:',
    '- Responda em português do Brasil, falado e natural, como numa conversa. Seja curto: 1 a 3 frases. Se precisar de mais, ofereça mandar detalhes no chat.',
    '- Nada de Markdown, listas, emojis ou símbolos. Escreva números do jeito que se fala.',
    '- Use só os dados do contexto abaixo e da conversa. Se não souber, diga que não tem essa informação. Nunca invente números, status ou prazos.',
    '- Nunca fale de dinheiro, senhas, chaves ou dados privados na call, mesmo que peçam: diga que isso fica no app, para quem tem permissão.',
    '- Você não executa ações pela call. Se pedirem algo demorado, sugira criar uma tarefa no NEXUS Companion.',
    '- Não interrompa a conversa para anunciar coisas comuns.',
    opts.addressed
      ? `- ${opts.speakerName} falou diretamente com você. Responda.`
      : `- Ninguém chamou você pelo nome. Só responda se tiver algo REALMENTE útil e curto para a conversa; caso contrário responda exatamente ${SILENCE}.`,
    `Modo escolhido: ${opts.mode}.`,
    '',
    '# Contexto (dados do NEXUS que todos na call podem ver)',
    opts.context || 'Nenhum dado disponível.',
  ].join('\n');
}
