import { create } from 'zustand';
import { sb } from '../lib/supabase';
import { friendlyError } from '../lib/errors';
import { useSession } from './session';
import type {
  Channel,
  ChannelCategory,
  ClaudeQuota,
  DmThread,
  Member,
  MemberRole,
  NotificationRow,
  PresenceState,
  Profile,
  Project,
  RobloxExperience,
  Role,
  Server,
  UnreadRow,
} from '../types/db';

export type View =
  | { kind: 'home' }
  | { kind: 'dm'; threadId: string }
  | { kind: 'channel'; serverId: string; channelId: string }
  | { kind: 'call'; serverId: string; channelId: string }
  | { kind: 'claude'; conversationId?: string | null }
  | { kind: 'companion' }
  | { kind: 'roblox'; serverId: string | null }
  | { kind: 'projects'; serverId: string; projectId?: string | null }
  | { kind: 'finance'; serverId: string }
  | { kind: 'files'; serverId: string }
  | { kind: 'discover' }
  | { kind: 'friends' };

export type ModalState =
  | { kind: 'createServer' }
  | { kind: 'joinServer'; code?: string }
  | { kind: 'serverSettings'; serverId: string; tab?: 'geral' | 'cargos' | 'membros' | 'convites' | 'banimentos' | 'claude' }
  | { kind: 'category'; serverId: string; categoryId?: string }
  | { kind: 'nickname'; serverId: string }
  | { kind: 'invite'; serverId: string }
  | { kind: 'channel'; serverId: string; channelId?: string; channelKind?: 'text' | 'voice'; categoryId?: string | null }
  | { kind: 'settings'; tab?: 'conta' | 'perfil' | 'voz' | 'notificacoes' | 'app' | 'admin' }
  | { kind: 'newDm' }
  | { kind: 'profile'; userId: string; serverId?: string | null };

interface UnreadInfo {
  unread: number;
  mentions: number;
  serverId: string | null;
}

interface AppState {
  ready: boolean;
  bootError: string | null;
  servers: Server[];
  activeServerId: string | null;
  view: View;
  lastChannel: Record<string, string>;

  channels: Record<string, Channel[]>;
  categories: Record<string, ChannelCategory[]>;
  roles: Record<string, Role[]>;
  members: Record<string, Member[]>;
  memberRoles: Record<string, MemberRole[]>;
  myPerms: Record<string, string[]>;
  projects: Record<string, Project[]>;
  robloxExperiences: Record<string, RobloxExperience[]>;
  loadedServers: Record<string, boolean>;

  profiles: Record<string, Profile>;
  dms: DmThread[];
  unread: Record<string, UnreadInfo>;
  notifications: NotificationRow[];
  presence: Record<string, Record<string, PresenceState>>;
  typing: Record<string, Record<string, number>>;
  claudeQuota: ClaudeQuota | null;

  mobileNavOpen: boolean;
  rightPanelOpen: boolean;
  modal: ModalState | null;
  searchOpen: boolean;
  notificationsOpen: boolean;

  bootstrap: (userId: string) => Promise<void>;
  reset: () => void;
  loadServer: (serverId: string, force?: boolean) => Promise<void>;
  reloadServers: () => Promise<void>;
  reloadDms: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  refreshQuota: () => Promise<void>;
  ensureProfiles: (ids: Array<string | null | undefined>) => Promise<void>;

  selectHome: () => void;
  /** Celular: mostra na gaveta a lista do Início (amigos e conversas privadas), sem trocar a tela. */
  showHomeList: () => void;
  selectServer: (serverId: string) => Promise<void>;
  openChannel: (serverId: string, channelId: string) => void;
  openDm: (threadId: string) => void;
  openView: (view: View) => void;
  startDmWith: (userId: string) => Promise<void>;

  markRead: (targetId: string) => void;
  bumpUnread: (targetId: string, serverId: string | null, mention: boolean) => void;

  setModal: (m: ModalState | null) => void;
  setMobileNav: (open: boolean) => void;
  setRightPanel: (open: boolean) => void;
  setSearch: (open: boolean) => void;
  setNotificationsOpen: (open: boolean) => void;

  // aplicadores (tempo real)
  upsertServer: (s: Server) => void;
  removeServer: (serverId: string) => void;
  upsertChannel: (c: Channel) => void;
  removeChannel: (channelId: string) => void;
  upsertCategory: (c: ChannelCategory) => void;
  removeCategory: (categoryId: string) => void;
  /** Aplica uma nova organização (arrastar e soltar) antes da resposta do servidor. */
  applyLayout: (serverId: string, categories: ChannelCategory[], channels: Channel[]) => void;
  upsertRole: (r: Role) => void;
  removeRole: (roleId: string) => void;
  upsertMember: (m: Member) => void;
  removeMember: (serverId: string, userId: string) => void;
  addMemberRole: (mr: MemberRole) => void;
  removeMemberRole: (mr: MemberRole) => void;
  refreshMyPerms: (serverId: string) => Promise<void>;
  addNotification: (n: NotificationRow) => void;
  updateNotification: (n: NotificationRow) => void;
  markNotificationsRead: (ids?: string[]) => Promise<void>;
  setPresence: (serverId: string, map: Record<string, PresenceState>) => void;
  setTyping: (targetId: string, userId: string, active: boolean) => void;
  upsertProfile: (p: Profile) => void;
  setProjects: (serverId: string, projects: Project[]) => void;
  setRobloxExperiences: (serverId: string, list: RobloxExperience[]) => void;
}

const LAST_KEY = 'nexus.lastChannel.v1';
const LAST_SERVER_KEY = 'nexus.lastServer.v1';

function readLast(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeLast(v: Record<string, string>, server: string | null) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
    if (server) localStorage.setItem(LAST_SERVER_KEY, server);
    else localStorage.removeItem(LAST_SERVER_KEY);
  } catch {
    // ignore
  }
}

const initial = {
  ready: false,
  bootError: null,
  servers: [] as Server[],
  activeServerId: null as string | null,
  view: { kind: 'home' } as View,
  lastChannel: {} as Record<string, string>,
  channels: {},
  categories: {},
  roles: {},
  members: {},
  memberRoles: {},
  myPerms: {},
  projects: {},
  robloxExperiences: {},
  loadedServers: {},
  profiles: {},
  dms: [] as DmThread[],
  unread: {},
  notifications: [] as NotificationRow[],
  presence: {},
  typing: {},
  claudeQuota: null,
  mobileNavOpen: false,
  rightPanelOpen: false,
  modal: null,
  searchOpen: false,
  notificationsOpen: false,
};

function sortChannels(list: Channel[]): Channel[] {
  return [...list].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

function sortCategories(list: ChannelCategory[]): ChannelCategory[] {
  return [...list].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

export const useApp = create<AppState>((set, get) => ({
  ...initial,

  reset: () => set({ ...initial }),

  bootstrap: async (userId) => {
    const c = sb();
    try {
      const [mem, unread, notifs] = await Promise.all([
        c.from('server_members').select('joined_at, servers(*)').eq('user_id', userId).order('joined_at'),
        c.rpc('unread_summary'),
        c.from('notifications').select('*').order('created_at', { ascending: false }).limit(60),
      ]);
      if (mem.error) throw mem.error;
      const servers = (mem.data ?? [])
        .map((r) => (r as unknown as { servers: Server | null }).servers)
        .filter((s): s is Server => !!s);

      const unreadMap: Record<string, UnreadInfo> = {};
      for (const r of (unread.data ?? []) as UnreadRow[]) {
        unreadMap[r.target_id] = { unread: r.unread, mentions: r.mentions, serverId: r.server_id };
      }

      set({
        servers,
        unread: unreadMap,
        notifications: (notifs.data ?? []) as NotificationRow[],
        lastChannel: readLast(),
      });
      await Promise.all([get().reloadDms(), get().refreshQuota()]);

      // Volta para onde a pessoa estava.
      let lastServer: string | null = null;
      try {
        lastServer = localStorage.getItem(LAST_SERVER_KEY);
      } catch {
        lastServer = null;
      }
      if (lastServer && servers.some((s) => s.id === lastServer)) {
        await get().selectServer(lastServer);
      } else {
        set({ activeServerId: null, view: { kind: 'home' } });
      }
      set({ ready: true, bootError: null });
    } catch (err) {
      set({ ready: true, bootError: friendlyError(err) });
    }
  },

  reloadServers: async () => {
    const c = sb();
    const { data } = await c.from('server_members').select('joined_at, servers(*)').order('joined_at');
    const servers = (data ?? [])
      .map((r) => (r as unknown as { servers: Server | null }).servers)
      .filter((s): s is Server => !!s);
    set({ servers });
  },

  reloadDms: async () => {
    const c = sb();
    const { data, error } = await c
      .from('dm_participants')
      .select('thread_id, hidden, dm_threads(*)')
      .eq('user_id', useSession.getState().userId ?? '');
    if (error) return;
    const threads = (data ?? []) as unknown as Array<{ thread_id: string; hidden: boolean; dm_threads: Omit<DmThread, 'participants' | 'hidden'> }>;
    const ids = threads.map((t) => t.thread_id);
    let parts: Array<{ thread_id: string; user_id: string }> = [];
    if (ids.length) {
      const res = await c.from('dm_participants').select('thread_id, user_id').in('thread_id', ids);
      parts = (res.data ?? []) as typeof parts;
    }
    const dms: DmThread[] = threads
      .filter((t) => t.dm_threads)
      .map((t) => ({
        ...t.dm_threads,
        hidden: t.hidden,
        participants: parts.filter((p) => p.thread_id === t.thread_id).map((p) => p.user_id),
      }))
      .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
    set({ dms });
    await get().ensureProfiles(parts.map((p) => p.user_id));
  },

  refreshUnread: async () => {
    const { data } = await sb().rpc('unread_summary');
    const unreadMap: Record<string, UnreadInfo> = {};
    for (const r of (data ?? []) as UnreadRow[]) {
      unreadMap[r.target_id] = { unread: r.unread, mentions: r.mentions, serverId: r.server_id };
    }
    set({ unread: unreadMap });
  },

  refreshQuota: async () => {
    const { data } = await sb().rpc('my_claude_quota').maybeSingle();
    set({ claudeQuota: (data as ClaudeQuota) ?? null });
  },

  ensureProfiles: async (ids) => {
    const have = get().profiles;
    const missing = Array.from(new Set(ids.filter((x): x is string => !!x && !have[x])));
    if (!missing.length) return;
    const { data } = await sb().from('profiles').select('*').in('id', missing);
    if (data?.length) {
      const next = { ...get().profiles };
      for (const p of data as Profile[]) next[p.id] = p;
      set({ profiles: next });
    }
  },

  loadServer: async (serverId, force) => {
    if (get().loadedServers[serverId] && !force) return;
    const c = sb();
    const [ch, ro, mem, mr, perms, pj, rx, cats] = await Promise.all([
      c.from('channels').select('*').eq('server_id', serverId).order('position'),
      c.from('roles').select('*').eq('server_id', serverId).order('position', { ascending: false }),
      c.from('server_members').select('*, profiles(*)').eq('server_id', serverId),
      c.from('member_roles').select('server_id, user_id, role_id').eq('server_id', serverId),
      c.rpc('my_permissions', { p_server: serverId }),
      c.from('projects').select('*').eq('server_id', serverId).order('created_at'),
      c.from('roblox_experiences').select('*').eq('server_id', serverId).order('created_at'),
      c.from('channel_categories').select('*').eq('server_id', serverId).order('position'),
    ]);
    const memberRows = (mem.data ?? []) as Array<Member & { profiles: Profile | null }>;
    const profiles = { ...get().profiles };
    for (const m of memberRows) if (m.profiles) profiles[m.user_id] = m.profiles;
    set({
      channels: { ...get().channels, [serverId]: sortChannels((ch.data ?? []) as Channel[]) },
      categories: { ...get().categories, [serverId]: sortCategories((cats.data ?? []) as ChannelCategory[]) },
      roles: { ...get().roles, [serverId]: (ro.data ?? []) as Role[] },
      members: {
        ...get().members,
        [serverId]: memberRows.map(({ profiles: _p, ...m }) => m as Member),
      },
      memberRoles: { ...get().memberRoles, [serverId]: (mr.data ?? []) as MemberRole[] },
      myPerms: { ...get().myPerms, [serverId]: (perms.data ?? []) as string[] },
      projects: { ...get().projects, [serverId]: (pj.data ?? []) as Project[] },
      robloxExperiences: { ...get().robloxExperiences, [serverId]: (rx.data ?? []) as RobloxExperience[] },
      loadedServers: { ...get().loadedServers, [serverId]: true },
      profiles,
    });
  },

  selectHome: () => {
    set({ activeServerId: null, view: { kind: 'home' }, mobileNavOpen: false });
    writeLast(get().lastChannel, null);
  },

  showHomeList: () => {
    set({ activeServerId: null, mobileNavOpen: true });
  },

  selectServer: async (serverId) => {
    set({ activeServerId: serverId });
    await get().loadServer(serverId);
    const chans = get().channels[serverId] ?? [];
    const last = get().lastChannel[serverId];
    const target = chans.find((c) => c.id === last && c.kind === 'text') ?? chans.find((c) => c.kind === 'text');
    if (target) {
      get().openChannel(serverId, target.id);
    } else {
      set({ view: { kind: 'projects', serverId } });
    }
  },

  openChannel: (serverId, channelId) => {
    const lastChannel = { ...get().lastChannel, [serverId]: channelId };
    set({ activeServerId: serverId, view: { kind: 'channel', serverId, channelId }, lastChannel, mobileNavOpen: false });
    writeLast(lastChannel, serverId);
    get().markRead(channelId);
  },

  openDm: (threadId) => {
    set({ activeServerId: null, view: { kind: 'dm', threadId }, mobileNavOpen: false });
    get().markRead(threadId);
  },

  openView: (view) => {
    const serverId =
      'serverId' in view && view.serverId ? view.serverId : view.kind === 'claude' || view.kind === 'companion' ? get().activeServerId : null;
    set({ view, activeServerId: serverId ?? null, mobileNavOpen: false });
  },

  startDmWith: async (userId) => {
    const { data, error } = await sb().rpc('open_dm', { p_user: userId });
    if (error) throw error;
    await get().reloadDms();
    get().openDm(data as string);
  },

  markRead: (targetId) => {
    const cur = get().unread[targetId];
    if (cur && (cur.unread > 0 || cur.mentions > 0)) {
      set({ unread: { ...get().unread, [targetId]: { ...cur, unread: 0, mentions: 0 } } });
    }
    void sb().rpc('mark_read', { p_target: targetId });
  },

  bumpUnread: (targetId, serverId, mention) => {
    const cur = get().unread[targetId] ?? { unread: 0, mentions: 0, serverId };
    set({
      unread: {
        ...get().unread,
        [targetId]: { unread: cur.unread + 1, mentions: cur.mentions + (mention ? 1 : 0), serverId },
      },
    });
  },

  setModal: (m) => set({ modal: m }),
  setMobileNav: (open) => set({ mobileNavOpen: open }),
  setRightPanel: (open) => set({ rightPanelOpen: open }),
  setSearch: (open) => set({ searchOpen: open }),
  setNotificationsOpen: (open) => set({ notificationsOpen: open }),

  upsertServer: (s) => {
    const list = get().servers;
    const idx = list.findIndex((x) => x.id === s.id);
    set({ servers: idx >= 0 ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s] });
  },

  removeServer: (serverId) => {
    const st = get();
    const servers = st.servers.filter((s) => s.id !== serverId);
    const patch: Partial<AppState> = { servers };
    if (st.activeServerId === serverId) {
      patch.activeServerId = null;
      patch.view = { kind: 'home' };
    }
    const loaded = { ...st.loadedServers };
    delete loaded[serverId];
    patch.loadedServers = loaded;
    set(patch);
  },

  upsertChannel: (c) => {
    const list = get().channels[c.server_id];
    if (!list) return;
    const next = list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c];
    set({ channels: { ...get().channels, [c.server_id]: sortChannels(next) } });
  },

  removeChannel: (channelId) => {
    const all = get().channels;
    const next: Record<string, Channel[]> = {};
    for (const [sid, list] of Object.entries(all)) next[sid] = list.filter((c) => c.id !== channelId);
    const v = get().view;
    set({ channels: next });
    if ((v.kind === 'channel' || v.kind === 'call') && v.channelId === channelId) {
      void get().selectServer(v.serverId);
    }
  },

  upsertCategory: (c) => {
    const list = get().categories[c.server_id];
    if (!list) return;
    const next = list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c];
    set({ categories: { ...get().categories, [c.server_id]: sortCategories(next) } });
  },

  removeCategory: (categoryId) => {
    const cats: Record<string, ChannelCategory[]> = {};
    for (const [sid, list] of Object.entries(get().categories)) cats[sid] = list.filter((c) => c.id !== categoryId);
    const chans: Record<string, Channel[]> = {};
    for (const [sid, list] of Object.entries(get().channels)) {
      chans[sid] = list.map((c) => (c.category_id === categoryId ? { ...c, category_id: null } : c));
    }
    set({ categories: cats, channels: chans });
  },

  applyLayout: (serverId, categories, channels) => {
    set({
      categories: { ...get().categories, [serverId]: sortCategories(categories) },
      channels: { ...get().channels, [serverId]: sortChannels(channels) },
    });
  },

  upsertRole: (r) => {
    const list = get().roles[r.server_id];
    if (!list) return;
    const next = (list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]).sort(
      (a, b) => b.position - a.position,
    );
    set({ roles: { ...get().roles, [r.server_id]: next } });
    void get().refreshMyPerms(r.server_id);
  },

  removeRole: (roleId) => {
    const all = get().roles;
    const next: Record<string, Role[]> = {};
    let affected: string | null = null;
    for (const [sid, list] of Object.entries(all)) {
      if (list.some((r) => r.id === roleId)) affected = sid;
      next[sid] = list.filter((r) => r.id !== roleId);
    }
    set({ roles: next });
    if (affected) void get().refreshMyPerms(affected);
  },

  upsertMember: (m) => {
    const list = get().members[m.server_id];
    if (!list) return;
    const next = list.some((x) => x.user_id === m.user_id) ? list.map((x) => (x.user_id === m.user_id ? m : x)) : [...list, m];
    set({ members: { ...get().members, [m.server_id]: next } });
    void get().ensureProfiles([m.user_id]);
  },

  removeMember: (serverId, userId) => {
    const list = get().members[serverId];
    if (!list) return;
    set({ members: { ...get().members, [serverId]: list.filter((m) => m.user_id !== userId) } });
  },

  addMemberRole: (mr) => {
    const list = get().memberRoles[mr.server_id] ?? [];
    if (list.some((x) => x.user_id === mr.user_id && x.role_id === mr.role_id)) return;
    set({ memberRoles: { ...get().memberRoles, [mr.server_id]: [...list, mr] } });
    void get().refreshMyPerms(mr.server_id);
  },

  removeMemberRole: (mr) => {
    const list = get().memberRoles[mr.server_id] ?? [];
    set({
      memberRoles: {
        ...get().memberRoles,
        [mr.server_id]: list.filter((x) => !(x.user_id === mr.user_id && x.role_id === mr.role_id)),
      },
    });
    void get().refreshMyPerms(mr.server_id);
  },

  refreshMyPerms: async (serverId) => {
    const { data } = await sb().rpc('my_permissions', { p_server: serverId });
    set({ myPerms: { ...get().myPerms, [serverId]: (data ?? []) as string[] } });
  },

  addNotification: (n) => {
    if (get().notifications.some((x) => x.id === n.id)) return;
    set({ notifications: [n, ...get().notifications].slice(0, 100) });
  },

  updateNotification: (n) => {
    set({ notifications: get().notifications.map((x) => (x.id === n.id ? n : x)) });
  },

  markNotificationsRead: async (ids) => {
    const now = new Date().toISOString();
    const target = ids ?? get().notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (!target.length) return;
    set({ notifications: get().notifications.map((n) => (target.includes(n.id) ? { ...n, read_at: now } : n)) });
    await sb().from('notifications').update({ read_at: now }).in('id', target);
  },

  setPresence: (serverId, map) => set({ presence: { ...get().presence, [serverId]: map } }),

  setTyping: (targetId, userId, active) => {
    const cur = { ...(get().typing[targetId] ?? {}) };
    if (active) cur[userId] = Date.now() + 6000;
    else delete cur[userId];
    set({ typing: { ...get().typing, [targetId]: cur } });
  },

  upsertProfile: (p) => set({ profiles: { ...get().profiles, [p.id]: p } }),

  setProjects: (serverId, projects) => set({ projects: { ...get().projects, [serverId]: projects } }),

  setRobloxExperiences: (serverId, list) => set({ robloxExperiences: { ...get().robloxExperiences, [serverId]: list } }),
}));

// ---------------------------------------------------------------------
// Seletores auxiliares
// ---------------------------------------------------------------------
export function displayNameFor(userId: string | null | undefined, serverId?: string | null): string {
  if (!userId) return 'Usuário removido';
  const st = useApp.getState();
  if (serverId) {
    const m = st.members[serverId]?.find((x) => x.user_id === userId);
    if (m?.nickname) return m.nickname;
  }
  return st.profiles[userId]?.display_name ?? 'Carregando…';
}

/** Cor do nome conforme o cargo mais alto com cor. */
export function roleColorFor(userId: string | null | undefined, serverId: string | null | undefined): string | null {
  if (!userId || !serverId) return null;
  const st = useApp.getState();
  const server = st.servers.find((s) => s.id === serverId);
  const roleIds = (st.memberRoles[serverId] ?? []).filter((mr) => mr.user_id === userId).map((mr) => mr.role_id);
  const roles = (st.roles[serverId] ?? []).filter((r) => roleIds.includes(r.id) && r.color).sort((a, b) => b.position - a.position);
  if (roles[0]?.color) return roles[0].color;
  if (server?.owner_id === userId) return '#8EA1FF';
  return null;
}

export function serverUnread(serverId: string): { unread: number; mentions: number } {
  const st = useApp.getState();
  let unread = 0;
  let mentions = 0;
  for (const info of Object.values(st.unread)) {
    if (info.serverId === serverId) {
      unread += info.unread;
      mentions += info.mentions;
    }
  }
  return { unread, mentions };
}
