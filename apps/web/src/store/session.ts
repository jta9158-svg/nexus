import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { sb } from '../lib/supabase';
import type { AppSettings, Profile } from '../types/db';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'recovery';

interface SessionState {
  status: Status;
  session: Session | null;
  userId: string | null;
  email: string | null;
  me: Profile | null;
  isAdmin: boolean;
  appSettings: AppSettings | null;
  profileError: string | null;
  init: () => Promise<void>;
  loadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  setMe: (p: Profile) => void;
  finishRecovery: () => void;
}

let initialized = false;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  session: null,
  userId: null,
  email: null,
  me: null,
  isAdmin: false,
  appSettings: null,
  profileError: null,

  init: async () => {
    if (initialized) return;
    initialized = true;
    const client = sb();
    const isRecoveryLink = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        set({ status: 'recovery', session, userId: session?.user.id ?? null, email: session?.user.email ?? null });
        return;
      }
      if (event === 'SIGNED_OUT' || !session) {
        set({ status: 'signedOut', session: null, userId: null, email: null, me: null, isAdmin: false });
        return;
      }
      const changedUser = get().userId !== session.user.id;
      set({ session, userId: session.user.id, email: session.user.email ?? null });
      if (get().status !== 'recovery' && (changedUser || get().status !== 'signedIn')) {
        set({ status: 'signedIn' });
        void get().loadProfile();
      }
    });

    const { data } = await client.auth.getSession();
    if (data.session) {
      set({
        session: data.session,
        userId: data.session.user.id,
        email: data.session.user.email ?? null,
        status: isRecoveryLink ? 'recovery' : 'signedIn',
      });
      if (!isRecoveryLink) await get().loadProfile();
    } else if (get().status === 'loading') {
      set({ status: 'signedOut' });
    }
  },

  loadProfile: async () => {
    const uid = get().userId;
    if (!uid) return;
    const client = sb();
    const [profile, admin, settings] = await Promise.all([
      client.from('profiles').select('*').eq('id', uid).maybeSingle(),
      client.rpc('is_app_admin'),
      client.from('app_settings').select('*').maybeSingle(),
    ]);
    if (profile.error || !profile.data) {
      set({ profileError: profile.error?.message || 'Perfil não encontrado. As migrações do banco foram aplicadas?' });
      return;
    }
    set({
      me: profile.data as Profile,
      isAdmin: admin.data === true,
      appSettings: (settings.data as AppSettings) ?? null,
      profileError: null,
    });
  },

  signOut: async () => {
    await sb().auth.signOut();
    set({ status: 'signedOut', session: null, userId: null, email: null, me: null, isAdmin: false });
  },

  setMe: (p) => set({ me: p }),

  finishRecovery: () => {
    history.replaceState(null, '', location.pathname + location.search.replace(/type=recovery&?/, ''));
    set({ status: get().session ? 'signedIn' : 'signedOut' });
    if (get().session) void get().loadProfile();
  },
}));

/**
 * O Claude aparece no app para esta pessoa? Com "Claude só para mim" ligado
 * (padrão), só o administrador do NEXUS vê o Claude AI, o Companion, o
 * @Claude e o botão de chamar o Claude na call. O servidor também bloqueia.
 */
/**
 * Chave geral da NEXUS IA no app. Desligada: a IA some de todos os aparelhos e de
 * todas as pessoas, inclusive do administrador (chat, Companion, @NEXUS, IA na
 * call, configurações). Para religar, troque para true e publique uma versão.
 */
export const NEXUS_IA_ATIVA = false;

export function useClaudeVisible(): boolean {
  const visible = useSession((s) => s.isAdmin || !(s.appSettings?.claude_admin_only ?? true));
  return NEXUS_IA_ATIVA && visible;
}
