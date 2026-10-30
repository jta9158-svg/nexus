// Cliente mínimo da API de Mensagens da Anthropic (Claude) — oficial, via HTTPS.
// Docs: https://platform.claude.com/docs
import { env, HttpError } from './http.ts';

export const API_URL = env('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com';
export const API_VERSION = '2023-06-01';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface MessageRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
}

export interface MessageResponse {
  id: string;
  model: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'pause_turn' | 'refusal' | string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

// Preços em US$ por milhão de tokens (entrada, saída) — conferir em platform.claude.com/docs/en/about-claude/pricing
const PRICES: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export function estimateCost(model: string, input: number, output: number): number {
  let [pin, pout] = PRICES[model] ?? [4, 20];
  if (model === 'claude-haiku-5-5' && input > 100_000) [pin, pout] = [0.5, 2.5];
  return (input * pin + output * pout) / 1_000_000;
}

export function apiKey(): string {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) {
    throw new HttpError(503, 'A NEXUS IA ainda não foi configurada no servidor: falta o segredo ANTHROPIC_API_KEY (veja docs/CONFIGURACAO.md).');
  }
  return key;
}

function friendly(status: number, body: string): string {
  let type = '';
  let message = '';
  try {
    const j = JSON.parse(body);
    type = j?.error?.type ?? '';
    message = j?.error?.message ?? '';
  } catch {
    // corpo não-JSON
  }
  if (status === 401 || type === 'authentication_error') return 'A chave da API da Anthropic é inválida ou foi revogada.';
  if (status === 403 || type === 'permission_error') return 'A chave da API da Anthropic não tem permissão para este modelo.';
  if (status === 429 || type === 'rate_limit_error') return 'Limite de uso da API da Anthropic atingido. Tente de novo em instantes.';
  if (status === 529 || type === 'overloaded_error') return 'A NEXUS IA está sobrecarregada agora. Tente de novo em alguns segundos.';
  if (/credit balance/i.test(message)) {
    return 'A conta da API do Claude está sem créditos. O administrador do NEXUS precisa vincular os créditos do plano Max (claude.ai → Configurações → Cobrança → créditos da API) ou adicionar créditos no Console da Anthropic.';
  }
  if (status === 413) return 'O pedido ficou grande demais (anexos ou histórico). Tente com menos arquivos.';
  return `A API da Anthropic recusou o pedido (${status}${message ? `: ${message}` : ''}).`;
}

function headers(): Record<string, string> {
  return {
    'x-api-key': apiKey(),
    'anthropic-version': API_VERSION,
    'content-type': 'application/json',
  };
}

export async function createMessage(req: MessageRequest, signal?: AbortSignal): Promise<MessageResponse> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${API_URL}/v1/messages`, { method: 'POST', headers: headers(), body: JSON.stringify(req), signal });
    if (res.status !== 529 && res.status !== 429 && res.status < 500) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  const text = await res!.text();
  if (!res!.ok) throw new HttpError(502, friendly(res!.status, text));
  return JSON.parse(text) as MessageResponse;
}

export interface StreamResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  model: string;
}

/** Faz o pedido com stream=true e chama onText a cada pedaço de texto. */
export async function streamMessage(
  req: MessageRequest,
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(`${API_URL}/v1/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...req, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new HttpError(502, friendly(res.status, await res.text()));

  const result: StreamResult = { text: '', inputTokens: 0, outputTokens: 0, stopReason: null, model: req.model };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'message_start':
          result.inputTokens = ev.message?.usage?.input_tokens ?? 0;
          result.outputTokens = ev.message?.usage?.output_tokens ?? 0;
          result.model = ev.message?.model ?? req.model;
          break;
        case 'content_block_delta':
          if (ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
            result.text += ev.delta.text;
            onText(ev.delta.text);
          }
          break;
        case 'message_delta':
          if (ev.usage?.output_tokens != null) result.outputTokens = ev.usage.output_tokens;
          if (ev.usage?.input_tokens != null) result.inputTokens = ev.usage.input_tokens;
          result.stopReason = ev.delta?.stop_reason ?? result.stopReason;
          break;
        case 'error':
          throw new HttpError(502, friendly(ev.error?.type === 'overloaded_error' ? 529 : 500, JSON.stringify(ev)));
        default:
          break;
      }
    }
  }
  return result;
}

export function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
