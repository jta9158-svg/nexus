// Tempo real: mudanças no banco (mensagens, canais, membros...), presença
// online, quem está em cada call e "digitando".
import type { RealtimeChannel } from '@supabase/supabase-js';
import { sb } from './supabase';
import { emitTable } from './bus';
import { playPing, setAppBadge, showSystemNotification } from './notify';
import { platformLabel } from './platform';
import { useApp } from '../store/app';
import { useMessages } from '../store/messages';
import type { Channel, ChannelCategory, Member, MemberRole, Message, NotificationRow, PresenceState, Role, Server } from '../types/db';

type VoiceState = NonNullable<PresenceState['voice']>;

let me: string | null = null;
let userChannel: RealtimeChannel | null = null;
let dmChannel: RealtimeChannel | null = null;
let dmKey = '';
const serverDb = new Map<string, RealtimeChannel>();
const serverPresence = new Map<string, RealtimeChannel>();
let status: PresenceState['status'] = 'online';
let voice: { serverId: string; state: VoiceState } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let connectionListeners = new Set<(ok: boolean) => void>();
let connected = false;
let lastTyping = 0;
let unsubApp: (() => void) | null = null;

export function onConnectionChange(fn: (ok: boolean) => void): () => void {
  connectionListeners.add(fn);
  fn(connected);
  return () => connectionListeners.delete(fn);
}

function setConnected(ok: boolean) {
  if (connected === ok) return;
  connected = ok;
  connectionListeners.forEach((fn) => fn(ok));
}

function myState(serverId: string): PresenceState {
  return {
    user_id: me!,
    status,
    voice: voice && voice.serverId === serverId ? voice.state : null,
    device: platformLabel(),
    at: Date.now(),
  };
}

function isViewing(targetId: string): boolean {
  const v = useApp.getState().view;
  const open = (v.kind === 'channel' && v.channelId === targetId) || (v.kind === 'dm' && v.threadId === targetId);
  return open && document.visibilityState === 'visible' && document.hasFocus();
}

function updateBadge() {
  const st = useApp.getState();
  let total = 0;
  for (const info of Object.values(st.unread)) total += info.serverId ? info.mentions : info.unread;
  setAppBadge(total);
}

function onMessageInsert(raw: Record<string, unknown>) {
  const msg = raw as unknown as Message;
  useMessages.getState().applyInsert(msg);
  if (!me || msg.author_id === me) return;
  const app = useApp.getState();
  void app.ensureProfiles([msg.author_id]);
  const target = msg.channel_id ?? msg.dm_thread_id;
  if (!target) return;
  if (isViewing(target)) {
    app.markRead(target);
  } else {
    const mention = (msg.mentions ?? []).includes(me) || msg.mentions_everyone;
    app.bumpUnread(target, msg.server_id, mention);
    updateBadge();
  }
}

function onNotification(raw: Record<string, unknown>) {
  const n = raw as unknown as NotificationRow;
  const app = useApp.getState();
  app.addNotification(n);
  const target = n.link.channel_id ?? n.link.dm_thread_id;
  if (target && isViewing(target)) return;
  playPing(n.kind === 'mention' || n.kind === 'question' ? 'mention' : 'message');
  if (document.visibilityState !== 'visible' || !document.hasFocus()) {
    showSystemNotification(n.title, n.body ?? '', () => {
      if (n.link.dm_thread_id) app.openDm(n.link.dm_thread_id);
      else if (n.link.server_id && n.link.channel_id) app.openChannel(n.link.server_id, n.link.channel_id);
      else if (n.link.task_id) app.openView({ kind: 'companion' });
    });
  }
}

function subscribeServer(serverId: string) {
  if (!me) return;
  if (!serverDb.has(serverId)) {
    const ch = sb()
      .channel(`nx-db-${serverId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `server_id=eq.${serverId}` }, (p) =>
        onMessageInsert(p.new),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `server_id=eq.${serverId}` }, (p) =>
        useMessages.getState().applyUpdate(p.new as unknown as Message),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channels', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertChannel(p.new as unknown as Channel),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channels', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertChannel(p.new as unknown as Channel),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_categories', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertCategory(p.new as unknown as ChannelCategory),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channel_categories', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertCategory(p.new as unknown as ChannelCategory),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'roles', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertRole(p.new as unknown as Role),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'roles', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertRole(p.new as unknown as Role),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'server_members', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertMember(p.new as unknown as Member),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'server_members', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertMember(p.new as unknown as Member),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'member_roles', filter: `server_id=eq.${serverId}` }, (p) =>
        useApp.getState().addMemberRole(p.new as unknown as MemberRole),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servers', filter: `id=eq.${serverId}` }, (p) =>
        useApp.getState().upsertServer(p.new as unknown as Server),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tasks', filter: `server_id=eq.${serverId}` }, (p) =>
        emitTable('project_tasks', { eventType: p.eventType, new: p.new as Record<string, unknown>, old: p.old as Record<string, unknown> }),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'files', filter: `server_id=eq.${serverId}` }, (p) =>
        emitTable('files', { eventType: p.eventType, new: p.new as Record<string, unknown>, old: p.old as Record<string, unknown> }),
      )
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') setConnected(true);
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setConnected(false);
      });
    serverDb.set(serverId, ch);
  }

  if (!serverPresence.has(serverId)) {
    const ch = sb().channel(`server:${serverId}`, { config: { private: true, presence: { key: me } } });
    ch.on('presence', { event: 'sync' }, () => {
      const raw = ch.presenceState<PresenceState>();
      const map: Record<string, PresenceState> = {};
      for (const [key, metas] of Object.entries(raw)) {
        const latest = [...metas].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
        if (latest) map[key] = latest as unknown as PresenceState;
      }
      useApp.getState().setPresence(serverId, map);
    })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { target: string; user_id: string; active: boolean };
        if (p.user_id !== me) useApp.getState().setTyping(p.target, p.user_id, p.active);
      })
      .subscribe(async (s) => {
        if (s === 'SUBSCRIBED') {
          await ch.track(myState(serverId));
        }
      });
    serverPresence.set(serverId, ch);
  }
}

function unsubscribeServer(serverId: string) {
  const a = serverDb.get(serverId);
  if (a) void sb().removeChannel(a);
  serverDb.delete(serverId);
  const b = serverPresence.get(serverId);
  if (b) void sb().removeChannel(b);
  serverPresence.delete(serverId);
}

/** Mantém as inscrições alinhadas com a lista de servidores. */
export function syncServers(): void {
  const ids = new Set(useApp.getState().servers.map((s) => s.id));
  for (const id of ids) subscribeServer(id);
  for (const id of Array.from(serverDb.keys())) if (!ids.has(id)) unsubscribeServer(id);
}

/** Mantém a inscrição das mensagens privadas alinhada com as conversas. */
export function syncDms(): void {
  const ids = useApp
    .getState()
    .dms.map((d) => d.id)
    .slice(0, 100)
    .sort();
  const key = ids.join(',');
  if (key === dmKey) return;
  dmKey = key;
  if (dmChannel) void sb().removeChannel(dmChannel);
  dmChannel = null;
  if (!ids.length) return;
  dmChannel = sb()
    .channel(`nx-dm-${me}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `dm_thread_id=in.(${key})` }, (p) => {
      onMessageInsert(p.new);
      const msg = p.new as unknown as Message;
      // Reordena a lista de conversas (mais recente primeiro).
      const updated = useApp
        .getState()
        .dms.map((d) => (d.id === msg.dm_thread_id ? { ...d, hidden: false, last_message_at: msg.created_at } : d))
        .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
      useApp.setState({ dms: updated });
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `dm_thread_id=in.(${key})` }, (p) =>
      useMessages.getState().applyUpdate(p.new as unknown as Message),
    )
    .subscribe();
}

export function startRealtime(userId: string): void {
  if (me === userId && userChannel) return;
  stopRealtime();
  me = userId;
  const app = useApp.getState;

  userChannel = sb()
    .channel(`nx-user-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) =>
      onNotification(p.new),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) =>
      app().updateNotification(p.new as unknown as NotificationRow),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'server_members', filter: `user_id=eq.${userId}` }, () => {
      void app().reloadServers().then(syncServers);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'server_members' }, (p) => {
      const old = p.old as { server_id?: string; user_id?: string };
      if (!old.server_id || !old.user_id) return;
      if (old.user_id === userId) {
        app().removeServer(old.server_id);
        syncServers();
      } else {
        app().removeMember(old.server_id, old.user_id);
      }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_participants', filter: `user_id=eq.${userId}` }, () => {
      void app().reloadDms().then(syncDms);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) useMessages.getState().applyDelete(id);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channels' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) app().removeChannel(id);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channel_categories' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) app().removeCategory(id);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'roles' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) app().removeRole(id);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'member_roles' }, (p) => {
      const old = p.old as unknown as MemberRole;
      if (old.server_id && old.role_id) app().removeMemberRole(old);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'servers' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) {
        app().removeServer(id);
        syncServers();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'companion_tasks', filter: `owner_id=eq.${userId}` }, (p) =>
      emitTable('companion_tasks', { eventType: p.eventType, new: p.new as Record<string, unknown>, old: p.old as Record<string, unknown> }),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'companion_questions', filter: `owner_id=eq.${userId}` }, (p) =>
      emitTable('companion_questions', { eventType: p.eventType, new: p.new as Record<string, unknown>, old: p.old as Record<string, unknown> }),
    )
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') setConnected(true);
      if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setConnected(false);
    });

  syncServers();
  syncDms();
  unsubApp?.();
  unsubApp = useApp.subscribe((st, prev) => {
    if (st.servers !== prev.servers) syncServers();
    if (st.dms !== prev.dms) syncDms();
    if (st.unread !== prev.unread) updateBadge();
  });

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onVisibility);
}

function onVisibility() {
  if (idleTimer) clearTimeout(idleTimer);
  if (document.visibilityState === 'visible') {
    if (status !== 'online') {
      status = 'online';
      retrackAll();
    }
    const v = useApp.getState().view;
    if (v.kind === 'channel') useApp.getState().markRead(v.channelId);
    if (v.kind === 'dm') useApp.getState().markRead(v.threadId);
  } else {
    idleTimer = setTimeout(() => {
      status = 'idle';
      retrackAll();
    }, 3 * 60 * 1000);
  }
}

function retrackAll() {
  for (const [serverId, ch] of serverPresence) void ch.track(myState(serverId));
}

/** Informa a todos do servidor em qual call você está (ou que saiu). */
export function setVoicePresence(serverId: string | null, state: VoiceState | null): void {
  const previous = voice?.serverId ?? null;
  voice = serverId && state ? { serverId, state } : null;
  for (const id of new Set([previous, serverId])) {
    if (!id) continue;
    const ch = serverPresence.get(id);
    if (ch) void ch.track(myState(id));
  }
}

export function sendTyping(serverId: string | null, target: string): void {
  if (!serverId || !me) return;
  const now = Date.now();
  if (now - lastTyping < 2500) return;
  lastTyping = now;
  const ch = serverPresence.get(serverId);
  void ch?.send({ type: 'broadcast', event: 'typing', payload: { target, user_id: me, active: true } });
}

export function stopRealtime(): void {
  unsubApp?.();
  unsubApp = null;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('focus', onVisibility);
  try {
    void sb().removeAllChannels();
  } catch {
    // cliente não inicializado
  }
  userChannel = null;
  dmChannel = null;
  dmKey = '';
  serverDb.clear();
  serverPresence.clear();
  voice = null;
  me = null;
  connectionListeners = new Set(connectionListeners);
  setConnected(false);
}
