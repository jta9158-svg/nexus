import { useEffect, useState } from 'react';
import { BarChart3, Crown, ExternalLink, Mic, MicOff, MonitorUp, MoreHorizontal, Video, VideoOff, Volume2, AudioLines, MessageCircle } from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useCall } from '../../store/call';
import { useSession } from '../../store/session';
import { sb } from '../../lib/supabase';
import { canShareScreen } from '../../lib/platform';
import { formatCompact, formatNumber, formatRelative } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import type { Member, PresenceState, RobloxStat } from '../../types/db';
import { Avatar, Button, Card, ClaudeAvatar, cx, IconButton, StatusDot } from '../ui';
import { useClaudeVisible } from '../../store/session';

function CallCard({ serverId }: { serverId: string }) {
  const channels = useApp((s) => s.channels[serverId]) ?? [];
  const presence = useApp((s) => s.presence[serverId]);
  const profiles = useApp((s) => s.profiles);
  const openView = useApp((s) => s.openView);
  const call = useCall();
  const voice = channels.filter((c) => c.kind === 'voice');
  if (!voice.length) return null;

  const count = (id: string) => Object.values(presence ?? {}).filter((p) => p.voice?.channel_id === id).length;
  const mine = call.serverId === serverId ? voice.find((c) => c.id === call.channelId) : undefined;
  const busiest = [...voice].sort((a, b) => count(b.id) - count(a.id))[0];
  const ch = mine ?? (busiest && count(busiest.id) > 0 ? busiest : voice.find((c) => /equipe/i.test(c.name)) ?? voice[0]);
  const people = Object.values(presence ?? {}).filter((p) => p.voice?.channel_id === ch.id);
  const inThis = call.channelId === ch.id && (call.status === 'connected' || call.status === 'reconnecting');

  const join = () => {
    openView({ kind: 'call', serverId, channelId: ch.id });
    if (!inThis) void call.join(serverId, ch.id);
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Volume2 className="size-7 text-fg-2 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-semibold truncate">{ch.name}</div>
          <div className="text-[13px] text-fg-3">
            {people.length === 0 ? 'Ninguém na chamada' : `${people.length} ${people.length === 1 ? 'pessoa' : 'jogadores'} em chamada`}
          </div>
        </div>
        <IconButton label="Ver call" size="sm" onClick={() => openView({ kind: 'call', serverId, channelId: ch.id })}>
          <MoreHorizontal className="size-4" />
        </IconButton>
      </div>
      {people.length ? (
        <div className="flex -space-x-2 mt-3 pl-11">
          {people.slice(0, 6).map((p) => (
            <Avatar key={p.user_id} name={profiles[p.user_id]?.display_name ?? '?'} url={profiles[p.user_id]?.avatar_url} size={36} className="ring-2 ring-card rounded-full" />
          ))}
          {people.length > 6 ? <span className="size-9 rounded-full bg-raised ring-2 ring-card text-xs flex items-center justify-center">+{people.length - 6}</span> : null}
        </div>
      ) : null}
      <div className="flex items-center gap-2 mt-4">
        {inThis ? (
          <Button variant="danger" className="flex-1 !rounded-full" onClick={() => void call.leave()}>
            Sair da chamada
          </Button>
        ) : (
          <Button variant="success" className="flex-1 !rounded-full" onClick={join} loading={call.status === 'connecting' && call.channelId === ch.id}>
            Entrar na chamada
          </Button>
        )}
        <IconButton label={call.micOn ? 'Silenciar' : 'Ativar microfone'} disabled={!inThis} onClick={() => void call.toggleMic()} className="!rounded-full bg-raised">
          {inThis && !call.micOn ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
        </IconButton>
        <IconButton label={call.camOn ? 'Desligar câmera' : 'Ligar câmera'} disabled={!inThis} onClick={() => void call.toggleCam()} className="!rounded-full bg-raised">
          {call.camOn ? <VideoOff className="size-[18px]" /> : <Video className="size-[18px]" />}
        </IconButton>
        {canShareScreen ? (
          <IconButton label="Compartilhar tela" disabled={!inThis} onClick={() => void call.toggleScreen()} className="!rounded-full bg-raised" active={call.screenOn}>
            <MonitorUp className="size-[18px]" />
          </IconButton>
        ) : null}
      </div>
    </Card>
  );
}

function ClaudeCard() {
  const quota = useApp((s) => s.claudeQuota);
  const openView = useApp((s) => s.openView);
  const ok = !!quota?.allowed;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <ClaudeAvatar size={36} />
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-semibold">Claude AI</div>
          <div className="text-[13px] text-fg-3 flex items-center gap-1.5">
            <StatusDot status={ok ? 'online' : 'offline'} className="size-2" />
            {ok ? 'Liberado para você' : 'Sem acesso'}
          </div>
        </div>
        <span className="size-10 rounded-full bg-violet/15 text-[#b9a6ff] flex items-center justify-center" aria-hidden>
          <AudioLines className="size-5" />
        </span>
      </div>
      <p className="text-[14px] text-fg-2 mt-3">{ok ? 'Converse com o Claude e acompanhe as tarefas dele.' : quota?.reason ?? 'Peça ao administrador para liberar o Claude para você.'}</p>
      <Button variant="secondary" size="sm" className="mt-3" icon={<MessageCircle className="size-4" />} onClick={() => openView({ kind: 'claude' })}>
        Abrir chat
      </Button>
    </Card>
  );
}

function RobloxCard({ serverId }: { serverId: string }) {
  const experiences = useApp((s) => s.robloxExperiences[serverId]) ?? [];
  const perms = useApp((s) => s.myPerms[serverId]);
  const openView = useApp((s) => s.openView);
  const [stat, setStat] = useState<RobloxStat | null>(null);
  const exp = experiences[0];

  useEffect(() => {
    let alive = true;
    if (!exp) return;
    void sb()
      .from('roblox_stats')
      .select('*')
      .eq('universe_id', exp.universe_id)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => alive && setStat((data as RobloxStat) ?? null));
    return () => {
      alive = false;
    };
  }, [exp]);

  if (!hasPerm(perms, 'view_roblox')) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className="size-9 rounded-xl bg-[#0d1118] border border-line flex items-center justify-center">
          <BarChart3 className="size-[18px] text-fg-2" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-semibold">Faturamento Roblox</div>
          <div className="text-[13px] text-fg-3">{exp ? 'Métricas públicas do jogo' : 'Nenhum jogo vinculado'}</div>
        </div>
      </div>
      {exp ? (
        <div className="mt-3 rounded-xl border border-line bg-[#11161f] p-3.5">
          <div className="text-[14px] font-medium truncate">{exp.name ?? stat?.name ?? 'Experiência'}</div>
          <div className="text-[12px] text-fg-3">ID do universo: {exp.universe_id}</div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="text-[22px] font-bold text-success tabular-nums">{stat?.playing != null ? formatNumber(stat.playing) : '—'}</div>
              <div className="text-[12px] text-fg-3">jogando agora</div>
            </div>
            <div>
              <div className="text-[22px] font-bold tabular-nums">{stat?.visits != null ? formatCompact(stat.visits) : '—'}</div>
              <div className="text-[12px] text-fg-3">visitas totais</div>
            </div>
          </div>
          <div className="text-[11.5px] text-fg-3 mt-2">
            {stat ? `Fonte: ${stat.source} · ${formatRelative(stat.fetched_at)}` : 'Ainda não houve coleta. Abra os detalhes para atualizar.'}
          </div>
          <div className="text-[11.5px] text-fg-3 mt-1">Robux recebidos: indisponível sem integração oficial da conta.</div>
        </div>
      ) : null}
      <Button variant="secondary" size="sm" className="mt-3" icon={<ExternalLink className="size-4" />} onClick={() => openView({ kind: 'roblox', serverId })}>
        {exp ? 'Ver detalhes' : 'Vincular jogo'}
      </Button>
    </Card>
  );
}

interface Group {
  key: string;
  label: string;
  color: string | null;
  members: Member[];
}

function MembersCard({ serverId }: { serverId: string }) {
  const me = useSession((s) => s.userId);
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const members = useApp((s) => s.members[serverId]) ?? [];
  const roles = useApp((s) => s.roles[serverId]) ?? [];
  const memberRoles = useApp((s) => s.memberRoles[serverId]) ?? [];
  const presence = useApp((s) => s.presence[serverId]) ?? {};
  const profiles = useApp((s) => s.profiles);
  const setModal = useApp((s) => s.setModal);
  if (!server) return null;

  const placed = new Set<string>();
  const groups: Group[] = [];
  const owner = members.find((m) => m.user_id === server.owner_id);
  if (owner) {
    groups.push({ key: 'owner', label: 'Fundador', color: '#22c55e', members: [owner] });
    placed.add(owner.user_id);
  }
  for (const r of roles.filter((r) => r.hoist && !r.is_default).sort((a, b) => b.position - a.position)) {
    const ms = members.filter((m) => !placed.has(m.user_id) && memberRoles.some((mr) => mr.user_id === m.user_id && mr.role_id === r.id));
    if (!ms.length) continue;
    ms.forEach((m) => placed.add(m.user_id));
    groups.push({ key: r.id, label: r.name, color: r.color, members: ms });
  }
  const rest = members.filter((m) => !placed.has(m.user_id));
  if (rest.length) groups.push({ key: 'rest', label: 'Membros', color: null, members: rest });

  const statusOf = (uid: string): PresenceState['status'] | 'offline' => presence[uid]?.status ?? (uid === me ? 'online' : 'offline');
  const order = (a: Member, b: Member) => {
    const sa = statusOf(a.user_id) === 'offline' ? 1 : 0;
    const sb2 = statusOf(b.user_id) === 'offline' ? 1 : 0;
    return sa - sb2 || displayNameFor(a.user_id, serverId).localeCompare(displayNameFor(b.user_id, serverId));
  };

  return (
    <div className="px-1">
      <div className="text-[14px] font-semibold text-fg-2 px-3 pt-1 pb-2">Membros do servidor</div>
      {groups.map((g) => (
        <div key={g.key} className="mb-3">
          <div className="px-3 pb-1 text-[12.5px] text-fg-3 flex items-center gap-1.5">
            {g.label}
            {g.members.some((m) => statusOf(m.user_id) !== 'offline') ? <StatusDot status="online" className="size-1.5" /> : null}
          </div>
          {[...g.members].sort(order).map((m) => {
            const st = statusOf(m.user_id);
            const p = profiles[m.user_id];
            return (
              <button
                key={m.user_id}
                onClick={() => setModal({ kind: 'profile', userId: m.user_id, serverId })}
                className={cx('w-full flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-raised/60 text-left', st === 'offline' && 'opacity-55')}
              >
                <Avatar name={p?.display_name ?? '?'} url={p?.avatar_url} size={36} status={st} ringColor="#0b0e14" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] text-fg" style={{ color: g.color ?? undefined }}>
                      {displayNameFor(m.user_id, serverId)}
                    </span>
                    {g.key === 'owner' ? <Crown className="size-3.5 text-warn shrink-0" /> : null}
                  </span>
                  <span className="block text-[12px] text-fg-3">
                    {presence[m.user_id]?.voice ? 'Em uma call' : st === 'online' ? 'Online' : st === 'idle' ? 'Ausente' : st === 'dnd' ? 'Não perturbe' : 'Offline'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function RightPanel() {
  const view = useApp((s) => s.view);
  const serverId = view.kind === 'channel' ? view.serverId : null;
  const claudeVisible = useClaudeVisible();
  if (!serverId) return null;
  return (
    <aside className="h-full overflow-y-auto nx-scroll space-y-3 pb-3" aria-label="Painel da equipe">
      <CallCard serverId={serverId} />
      {claudeVisible ? <ClaudeCard /> : null}
      <RobloxCard serverId={serverId} />
      <MembersCard serverId={serverId} />
    </aside>
  );
}
