import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bot,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Gamepad2,
  Hash,
  Headphones,
  HeadphoneOff,
  LayoutDashboard,
  Lock,
  LogOut,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  Settings,
  Signal,
  Sparkles,
  UserPen,
  UserPlus,
  Volume2,
  Wallet,
  X,
} from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useClaudeVisible, useSession } from '../../store/session';
import { useCall } from '../../store/call';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { hasPerm } from '../../lib/permissions';
import { groupChannels, moveCategory, moveChannel, type LayoutChange } from '../../lib/layout';
import type { Channel, ChannelCategory, PresenceState } from '../../types/db';
import { Avatar, ClaudeAvatar, CountBadge, cx, IconButton } from '../ui';
import { ServerBanner } from './ServerArt';

// ---------------------------------------------------------------------
// Pedaços reutilizáveis
// ---------------------------------------------------------------------
function SectionHeader({ children, onAdd, addLabel }: { children: ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="flex items-center justify-between pl-2 pr-1 pt-4 pb-1.5">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-fg-3 flex items-center gap-1">{children}</span>
      {onAdd ? (
        <button onClick={onAdd} aria-label={addLabel} title={addLabel} className="text-fg-3 hover:text-fg p-1 rounded">
          <Plus className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  badge,
  bold,
  trailing,
}: {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  bold?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'group w-full h-9 flex items-center gap-2.5 px-2.5 rounded-lg text-[14.5px] transition-colors text-left',
        active ? 'bg-raised text-fg' : bold ? 'text-fg hover:bg-raised/70' : 'text-fg-2 hover:text-fg hover:bg-raised/60',
      )}
    >
      <span className={cx('shrink-0', active ? 'text-fg' : 'text-fg-3 group-hover:text-fg-2')}>{icon}</span>
      <span className={cx('flex-1 truncate', bold && 'font-semibold')}>{label}</span>
      {trailing}
      {badge ? <CountBadge count={badge} /> : null}
    </button>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [ref, onOut, active]);
}

// ---------------------------------------------------------------------
// Painel do usuário (rodapé da barra lateral)
// ---------------------------------------------------------------------
export function UserPanel() {
  const me = useSession((s) => s.me);
  const setModal = useApp((s) => s.setModal);
  const call = useCall();
  if (!me) return null;
  const inCall = call.status === 'connected' || call.status === 'reconnecting';
  return (
    <div className="shrink-0 border-t border-line-soft">
      {call.status !== 'idle' ? <VoiceStatusBar /> : null}
      <div className="h-[62px] flex items-center gap-2.5 px-3">
        <button className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded-lg hover:bg-raised/60 p-1 -m-1" onClick={() => setModal({ kind: 'settings', tab: 'perfil' })}>
          <Avatar name={me.display_name} url={me.avatar_url} size={36} status="online" ringColor="#10141b" />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-fg truncate">{me.display_name}</span>
            <span className="block text-[12px] text-fg-3 truncate">{inCall ? 'Em uma call' : 'Online'}</span>
          </span>
        </button>
        <IconButton
          label={call.micOn ? 'Silenciar microfone' : 'Ativar microfone'}
          onClick={() => (inCall ? void call.toggleMic() : toast.info('Entre em um canal de voz para usar o microfone'))}
          tone={inCall && !call.micOn ? 'danger' : 'default'}
          size="sm"
        >
          {inCall && !call.micOn ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
        </IconButton>
        <IconButton
          label={call.deafened ? 'Ativar áudio' : 'Desativar áudio'}
          onClick={() => (inCall ? call.toggleDeafen() : toast.info('Entre em um canal de voz para controlar o áudio'))}
          tone={call.deafened ? 'danger' : 'default'}
          size="sm"
        >
          {call.deafened ? <HeadphoneOff className="size-[18px]" /> : <Headphones className="size-[18px]" />}
        </IconButton>
        <IconButton label="Configurações" onClick={() => setModal({ kind: 'settings' })} size="sm">
          <Settings className="size-[18px]" />
        </IconButton>
      </div>
    </div>
  );
}

function VoiceStatusBar() {
  const call = useCall();
  const channels = useApp((s) => (call.serverId ? s.channels[call.serverId] : undefined));
  const openView = useApp((s) => s.openView);
  const channel = channels?.find((c) => c.id === call.channelId);
  const label =
    call.status === 'connecting'
      ? 'Conectando…'
      : call.status === 'reconnecting'
        ? 'Reconectando…'
        : call.status === 'error'
          ? 'Falha na call'
          : 'Voz conectada';
  return (
    <div className="px-3 pt-2.5 pb-2 border-b border-line-soft">
      <div className="flex items-center gap-2">
        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => call.serverId && call.channelId && openView({ kind: 'call', serverId: call.serverId, channelId: call.channelId })}
        >
          <span className={cx('flex items-center gap-1.5 text-[13px] font-semibold', call.status === 'error' ? 'text-danger' : 'text-success')}>
            <Signal className="size-4" /> {label}
          </span>
          <span className="block text-[12px] text-fg-3 truncate">
            {call.status === 'error' ? call.error : channel ? channel.name : 'Canal de voz'}
          </span>
        </button>
        <IconButton label="Sair da call" onClick={() => void call.leave()} size="sm">
          {call.status === 'error' ? <X className="size-[18px]" /> : <PhoneOff className="size-[18px]" />}
        </IconButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Barra lateral de um servidor
// ---------------------------------------------------------------------
function voiceParticipants(presence: Record<string, PresenceState> | undefined, channelId: string): PresenceState[] {
  if (!presence) return [];
  return Object.values(presence).filter((p) => p.voice?.channel_id === channelId);
}

const COLLAPSED_KEY = 'nexus.collapsedCategories.v1';

function readCollapsed(): Record<string, boolean> {
  try {
    const list = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]') as string[];
    return Object.fromEntries(list.map((id) => [id, true]));
  } catch {
    return {};
  }
}

function writeCollapsed(map: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Object.keys(map).filter((k) => map[k])));
  } catch {
    // sem armazenamento local: só não lembra
  }
}

type DragItem = { type: 'channel' | 'category'; id: string };
type DropHint = { id: string; where: 'before' | 'after' | 'inside' };

export function ServerSidebar({ serverId }: { serverId: string }) {
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const channels = useApp((s) => s.channels[serverId]) ?? [];
  const categories = useApp((s) => s.categories[serverId]) ?? [];
  const perms = useApp((s) => s.myPerms[serverId]) ?? [];
  const view = useApp((s) => s.view);
  const unread = useApp((s) => s.unread);
  const presence = useApp((s) => s.presence[serverId]);
  const profiles = useApp((s) => s.profiles);
  const openChannel = useApp((s) => s.openChannel);
  const openView = useApp((s) => s.openView);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.userId);
  const call = useCall();
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenu(false), menu);

  if (!server) return null;
  const canManageChannels = hasPerm(perms, 'manage_channels');
  const isOwner = server.owner_id === me;
  const groups = groupChannels(channels, categories);

  const joinVoice = (c: Channel) => {
    openView({ kind: 'call', serverId, channelId: c.id });
    if (call.channelId !== c.id || call.status === 'idle' || call.status === 'error') void call.join(serverId, c.id);
  };

  const leave = async () => {
    setMenu(false);
    if (!confirm(`Sair do servidor "${server.name}"?`)) return;
    const { error } = await sb().rpc('leave_server', { p_server: serverId });
    if (error) toast.error(error);
  };

  const toggleCategory = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    writeCollapsed(next);
  };

  const persist = async (change: LayoutChange | null) => {
    if (!change) return;
    const before = { channels, categories };
    useApp.getState().applyLayout(serverId, change.categories, change.channels);
    const { error } = await sb().rpc('save_channel_layout', {
      p_server: serverId,
      p_categories: change.categoryPatch,
      p_channels: change.channelPatch,
    });
    if (error) {
      useApp.getState().applyLayout(serverId, before.categories, before.channels);
      toast.error(error);
    }
  };

  const endDrag = () => {
    setDrag(null);
    setHint(null);
  };

  // Arrastar e soltar (computador). No celular: editar canal → categoria e posição.
  const channelDnd = (c: Channel, list: Channel[], groupCat: string | null) =>
    canManageChannels
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', c.id);
            setDrag({ type: 'channel', id: c.id });
          },
          onDragEnd: endDrag,
          onDragOver: (e: React.DragEvent) => {
            if (drag?.type !== 'channel') return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setHint({ id: c.id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' });
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (drag?.type === 'channel') {
              const idx = list.findIndex((x) => x.id === c.id);
              const beforeId = hint?.id === c.id && hint.where === 'after' ? list[idx + 1]?.id ?? null : c.id;
              void persist(moveChannel(channels, categories, drag.id, groupCat, beforeId));
            }
            endDrag();
          },
        }
      : {};

  const categoryDnd = (cat: ChannelCategory, list: Channel[]) =>
    canManageChannels
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', cat.id);
            setDrag({ type: 'category', id: cat.id });
          },
          onDragEnd: endDrag,
          onDragOver: (e: React.DragEvent) => {
            if (!drag) return;
            e.preventDefault();
            if (drag.type === 'channel') {
              setHint({ id: cat.id, where: 'inside' });
            } else {
              const r = e.currentTarget.getBoundingClientRect();
              setHint({ id: cat.id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' });
            }
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (drag?.type === 'channel') {
              void persist(moveChannel(channels, categories, drag.id, cat.id, list[0]?.id ?? null));
            } else if (drag?.type === 'category') {
              const sorted = groups.filter((g) => g.category).map((g) => g.category!);
              const idx = sorted.findIndex((x) => x.id === cat.id);
              const beforeId = hint?.id === cat.id && hint.where === 'after' ? sorted[idx + 1]?.id ?? null : cat.id;
              void persist(moveCategory(channels, categories, drag.id, beforeId));
            }
            endDrag();
          },
        }
      : {};

  const isActive = (kind: string) => view.kind === kind && 'serverId' in view && view.serverId === serverId;

  const renderChannel = (c: Channel, list: Channel[], groupCat: string | null) => {
    const line = hint?.id === c.id && drag?.type === 'channel' && drag.id !== c.id ? hint.where : null;
    const editButton = canManageChannels ? (
      <span
        role="button"
        tabIndex={-1}
        aria-label="Editar canal"
        title="Editar canal"
        onClick={(e) => {
          e.stopPropagation();
          setModal({ kind: 'channel', serverId, channelId: c.id });
        }}
        className="opacity-0 group-hover:opacity-100 text-fg-3 hover:text-fg"
      >
        <Settings className="size-3.5" />
      </span>
    ) : null;
    if (c.kind === 'text') {
      const u = unread[c.id];
      const active = view.kind === 'channel' && view.channelId === c.id;
      return (
        <div key={c.id} {...channelDnd(c, list, groupCat)} className={cx('relative', drag?.id === c.id && 'opacity-40')}>
          {line ? <DropLine where={line} /> : null}
          <NavItem
            icon={c.is_private ? <Lock className="size-[17px]" /> : <Hash className="size-[18px]" />}
            label={c.name}
            active={active}
            bold={!!u && u.unread > 0 && !active}
            badge={u?.mentions}
            onClick={() => openChannel(serverId, c.id)}
            trailing={editButton}
          />
        </div>
      );
    }
    const people = voiceParticipants(presence, c.id);
    const active = view.kind === 'call' && view.channelId === c.id;
    return (
      <div key={c.id} {...channelDnd(c, list, groupCat)} className={cx('relative', drag?.id === c.id && 'opacity-40')}>
        {line ? <DropLine where={line} /> : null}
        <NavItem
          icon={c.is_private ? <Lock className="size-[17px]" /> : <Volume2 className="size-[18px]" />}
          label={c.name}
          active={active}
          onClick={() => joinVoice(c)}
          trailing={
            <span className="flex items-center gap-1">
              {editButton}
              <span className="min-w-[26px] h-5 px-1 rounded-md bg-[#0d1118] border border-line text-[11px] text-fg-2 flex items-center justify-center tabular-nums">
                {String(people.length).padStart(2, '0')}
              </span>
              {c.user_limit ? (
                <span className="min-w-[26px] h-5 px-1 rounded-md bg-[#0d1118] border border-line text-[11px] text-fg-3 flex items-center justify-center tabular-nums">
                  {String(c.user_limit).padStart(2, '0')}
                </span>
              ) : null}
            </span>
          }
        />
        {people.length ? (
          <div className="pl-9 pr-2 pb-1 space-y-0.5">
            {people.map((p) => (
              <div key={p.user_id} className="flex items-center gap-2 h-7 text-[13px] text-fg-2">
                <Avatar name={profiles[p.user_id]?.display_name ?? '?'} url={profiles[p.user_id]?.avatar_url} size={22} />
                <span className="truncate flex-1">{displayNameFor(p.user_id, serverId)}</span>
                {p.voice?.screen ? <span className="text-[10px] font-bold text-white bg-danger rounded px-1">AO VIVO</span> : null}
                {p.voice?.muted ? <MicOff className="size-3.5 text-fg-3" /> : null}
                {p.voice?.deafened ? <HeadphoneOff className="size-3.5 text-fg-3" /> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const looseGroup = groups.find((g) => !g.category);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Banner */}
      <div className="relative shrink-0 h-[124px] rounded-t-2xl overflow-hidden" ref={menuRef}>
        {server.banner_url ? (
          <img src={server.banner_url} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <ServerBanner seed={server.id} className="absolute inset-0 size-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent" />
        <button
          onClick={() => setMenu(!menu)}
          className="absolute top-0 inset-x-0 flex items-center gap-2 px-4 pt-3.5 pb-2 text-left"
          aria-haspopup="menu"
          aria-expanded={menu}
        >
          <span className="flex-1 truncate text-[17px] font-bold text-white drop-shadow">{server.name}</span>
          <ChevronDown className={cx('size-5 text-white/90 transition-transform', menu && 'rotate-180')} />
        </button>
        {menu ? (
          <div role="menu" className="absolute z-20 top-12 left-3 right-3 rounded-xl border border-line bg-[#171c27] shadow-2xl p-1.5 animate-fade-in">
            {hasPerm(perms, 'create_invites') ? (
              <MenuItem icon={<UserPlus className="size-4" />} onClick={() => { setMenu(false); setModal({ kind: 'invite', serverId }); }} accent>
                Convidar pessoas
              </MenuItem>
            ) : null}
            {hasPerm(perms, 'manage_server') || hasPerm(perms, 'manage_roles') || hasPerm(perms, 'kick_members') || hasPerm(perms, 'ban_members') ? (
              <MenuItem icon={<Settings className="size-4" />} onClick={() => { setMenu(false); setModal({ kind: 'serverSettings', serverId }); }}>
                Configurações do servidor
              </MenuItem>
            ) : null}
            {canManageChannels ? (
              <MenuItem icon={<Plus className="size-4" />} onClick={() => { setMenu(false); setModal({ kind: 'channel', serverId }); }}>
                Criar canal
              </MenuItem>
            ) : null}
            {canManageChannels ? (
              <MenuItem icon={<FolderPlus className="size-4" />} onClick={() => { setMenu(false); setModal({ kind: 'category', serverId }); }}>
                Criar categoria
              </MenuItem>
            ) : null}
            <MenuItem icon={<UserPen className="size-4" />} onClick={() => { setMenu(false); setModal({ kind: 'nickname', serverId }); }}>
              Editar perfil do servidor
            </MenuItem>
            {!isOwner ? (
              <MenuItem icon={<LogOut className="size-4" />} onClick={() => void leave()} danger>
                Sair do servidor
              </MenuItem>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto nx-scroll px-2 pb-3" onDragLeave={(e) => e.currentTarget === e.target && setHint(null)}>
        {/* Sem categoria (no topo, como no Discord). Ao arrastar um canal aparece a área para tirá-lo da categoria. */}
        {drag?.type === 'channel' && !looseGroup ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setHint({ id: '__solto__', where: 'inside' });
            }}
            onDrop={(e) => {
              e.preventDefault();
              void persist(moveChannel(channels, categories, drag.id, null, null));
              endDrag();
            }}
            className={cx(
              'mt-3 mx-1 h-9 rounded-lg border border-dashed text-[12px] flex items-center justify-center',
              hint?.id === '__solto__' ? 'border-accent text-fg-2 bg-accent/10' : 'border-line text-fg-3',
            )}
          >
            Solte aqui para tirar da categoria
          </div>
        ) : null}
        {looseGroup ? <div className="pt-3">{looseGroup.channels.map((c) => renderChannel(c, looseGroup.channels, null))}</div> : null}

        {groups
          .filter((g) => g.category)
          .map((g) => {
            const cat = g.category!;
            const isCollapsed = !!collapsed[cat.id];
            const activeHere = g.channels.filter(
              (c) => (view.kind === 'channel' || view.kind === 'call') && view.channelId === c.id,
            );
            const visible = isCollapsed ? activeHere : g.channels;
            const line = hint?.id === cat.id && drag && drag.id !== cat.id ? hint.where : null;
            return (
              <div key={cat.id} className="relative">
                <div
                  {...categoryDnd(cat, g.channels)}
                  className={cx('group/cat relative flex items-center pl-1 pr-1 pt-4 pb-1.5 rounded-md', line === 'inside' && 'bg-accent/10', drag?.id === cat.id && 'opacity-40')}
                >
                  {line && line !== 'inside' ? <DropLine where={line} /> : null}
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    aria-expanded={!isCollapsed}
                    className="flex-1 min-w-0 flex items-center gap-0.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-fg-3 hover:text-fg-2 text-left"
                  >
                    <ChevronDown className={cx('size-3.5 shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
                    <span className="truncate">{cat.name}</span>
                  </button>
                  {canManageChannels ? (
                    <>
                      <button
                        onClick={() => setModal({ kind: 'category', serverId, categoryId: cat.id })}
                        aria-label={`Editar categoria ${cat.name}`}
                        title="Editar categoria"
                        className="opacity-0 group-hover/cat:opacity-100 focus:opacity-100 text-fg-3 hover:text-fg p-1 rounded"
                      >
                        <Settings className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setModal({ kind: 'channel', serverId, categoryId: cat.id })}
                        aria-label={`Criar canal em ${cat.name}`}
                        title="Criar canal"
                        className="text-fg-3 hover:text-fg p-1 rounded"
                      >
                        <Plus className="size-4" />
                      </button>
                    </>
                  ) : null}
                </div>
                {visible.map((c) => renderChannel(c, g.channels, cat.id))}
                {!isCollapsed && g.channels.length === 0 && canManageChannels ? (
                  <p className="px-2.5 py-1 text-[12px] text-fg-3">Arraste canais para cá ou toque no +.</p>
                ) : null}
              </div>
            );
          })}

        {channels.length === 0 ? (
          <p className="px-2.5 pt-4 text-[13px] text-fg-3">Nenhum canal ainda.{canManageChannels ? ' Use “Criar canal” no menu do servidor.' : ''}</p>
        ) : null}

        {server.services_enabled && (hasPerm(perms, 'view_roblox') || hasPerm(perms, 'view_projects') || hasPerm(perms, 'view_finance') || hasPerm(perms, 'view_files')) ? (
          <>
            <SectionHeader>
              <ChevronDown className="size-3.5" /> Serviços
            </SectionHeader>
            {hasPerm(perms, 'view_roblox') ? (
              <NavItem icon={<BarChart3 className="size-[18px]" />} label="Faturamento Roblox" active={isActive('roblox')} onClick={() => openView({ kind: 'roblox', serverId })} />
            ) : null}
            {hasPerm(perms, 'view_projects') ? (
              <NavItem icon={<Gamepad2 className="size-[18px]" />} label="Projetos" active={isActive('projects')} onClick={() => openView({ kind: 'projects', serverId })} />
            ) : null}
            {hasPerm(perms, 'view_finance') ? (
              <NavItem icon={<Wallet className="size-[18px]" />} label="Finanças" active={isActive('finance')} onClick={() => openView({ kind: 'finance', serverId })} />
            ) : null}
            {hasPerm(perms, 'view_files') ? (
              <NavItem icon={<FolderOpen className="size-[18px]" />} label="Arquivos" active={isActive('files')} onClick={() => openView({ kind: 'files', serverId })} />
            ) : null}
          </>
        ) : null}
      </div>
      <UserPanel />
    </div>
  );
}

function DropLine({ where }: { where: 'before' | 'after' | 'inside' }) {
  if (where === 'inside') return null;
  return <span className={cx('pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-accent z-10', where === 'before' ? 'top-0' : 'bottom-0')} />;
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
  accent,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cx(
        'w-full h-9 px-2.5 rounded-lg flex items-center gap-2.5 text-sm text-left',
        danger ? 'text-danger hover:bg-danger/10' : accent ? 'text-mention hover:bg-accent/10' : 'text-fg-2 hover:text-fg hover:bg-raised',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------
// Barra lateral do Início (mensagens privadas)
// ---------------------------------------------------------------------
export function HomeSidebar() {
  const dms = useApp((s) => s.dms);
  const profiles = useApp((s) => s.profiles);
  const view = useApp((s) => s.view);
  const unread = useApp((s) => s.unread);
  const presence = useApp((s) => s.presence);
  const openView = useApp((s) => s.openView);
  const openDm = useApp((s) => s.openDm);
  const setModal = useApp((s) => s.setModal);
  const me = useSession((s) => s.userId);
  const claudeVisible = useClaudeVisible();

  const onlineIds = new Set<string>();
  for (const map of Object.values(presence)) for (const id of Object.keys(map)) onlineIds.add(id);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-14 shrink-0 flex items-center px-4 border-b border-line-soft">
        <span className="text-[15px] font-semibold">Início</span>
      </div>
      <div className="flex-1 overflow-y-auto nx-scroll px-2 pb-3 pt-2">
        <NavItem icon={<LayoutDashboard className="size-[18px]" />} label="Visão geral" active={view.kind === 'home'} onClick={() => openView({ kind: 'home' })} />
        {claudeVisible ? (
          <>
            <NavItem icon={<ClaudeAvatar size={20} />} label="NEXUS IA" active={view.kind === 'claude'} onClick={() => openView({ kind: 'claude' })} />
            <NavItem icon={<Sparkles className="size-[18px]" />} label="NEXUS Companion" active={view.kind === 'companion'} onClick={() => openView({ kind: 'companion' })} />
          </>
        ) : null}

        <SectionHeader onAdd={() => setModal({ kind: 'newDm' })} addLabel="Nova mensagem privada">
          Mensagens privadas
        </SectionHeader>
        {dms.filter((d) => !d.hidden).length === 0 ? (
          <p className="px-2.5 py-2 text-[13px] text-fg-3">
            Nenhuma conversa ainda. Toque no <b>+</b> para falar com alguém da sua equipe.
          </p>
        ) : null}
        {dms
          .filter((d) => !d.hidden)
          .map((d) => {
            const others = d.participants.filter((p) => p !== me);
            const first = profiles[others[0]];
            const name = d.is_group ? d.name || others.map((o) => profiles[o]?.display_name ?? '…').join(', ') : first?.display_name ?? 'Carregando…';
            const u = unread[d.id];
            const active = view.kind === 'dm' && view.threadId === d.id;
            return (
              <button
                key={d.id}
                onClick={() => openDm(d.id)}
                className={cx(
                  'w-full h-11 flex items-center gap-2.5 px-2 rounded-lg text-left transition-colors',
                  active ? 'bg-raised' : 'hover:bg-raised/60',
                )}
              >
                {d.is_group ? (
                  <span className="size-8 rounded-full bg-violet/30 text-[#c9bcff] flex items-center justify-center">
                    <Bot className="size-4" />
                  </span>
                ) : (
                  <Avatar name={first?.display_name ?? '?'} url={first?.avatar_url} size={32} status={onlineIds.has(others[0]) ? 'online' : 'offline'} />
                )}
                <span className={cx('flex-1 truncate text-[14.5px]', u?.unread && !active ? 'text-fg font-semibold' : active ? 'text-fg' : 'text-fg-2')}>
                  {name}
                </span>
                {u?.unread && !active ? <CountBadge count={u.unread} /> : null}
              </button>
            );
          })}
      </div>
      <UserPanel />
    </div>
  );
}
