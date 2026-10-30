// Amigos (como no Discord): adicionar pelo nick, aceitar, desfazer e bloquear.
import { create } from 'zustand';
import { sb } from '../lib/supabase';
import { useApp } from './app';
import { useSession } from './session';
import type { FriendRequestResult, Friendship } from '../types/db';

interface FriendsState {
  loaded: boolean;
  rows: Friendship[];
  blocked: string[];
  load: () => Promise<void>;
  send: (username: string) => Promise<FriendRequestResult>;
  respond: (id: string, accept: boolean) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
}

export const useFriends = create<FriendsState>((set, get) => ({
  loaded: false,
  rows: [],
  blocked: [],

  load: async () => {
    const [f, b] = await Promise.all([
      sb().from('friendships').select('*').order('created_at', { ascending: false }),
      sb().from('user_blocks').select('blocked'),
    ]);
    const rows = (f.data ?? []) as Friendship[];
    const blocked = ((b.data ?? []) as Array<{ blocked: string }>).map((x) => x.blocked);
    set({ rows, blocked, loaded: true });
    await useApp.getState().ensureProfiles([...rows.flatMap((r) => [r.requester, r.addressee]), ...blocked]);
  },

  send: async (username) => {
    const { data, error } = await sb().rpc('send_friend_request', { p_username: username });
    if (error) throw error;
    await get().load();
    return data as FriendRequestResult;
  },

  respond: async (id, accept) => {
    const { error } = await sb().rpc('respond_friend_request', { p_request: id, p_accept: accept });
    if (error) throw error;
    await get().load();
  },

  remove: async (userId) => {
    const { error } = await sb().rpc('remove_friend', { p_user: userId });
    if (error) throw error;
    await get().load();
  },

  block: async (userId) => {
    const { error } = await sb().rpc('block_user', { p_user: userId });
    if (error) throw error;
    await get().load();
  },

  unblock: async (userId) => {
    const { error } = await sb().rpc('unblock_user', { p_user: userId });
    if (error) throw error;
    await get().load();
  },
}));

/** A outra pessoa da amizade. */
export function otherOf(f: Friendship): string {
  const me = useSession.getState().userId;
  return f.requester === me ? f.addressee : f.requester;
}

/** Situação com uma pessoa: amigos, pedido enviado, pedido recebido, bloqueada ou nada. */
export function relationWith(rows: Friendship[], blocked: string[], me: string | null, userId: string) {
  if (blocked.includes(userId)) return { kind: 'bloqueado' as const };
  const f = rows.find((r) => (r.requester === me && r.addressee === userId) || (r.addressee === me && r.requester === userId));
  if (!f) return { kind: 'nada' as const };
  if (f.status === 'aceita') return { kind: 'amigos' as const, f };
  return f.requester === me ? { kind: 'enviado' as const, f } : { kind: 'recebido' as const, f };
}
