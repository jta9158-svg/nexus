import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Gamepad2,
  LayoutDashboard,
  Plus,
  Server as ServerIcon,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useClaudeVisible, useSession } from '../../store/session';
import { useCompanion } from '../../store/companion';
import { sb, currentConfig } from '../../lib/supabase';
import { onConnectionChange } from '../../lib/realtime';
import { desktop, isDesktop } from '../../lib/platform';
import { formatRelative } from '../../lib/format';
import { APP_VERSION } from '../../config';
import type { ActivityRow, Project, ProjectTask, RobloxStat } from '../../types/db';
import { Badge, Button, Card, cx, EmptyState, ProgressBar, SectionTitle, Toggle, Modal } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

type Widget = 'projetos' | 'tarefas' | 'duvidas' | 'notificacoes' | 'integracoes' | 'atividade' | 'jogadores';

const WIDGETS: Array<{ key: Widget; label: string }> = [
  { key: 'projetos', label: 'Estado dos projetos' },
  { key: 'jogadores', label: 'Jogadores online' },
  { key: 'tarefas', label: 'Tarefas da NEXUS IA' },
  { key: 'duvidas', label: 'Dúvidas pendentes da NEXUS IA' },
  { key: 'notificacoes', label: 'Notificações importantes' },
  { key: 'integracoes', label: 'Estado das integrações' },
  { key: 'atividade', label: 'Atividade recente' },
];

export function OverviewView() {
  const me = useSession((s) => s.me);
  const userId = useSession((s) => s.userId);
  const servers = useApp((s) => s.servers);
  const notifications = useApp((s) => s.notifications);
  const quota = useApp((s) => s.claudeQuota);
  const setModal = useApp((s) => s.setModal);
  const openView = useApp((s) => s.openView);
  const companion = useCompanion();
  const [projects, setProjects] = useState<Array<Project & { open: number; done: number; total: number; bugs: number }>>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [players, setPlayers] = useState<RobloxStat[]>([]);
  const [realtimeOk, setRealtimeOk] = useState(false);
  const [hidden, setHidden] = useState<Widget[]>([]);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => onConnectionChange(setRealtimeOk), []);

  useEffect(() => {
    if (!companion.loaded) void companion.load();
    void (async () => {
      const [p, t, a, settings] = await Promise.all([
        sb().from('projects').select('*').neq('status', 'arquivado').order('updated_at', { ascending: false }).limit(12),
        sb().from('project_tasks').select('project_id, status, kind').limit(5000),
        sb().from('activity_log').select('*').order('created_at', { ascending: false }).limit(15),
        sb().from('user_settings').select('data').maybeSingle(),
      ]);
      const tasks = (t.data ?? []) as Array<Pick<ProjectTask, 'project_id' | 'status' | 'kind'>>;
      setProjects(
        ((p.data ?? []) as Project[]).map((proj) => {
          const mine = tasks.filter((x) => x.project_id === proj.id && x.status !== 'cancelada');
          return {
            ...proj,
            total: mine.length,
            done: mine.filter((x) => x.status === 'concluida').length,
            open: mine.filter((x) => x.status !== 'concluida').length,
            bugs: mine.filter((x) => x.kind === 'bug' && x.status !== 'concluida').length,
          };
        }),
      );
      const acts = (a.data ?? []) as ActivityRow[];
      setActivity(acts);
      void useApp.getState().ensureProfiles(acts.map((x) => x.actor_id));
      const h = (settings.data?.data as { overview_hidden?: Widget[] } | undefined)?.overview_hidden;
      if (Array.isArray(h)) setHidden(h);

      const { data: exps } = await sb().from('roblox_experiences').select('universe_id');
      const ids = Array.from(new Set((exps ?? []).map((e) => (e as { universe_id: number }).universe_id)));
      const latest: RobloxStat[] = [];
      for (const id of ids.slice(0, 6)) {
        const { data } = await sb().from('roblox_stats').select('*').eq('universe_id', id).order('fetched_at', { ascending: false }).limit(1).maybeSingle();
        if (data) latest.push(data as RobloxStat);
      }
      setPlayers(latest);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWidget = async (w: Widget, show: boolean) => {
    const next = show ? hidden.filter((x) => x !== w) : [...hidden, w];
    setHidden(next);
    const { data } = await sb().from('user_settings').select('data').maybeSingle();
    await sb()
      .from('user_settings')
      .upsert({ user_id: userId, data: { ...((data?.data as object) ?? {}), overview_hidden: next } });
  };

  const claudeVisible = useClaudeVisible();
  const members = useApp((s) => s.members);
  const show = (w: Widget) => !hidden.includes(w) && (claudeVisible || (w !== 'duvidas' && w !== 'tarefas'));
  const pendingQ = companion.questions.filter((q) => q.status === 'pendente');
  const activeTasks = companion.tasks.filter((t) => ['executando', 'aguardando', 'aguardando_confirmacao', 'bloqueada'].includes(t.status));
  const important = notifications.filter((n) => !n.read_at).slice(0, 5);
  const cfg = currentConfig();

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<LayoutDashboard className="size-5" />}
        title="Visão geral"
        subtitle={`Olá, ${me?.display_name ?? ''}`}
        actions={
          <Button size="sm" variant="ghost" icon={<SlidersHorizontal className="size-4" />} onClick={() => setCustomizing(true)}>
            <span className="hidden sm:inline">Personalizar</span>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto nx-scroll">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
          {servers.length === 0 ? (
            <Card className="p-6 sm:p-8 relative overflow-hidden">
              <div className="absolute inset-0 opacity-60 pointer-events-none" style={{ background: 'radial-gradient(40rem 20rem at 0% 0%, rgb(91 124 255 / 0.18), transparent 60%)' }} />
              <div className="relative">
                <h2 className="text-2xl font-bold">Bem-vindo ao NEXUS!</h2>
                <p className="text-fg-2 mt-1.5 max-w-xl">Crie o servidor da sua equipe (por exemplo, “ALPHA — Templo da Magia”) ou entre em um com um convite.</p>
                <div className="flex flex-wrap gap-2 mt-5">
                  <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'createServer' })}>
                    Criar servidor
                  </Button>
                  <Button variant="secondary" onClick={() => setModal({ kind: 'joinServer' })}>
                    Entrar com convite
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <QuickStat icon={<ServerIcon className="size-4" />} label="Servidores" value={servers.length} />
            <QuickStat icon={<Gamepad2 className="size-4" />} label="Projetos ativos" value={projects.filter((p) => p.status === 'ativo').length} />
            {claudeVisible ? (
              <QuickStat icon={<Sparkles className="size-4" />} label="Tarefas da NEXUS IA" value={activeTasks.length} onClick={() => openView({ kind: 'companion' })} />
            ) : (
              <QuickStat icon={<Users className="size-4" />} label="Pessoas nos servidores" value={new Set(Object.values(members).flat().map((m) => m.user_id)).size} />
            )}
            <QuickStat icon={<Bell className="size-4" />} label="Notificações novas" value={notifications.filter((n) => !n.read_at).length} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              {show('projetos') ? (
                <Card className="p-4 sm:p-5">
                  <SectionTitle>Estado dos projetos</SectionTitle>
                  {projects.length === 0 ? (
                    <p className="text-sm text-fg-3">Nenhum projeto visível. Crie um em “Projetos” dentro do servidor.</p>
                  ) : (
                    <div className="space-y-3">
                      {projects.map((p) => (
                        <button key={p.id} onClick={() => openView({ kind: 'projects', serverId: p.server_id, projectId: p.id })} className="w-full text-left">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="font-medium truncate">{p.name}</span>
                            <Badge tone={p.status === 'ativo' ? 'success' : 'neutral'}>{p.status}</Badge>
                            <span className="ml-auto text-[12px] text-fg-3">
                              {p.open} abertos · {p.bugs} bugs
                            </span>
                          </div>
                          <ProgressBar value={p.total ? (p.done / p.total) * 100 : 0} tone="success" />
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ) : null}

              {show('jogadores') ? (
                <Card className="p-4 sm:p-5">
                  <SectionTitle>Jogadores online</SectionTitle>
                  {players.length === 0 ? (
                    <p className="text-sm text-fg-3">Vincule um jogo em “Faturamento Roblox” para acompanhar jogadores e visitas.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {players.map((s) => (
                        <div key={s.id} className="rounded-xl border border-line-soft bg-[#11161f] p-3">
                          <div className="text-sm font-medium truncate">{s.name ?? `Universo ${s.universe_id}`}</div>
                          <div className="text-2xl font-bold text-success tabular-nums mt-1">{s.playing ?? '—'}</div>
                          <div className="text-[12px] text-fg-3">
                            jogando · {s.source} · {formatRelative(s.fetched_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ) : null}

              {show('atividade') ? (
                <Card className="p-4 sm:p-5">
                  <SectionTitle>Atividade recente</SectionTitle>
                  {activity.length === 0 ? (
                    <p className="text-sm text-fg-3">Nada por enquanto.</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {activity.map((a) => (
                        <li key={a.id} className="flex items-start gap-2.5 text-sm">
                          <Activity className="size-4 text-fg-3 mt-0.5 shrink-0" />
                          <span className="flex-1">
                            <b>{a.actor_kind === 'claude' ? 'NEXUS IA' : a.actor_kind === 'system' ? 'Sistema' : displayNameFor(a.actor_id)}</b>{' '}
                            <span className="text-fg-2">{a.summary}</span>
                          </span>
                          <span className="text-[12px] text-fg-3 shrink-0">{formatRelative(a.created_at)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              ) : null}
            </div>

            <div className="space-y-4">
              {show('duvidas') ? (
                <Card className="p-4">
                  <SectionTitle>Dúvidas da NEXUS IA</SectionTitle>
                  {pendingQ.length === 0 ? (
                    <p className="text-sm text-fg-3">Nenhuma decisão pendente.</p>
                  ) : (
                    <div className="space-y-2">
                      {pendingQ.slice(0, 4).map((q) => (
                        <button key={q.id} onClick={() => openView({ kind: 'companion' })} className="w-full text-left rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-sm">
                          {q.question}
                        </button>
                      ))}
                    </div>
                  )}
                </Card>
              ) : null}

              {show('tarefas') ? (
                <Card className="p-4">
                  <SectionTitle>Tarefas em andamento</SectionTitle>
                  {activeTasks.length === 0 ? (
                    <p className="text-sm text-fg-3">A NEXUS IA não está trabalhando em nada agora.</p>
                  ) : (
                    <div className="space-y-3">
                      {activeTasks.slice(0, 5).map((t) => (
                        <div key={t.id}>
                          <div className="flex justify-between text-sm gap-2">
                            <span className="truncate">{t.title}</span>
                            <span className="text-fg-3 tabular-nums">{t.progress}%</span>
                          </div>
                          <ProgressBar value={t.progress} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ) : null}

              {show('notificacoes') ? (
                <Card className="p-4">
                  <SectionTitle>Notificações</SectionTitle>
                  {important.length === 0 ? (
                    <p className="text-sm text-fg-3">Tudo em dia.</p>
                  ) : (
                    <ul className="space-y-2">
                      {important.map((n) => (
                        <li key={n.id} className="text-sm">
                          <div className="text-fg">{n.title}</div>
                          {n.body ? <div className="text-fg-3 text-[12.5px] truncate">{n.body}</div> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ) : null}

              {show('integracoes') ? (
                <Card className="p-4">
                  <SectionTitle>Integrações</SectionTitle>
                  <ul className="space-y-2 text-sm">
                    <Integration ok label="Servidor NEXUS (Supabase)" detail={cfg ? new URL(cfg.supabaseUrl).host : '—'} />
                    <Integration ok={realtimeOk} label="Tempo real" detail={realtimeOk ? 'Conectado' : 'Reconectando…'} />
                    <Integration ok={!!quota?.allowed} label="NEXUS IA (API da Anthropic)" detail={quota?.allowed ? 'Liberada' : quota?.reason ?? 'Sem acesso'} />
                    <Integration ok={null} label="Calls (LiveKit)" detail="Verificado ao entrar em uma call" />
                    <Integration ok={players.length > 0 ? true : null} label="Roblox (dados públicos)" detail={players.length ? `${players.length} jogo(s)` : 'Nenhum jogo vinculado'} />
                    <Integration ok={false} label="Roblox (receita)" detail="Requer OAuth oficial — próxima fase" />
                    {isDesktop ? <Integration ok label="App para Windows" detail={`v${desktop?.version ?? APP_VERSION}`} /> : null}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>
          {servers.length && projects.length === 0 && activity.length === 0 ? (
            <EmptyState icon={<Users className="size-8" />} title="Sua equipe está pronta">
              Convide as pessoas pelo menu do servidor e comece a organizar o ALPHA por aqui.
            </EmptyState>
          ) : null}
        </div>
      </div>
      <Modal open={customizing} onClose={() => setCustomizing(false)} title="Personalizar a visão geral" description="Escolha o que aparece na sua tela inicial.">
        <div className="divide-y divide-line-soft">
          {WIDGETS.map((w) => (
            <Toggle key={w.key} checked={show(w.key)} onChange={(v) => void toggleWidget(w.key, v)} label={w.label} />
          ))}
        </div>
      </Modal>
    </div>
  );
}

function QuickStat({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: number; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={cx('text-left rounded-[14px] border border-line bg-card p-4', onClick && 'hover:border-[#33405a]')}>
      <div className="text-[12px] text-fg-3 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value}</div>
    </button>
  );
}

function Integration({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok === true ? (
        <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" />
      ) : ok === false ? (
        <CircleAlert className="size-4 text-warn mt-0.5 shrink-0" />
      ) : (
        <Cloud className="size-4 text-fg-3 mt-0.5 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="block text-[12px] text-fg-3 truncate">{detail}</span>
      </span>
    </li>
  );
}

void BarChart3;
