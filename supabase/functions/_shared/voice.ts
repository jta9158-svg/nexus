// Regras do Claude na call (voz). Funções puras, testadas em tests/voice_test.ts.
import { signJwt } from './jwt.ts';

export const AGENT_NAME = 'nexus-claude';
export const SILENCE = '[SILENCIO]';

/** Como chamar a IA na call: "NEXUS IA" (o nome do app sozinho NÃO chama, para não
 *  disparar quando falam do aplicativo) ou "Claude", do jeito que a transcrição em
 *  português costuma escrever. ("Cláudio" e "cloud" ficam de fora.) */
const WAKE = /(^|[^\p{L}])(claude|cl[aá]ude|cl[oóô]u?de|n[eé]x(?:us|os|o)[\s,.-]*i\.?\s?[aá]\.?)(?![\p{L}])/iu;

export function isAddressed(text: string): boolean {
  return WAKE.test(text.normalize('NFC'));
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
