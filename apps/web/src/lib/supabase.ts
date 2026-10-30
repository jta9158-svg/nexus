import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NexusConfig } from '../config';

let client: SupabaseClient | null = null;
let config: NexusConfig | null = null;

export function initSupabase(cfg: NexusConfig): SupabaseClient {
  config = cfg;
  client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storageKey: 'nexus.auth.v1',
    },
    realtime: {
      params: { eventsPerSecond: 20 },
    },
    global: {
      headers: { 'x-nexus-client': 'nexus-app' },
    },
  });
  return client;
}

export function sb(): SupabaseClient {
  if (!client) throw new Error('O servidor do NEXUS ainda não foi configurado.');
  return client;
}

export function currentConfig(): NexusConfig | null {
  return config;
}

export function functionUrl(name: string): string {
  if (!config) throw new Error('O servidor do NEXUS ainda não foi configurado.');
  return `${config.supabaseUrl}/functions/v1/${name}`;
}

/** Chama uma Edge Function com o token da sessão. */
export async function callFunction<T>(name: string, body: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
  let res: Response;
  try {
    res = await fetch(functionUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: config!.supabaseAnonKey,
      },
      body: JSON.stringify(body ?? {}),
      signal: init?.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('Não foi possível falar com o servidor. Verifique sua conexão.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      (json as { error?: string; message?: string } | null)?.error ||
      (json as { message?: string } | null)?.message ||
      (res.status === 404
        ? `A função "${name}" ainda não foi publicada no servidor.`
        : `O servidor respondeu com erro ${res.status}.`);
    throw new Error(msg);
  }
  return json as T;
}

/** Faz uma chamada com resposta em fluxo (SSE) para uma Edge Function. */
export async function streamFunction(
  name: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { data } = await sb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
  let res: Response;
  try {
    res = await fetch(functionUrl(name), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        apikey: config!.supabaseAnonKey,
      },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error('Não foi possível falar com o servidor. Verifique sua conexão.');
  }
  if (!res.ok || !res.body) {
    let msg = `O servidor respondeu com erro ${res.status}.`;
    try {
      const j = await res.json();
      msg = j.error || j.message || msg;
    } catch {
      if (res.status === 404) msg = `A função "${name}" ainda não foi publicada no servidor.`;
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          // linha inválida: ignora
        }
      }
    }
  }
}
