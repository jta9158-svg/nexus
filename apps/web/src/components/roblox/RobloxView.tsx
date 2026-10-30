import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Info, Link2, Plus, RefreshCw, ShieldAlert, Trash2, Users, Eye, Star } from 'lucide-react';
import { useApp } from '../../store/app';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { callFunction, sb } from '../../lib/supabase';
import { formatCompact, formatDate, formatNumber, formatRelative, formatTime } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import type { RobloxExperience, RobloxStat } from '../../types/db';
import { Button, Card, EmptyState, Field, Input, Modal, Notice, Select, Spinner } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

function Sparkline({ points }: { points: Array<{ t: string; v: number }> }) {
  if (points.length < 2) return <p className="text-[12px] text-fg-3">O histórico aparece depois de algumas coletas.</p>;
  const w = 560;
  const h = 120;
  const max = Math.max(...points.map((p) => p.v), 1);
  const min = Math.min(...points.map((p) => p.v), 0);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / Math.max(1, max - min)) * (h - 10) - 5;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none" role="img" aria-label="Jogadores online ao longo do tempo">
        <defs>
          <linearGradient id="rbx-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22c55e" stopOpacity="0.35" />
            <stop offset="1" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#rbx-fill)" />
        <path d={d} fill="none" stroke="#22c55e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] text-fg-3">
        <span>
          {formatDate(points[0].t)} {formatTime(points[0].t)}
        </span>
        <span>
          {formatDate(points[points.length - 1].t)} {formatTime(points[points.length - 1].t)}
        </span>
      </div>
    </div>
  );
}

function ExperienceCard({ exp, canManage, onRemoved }: { exp: RobloxExperience; canManage: boolean; onRemoved: () => void }) {
  const [stats, setStats] = useState<RobloxStat[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await sb()
      .from('roblox_stats')
      .select('*')
      .eq('universe_id', exp.universe_id)
      .order('fetched_at', { ascending: false })
      .limit(200);
    setStats(((data ?? []) as RobloxStat[]).reverse());
  }, [exp.universe_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      await callFunction('roblox', { action: 'refresh', universe_ids: [exp.universe_id] });
      await load();
    } catch (err) {
      toast.error(err, 'Não foi possível atualizar');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Desvincular este jogo? O histórico coletado continua salvo.')) return;
    const { error } = await sb().from('roblox_experiences').delete().eq('id', exp.id);
    if (error) return toast.error(error);
    onRemoved();
  };

  const last = stats?.[stats.length - 1];

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold truncate">{exp.name ?? last?.name ?? 'Experiência'}</h3>
          <p className="text-[12px] text-fg-3">
            Universo {exp.universe_id}
            {exp.root_place_id ? ` · Place ${exp.root_place_id}` : ''}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />} onClick={() => void refresh()} disabled={busy}>
          Atualizar
        </Button>
        {canManage ? (
          <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void remove()} aria-label="Desvincular" />
        ) : null}
      </div>
      {stats === null ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mt-4">
            <Metric icon={<Users className="size-4" />} label="Jogando agora" value={last?.playing != null ? formatNumber(last.playing) : '—'} accent />
            <Metric icon={<Eye className="size-4" />} label="Visitas totais" value={last?.visits != null ? formatCompact(last.visits) : '—'} />
            <Metric icon={<Star className="size-4" />} label="Favoritos" value={last?.favorites != null ? formatCompact(last.favorites) : '—'} />
          </div>
          <p className="text-[12px] text-fg-3 mt-2">
            {last ? (
              <>
                Origem: <b className="text-fg-2">{last.source}</b> · coletado {formatRelative(last.fetched_at)} ({formatDate(last.fetched_at)} {formatTime(last.fetched_at)})
              </>
            ) : (
              'Ainda sem coletas. Toque em Atualizar.'
            )}
          </p>
          <div className="mt-4">
            <div className="text-[13px] font-medium text-fg-2 mb-1">Jogadores online (coletas do NEXUS)</div>
            <Sparkline points={(stats ?? []).filter((s) => s.playing != null).map((s) => ({ t: s.fetched_at, v: s.playing! }))} />
          </div>
        </>
      )}
    </Card>
  );
}

function Metric({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-line-soft bg-[#11161f] p-3">
      <div className="text-[12px] text-fg-3 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${accent ? 'text-success' : ''}`}>{value}</div>
    </div>
  );
}

export function RobloxView({ serverId }: { serverId: string | null }) {
  const servers = useApp((s) => s.servers);
  const sid = serverId ?? servers[0]?.id ?? null;
  const experiences = useApp((s) => (sid ? s.robloxExperiences[sid] : undefined)) ?? [];
  const perms = useApp((s) => (sid ? s.myPerms[sid] : undefined));
  const projects = useApp((s) => (sid ? s.projects[sid] : undefined)) ?? [];
  const me = useSession((s) => s.userId);
  const [adding, setAdding] = useState(false);
  const [placeId, setPlaceId] = useState('');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = hasPerm(perms, 'manage_projects');

  const reload = useCallback(async () => {
    if (!sid) return;
    const { data } = await sb().from('roblox_experiences').select('*').eq('server_id', sid).order('created_at');
    useApp.getState().setRobloxExperiences(sid, (data ?? []) as RobloxExperience[]);
  }, [sid]);

  useEffect(() => {
    if (sid) void useApp.getState().loadServer(sid);
  }, [sid]);

  const add = async () => {
    if (!sid) return;
    setBusy(true);
    try {
      const info = await callFunction<{ universe_id: number; root_place_id: number | null; name: string | null }>('roblox', {
        action: 'resolve',
        place_id: Number(placeId),
      });
      const { error } = await sb()
        .from('roblox_experiences')
        .insert({ server_id: sid, universe_id: info.universe_id, root_place_id: info.root_place_id, name: info.name, project_id: project || null, added_by: me });
      if (error) throw error;
      await callFunction('roblox', { action: 'refresh', universe_ids: [info.universe_id] }).catch(() => undefined);
      await reload();
      setAdding(false);
      setPlaceId('');
      toast.success('Jogo vinculado', info.name ?? undefined);
    } catch (err) {
      toast.error(err, 'Não foi possível vincular');
    } finally {
      setBusy(false);
    }
  };

  if (!sid) {
    return <EmptyState className="flex-1" icon={<BarChart3 className="size-10" />} title="Entre em um servidor primeiro">Os jogos são vinculados a um servidor (a sua equipe).</EmptyState>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<BarChart3 className="size-5" />}
        title="Faturamento Roblox"
        subtitle="Métricas reais dos seus jogos, com origem e horário"
        actions={
          canManage ? (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              <span className="hidden sm:inline">Vincular jogo</span>
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-y-auto nx-scroll">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
          {experiences.length === 0 ? (
            <EmptyState
              icon={<Link2 className="size-10" />}
              title="Nenhum jogo vinculado"
              action={canManage ? <Button onClick={() => setAdding(true)}>Vincular pelo Place ID</Button> : null}
            >
              Informe o Place ID do jogo (o número no link roblox.com/games/<b>123456</b>/…). O NEXUS busca o nome, os jogadores online e as visitas pela API pública do Roblox.
            </EmptyState>
          ) : (
            experiences.map((e) => <ExperienceCard key={e.id} exp={e} canManage={canManage} onRemoved={() => void reload()} />)
          )}

          <Card className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="size-5 text-warn shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold">Robux ganhos, receita e saldo</h3>
                <p className="text-sm text-fg-2 mt-1">
                  Esses números <b>não</b> aparecem aqui ainda porque dependem de uma integração oficial com a sua conta Roblox (OAuth 2.0 / Open Cloud) com as
                  permissões certas. O NEXUS não pede sua senha e não usa cookies da sua sessão. Enquanto isso, registre os valores recebidos em <b>Finanças</b>.
                </p>
                <p className="text-[12px] text-fg-3 mt-2 flex items-center gap-1.5">
                  <Info className="size-3.5" /> Detalhes e o que cada API do Roblox permite: docs/ROBLOX.md
                </p>
              </div>
            </div>
          </Card>
          <Notice tone="info">Visitas e jogadores online são públicos no Roblox. Os dados de receita, quando conectados, ficarão visíveis só para você.</Notice>
        </div>
      </div>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Vincular jogo do Roblox"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void add()} loading={busy} disabled={!placeId}>
              Vincular
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Place ID" hint="Abra o jogo no site do Roblox e copie o número do endereço.">
            <Input value={placeId} onChange={(e) => setPlaceId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="1234567890" />
          </Field>
          <Field label="Projeto (opcional)">
            <Select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Nenhum</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
