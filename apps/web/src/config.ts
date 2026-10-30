// Configuração do servidor NEXUS (Supabase).
// Em builds publicados as variáveis VITE_* vêm do processo de build (CI).
// Sem elas, o app mostra a tela de configuração para o dono informar o
// endereço do próprio backend (fica salvo só neste aparelho).

export interface NexusConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicSiteUrl?: string;
  githubRepo?: string;
  source: 'build' | 'local';
}

const LOCAL_KEY = 'nexus.serverConfig.v1';

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || '0.1.0';

function decodeJwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Valida endereço e chave pública. Recusa chaves secretas/administrativas. */
export function validateServerConfig(url: string, key: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return 'Endereço inválido. Exemplo: https://abcdefgh.supabase.co';
  }
  const local = ['localhost', '127.0.0.1', '10.0.2.2'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    return 'Use um endereço https://';
  }
  const k = key.trim();
  if (!k) return 'Informe a chave pública (anon / publishable).';
  if (k.startsWith('sb_secret_') || decodeJwtRole(k) === 'service_role') {
    return 'Esta é uma chave SECRETA de administrador. Nunca coloque essa chave no app — use a chave pública (anon ou publishable).';
  }
  if (!k.startsWith('sb_publishable_') && decodeJwtRole(k) !== 'anon') {
    return 'Chave não reconhecida. Copie a chave "anon" ou "publishable" em Project Settings → API do Supabase.';
  }
  return null;
}

export function getConfig(): NexusConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const common = {
    publicSiteUrl: (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined) || undefined,
    githubRepo: (import.meta.env.VITE_GITHUB_REPO as string | undefined) || undefined,
  };
  if (url && key) {
    return { supabaseUrl: url.replace(/\/+$/, ''), supabaseAnonKey: key, source: 'build', ...common };
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { supabaseUrl?: string; supabaseAnonKey?: string };
      if (c.supabaseUrl && c.supabaseAnonKey && !validateServerConfig(c.supabaseUrl, c.supabaseAnonKey)) {
        return { supabaseUrl: c.supabaseUrl.replace(/\/+$/, ''), supabaseAnonKey: c.supabaseAnonKey, source: 'local', ...common };
      }
    }
  } catch {
    // armazenamento indisponível (modo privado etc.)
  }
  return null;
}

export function saveLocalConfig(url: string, key: string): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ supabaseUrl: url.trim().replace(/\/+$/, ''), supabaseAnonKey: key.trim() }));
}

export function clearLocalConfig(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    // ignore
  }
}

/** Endereço público do app web (usado em links de convite e recuperação de senha). */
export function publicAppUrl(cfg: NexusConfig | null): string {
  if (cfg?.publicSiteUrl) return cfg.publicSiteUrl.replace(/\/+$/, '') + '/app/';
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    return location.origin + location.pathname.replace(/[^/]*$/, '');
  }
  return '';
}
