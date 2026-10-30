import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { env, HttpError } from './http.ts';

/** Chaves novas do Supabase chegam como JSON ({"default": "sb_..."}). */
function fromKeySet(name: string): string | undefined {
  const raw = env(name);
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

const URL = env('SUPABASE_URL')!;
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY') ?? fromKeySet('SUPABASE_SECRET_KEYS');
const ANON = env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY') ?? fromKeySet('SUPABASE_PUBLISHABLE_KEYS');

/** Cliente administrativo (ignora RLS). Use só depois de checar permissões. */
export function adminClient(): SupabaseClient {
  if (!URL || !SERVICE) throw new HttpError(500, 'Função sem acesso ao banco (SUPABASE_SERVICE_ROLE_KEY ausente).');
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Cliente com a identidade da pessoa: o banco aplica as regras de acesso (RLS) dela. */
export function userClient(token: string): SupabaseClient {
  if (!URL || !ANON) throw new HttpError(500, 'Função sem SUPABASE_ANON_KEY.');
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Confere o token da sessão e devolve o usuário. */
export async function requireUser(req: Request): Promise<{ user: User; token: string }> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Faça login para continuar.');
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida ou expirada. Entre novamente.');
  return { user: data.user, token };
}

/** Chamadas internas (função chamando função / agendamentos). */
export function isInternal(req: Request): boolean {
  const secret = env('NEXUS_INTERNAL_SECRET');
  const got = req.headers.get('x-nexus-internal');
  if (!secret || !got || got.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new HttpError(500, `Falha em ${fn}: ${error.message}`);
  return data as T;
}
