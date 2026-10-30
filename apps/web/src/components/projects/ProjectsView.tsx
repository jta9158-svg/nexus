import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bug, CalendarDays, Gamepad2, History, Lightbulb, ListChecks, Plus, Rocket, Trash2, User } from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { onTable } from '../../lib/bus';
import { formatDate, formatRelative } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import type { ActivityRow, Project, ProjectTask, ProjectVersion, TaskKind, TaskPriority, TaskStatus } from '../../types/db';
import { Avatar, Badge, Button, Card, cx, EmptyState, Field, Input, Modal, Select, Spinner, Tabs, Textarea } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

const COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: 'a_fazer', label: 'A fazer' },
  { key: 'em_andamento', label: 'Em andamento' },
  { key: 'em_revisao', label: 'Em revisão' },
  { key: 'concluida', label: 'Concluída' },
];

const PRIORITY: Record<TaskPriority, { label: string; tone: 'neutral' | 'accent' | 'warn' | 'danger' }> = {
  baixa: { label: 'Baixa', tone: 'neutral' },
  media: { label: 'Média', tone: 'accent' },
  alta: { label: 'Alta', tone: 'warn' },
  critica: { label: 'Crítica', tone: 'danger' },
};

const KIND_ICON: Record<TaskKind, React.ReactNode> = {
  tarefa: <ListChecks className="size-3.5" />,
  bug: <Bug className="size-3.5" />,
  melhoria: <Lightbulb className="size-3.5" />,
};

const PROJECT_STATUS: Record<Project['status'], string> = {
  planejamento: 'Planejamento',
  ativo: 'Ativo',
  pausado: 'Pausado',
  lancado: 'Lançado',
  arquivado: 'Arquivado',
};

function ProjectModal({ serverId, project, open, onClose }: { serverId: string; project?: Project | null; open: boolean; onClose: () => void }) {
  const me = useSession((s) => s.userId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Project['status']>('ativo');
  const [placeId, setPlaceId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
    setStatus(project?.status ?? 'ativo');
    setPlaceId(project?.roblox_place_id ? String(project.roblox_place_id) : '');
  }, [open, project]);

  const save = async () => {
    setBusy(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      status,
      roblox_place_id: placeId ? Number(placeId) : null,
    };
    const res = project
      ? await sb().from('projects').update(payload).eq('id', project.id).select('*').single()
      : await sb().from('projects').insert({ ...payload, server_id: serverId, created_by: me }).select('*').single();
    setBusy(false);
    if (res.error) return toast.error(res.error);
    const list = useApp.getState().projects[serverId] ?? [];
    const row = res.data as Project;
    useApp.getState().setProjects(serverId, project ? list.map((p) => (p.id === row.id ? row : p)) : [...list, row]);
    useApp.getState().openView({ kind: 'projects', serverId, projectId: row.id });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Editar projeto' : 'Novo projeto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ALPHA — Templo da Magia" maxLength={80} />
        </Field>
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Situação">
            <Select value={status} onChange={(e) => setStatus(e.target.value as Project['status'])}>
              {Object.entries(PROJECT_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Place ID do Roblox (opcional)" hint="Número que aparece no link do jogo.">
            <Input value={placeId} onChange={(e) => setPlaceId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="1234567890" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TaskModal({
  project,
  task,
  open,
  onClose,
  canManage,
}: {
  project: Project;
  task?: ProjectTask | null;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
}) {
  const me = useSession((s) => s.userId);
  const members = useApp((s) => s.members[project.server_id]) ?? [];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<TaskKind>('tarefa');
  const [priority, setPriority] = useState<TaskPriority>('media');
  const [status, setStatus] = useState<TaskStatus>('a_fazer');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setKind(task?.kind ?? 'tarefa');
    setPriority(task?.priority ?? 'media');
    setStatus(task?.status ?? 'a_fazer');
    setAssignee(task?.assignee_id ?? '');
    setDue(task?.due_date ?? '');
  }, [open, task]);

  const save = async () => {
    setBusy(true);
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      kind,
      priority,
      status,
      assignee_id: assignee || null,
      due_date: due || null,
    };
    const res = task
      ? await sb().from('project_tasks').update(payload).eq('id', task.id)
      : await sb().from('project_tasks').insert({ ...payload, project_id: project.id, server_id: project.server_id, created_by: me });
    setBusy(false);
    if (res.error) return toast.error(res.error);
    onClose();
  };

  const remove = async () => {
    if (!task || !confirm(`Excluir "${task.title}"?`)) return;
    const { error } = await sb().from('project_tasks').delete().eq('id', task.id);
    if (error) return toast.error(error);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Editar item' : 'Novo item'}
      size="lg"
      footer={
        <>
          {task && canManage ? (
            <Button variant="ghost" className="mr-auto !text-danger" icon={<Trash2 className="size-4" />} onClick={() => void remove()}>
              Excluir
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!title.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Revisar mapa inicial" />
        </Field>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
              <option value="tarefa">Tarefa</option>
              <option value="bug">Bug</option>
              <option value="melhoria">Melhoria</option>
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {Object.entries(PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
              <option value="cancelada">Cancelada</option>
            </Select>
          </Field>
          <Field label="Responsável">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!canManage}>
              <option value="">Ninguém</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {displayNameFor(m.user_id, project.server_id)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prazo">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Passos para reproduzir, critérios de pronto, referências…" />
        </Field>
      </div>
    </Modal>
  );
}

function TaskCard({ t, onOpen, onMove, canEdit }: { t: ProjectTask; onOpen: () => void; onMove: (s: TaskStatus) => void; canEdit: boolean }) {
  const profile = useApp((s) => (t.assignee_id ? s.profiles[t.assignee_id] : undefined));
  const overdue = t.due_date && t.status !== 'concluida' && new Date(t.due_date + 'T23:59:59') < new Date();
  return (
    <div className="rounded-xl border border-line bg-[#151a24] p-3 hover:border-[#33405a] transition-colors">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Badge tone={t.kind === 'bug' ? 'danger' : t.kind === 'melhoria' ? 'violet' : 'neutral'}>
            {KIND_ICON[t.kind]} {t.kind === 'bug' ? 'Bug' : t.kind === 'melhoria' ? 'Melhoria' : 'Tarefa'}
          </Badge>
          <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
          {t.created_by_kind === 'claude' ? <Badge tone="violet">Claude</Badge> : null}
        </div>
        <div className="text-[14px] text-fg leading-snug">{t.title}</div>
      </button>
      <div className="flex items-center gap-2 mt-2.5 text-[12px] text-fg-3">
        {t.assignee_id ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={18} />
            <span className="truncate">{profile?.display_name}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <User className="size-3.5" /> Sem responsável
          </span>
        )}
        {t.due_date ? (
          <span className={cx('flex items-center gap-1 ml-auto', overdue && 'text-danger')}>
            <CalendarDays className="size-3.5" /> {formatDate(t.due_date + 'T12:00:00')}
          </span>
        ) : null}
      </div>
      {canEdit ? (
        <select
          value={t.status}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="mt-2 w-full h-7 rounded-md bg-[#0d1118] border border-line text-[12px] text-fg-2 px-1.5"
          aria-label="Mover para"
        >
          {COLUMNS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
          <option value="cancelada">Cancelada</option>
        </select>
      ) : null}
    </div>
  );
}

export function ProjectsView({ serverId, projectId }: { serverId: string; projectId?: string | null }) {
  const projects = useApp((s) => s.projects[serverId]) ?? [];
  const perms = useApp((s) => s.myPerms[serverId]);
  const openView = useApp((s) => s.openView);
  const me = useSession((s) => s.userId);
  const canManage = hasPerm(perms, 'manage_projects');
  const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [tab, setTab] = useState<'quadro' | 'bugs' | 'versoes' | 'historico'>('quadro');
  const [projModal, setProjModal] = useState<{ open: boolean; edit: boolean }>({ open: false, edit: false });
  const [taskModal, setTaskModal] = useState<{ open: boolean; task: ProjectTask | null }>({ open: false, task: null });
  const [newVersion, setNewVersion] = useState('');

  const load = useCallback(async () => {
    if (!project) return;
    const [t, v, a] = await Promise.all([
      sb().from('project_tasks').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      sb().from('project_versions').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      sb().from('activity_log').select('*').eq('project_id', project.id).order('created_at', { ascending: false }).limit(100),
    ]);
    setTasks((t.data ?? []) as ProjectTask[]);
    setVersions((v.data ?? []) as ProjectVersion[]);
    setActivity((a.data ?? []) as ActivityRow[]);
    void useApp.getState().ensureProfiles([...(a.data ?? []).map((x) => (x as ActivityRow).actor_id)]);
  }, [project]);

  useEffect(() => {
    setTasks(null);
    void load();
  }, [load]);

  useEffect(
    () =>
      onTable('project_tasks', (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as unknown as ProjectTask;
        if (!project || (row.project_id && row.project_id !== project.id)) return;
        if (p.eventType === 'DELETE') setTasks((cur) => cur?.filter((t) => t.id !== row.id) ?? cur);
        else setTasks((cur) => (cur ? (cur.some((t) => t.id === row.id) ? cur.map((t) => (t.id === row.id ? row : t)) : [row, ...cur]) : cur));
        void sb()
          .from('activity_log')
          .select('*')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false })
          .limit(100)
          .then(({ data }) => setActivity((data ?? []) as ActivityRow[]));
      }),
    [project],
  );

  const move = async (t: ProjectTask, status: TaskStatus) => {
    setTasks((cur) => cur?.map((x) => (x.id === t.id ? { ...x, status } : x)) ?? cur);
    const { error } = await sb().from('project_tasks').update({ status }).eq('id', t.id);
    if (error) {
      toast.error(error);
      void load();
    }
  };

  const stats = useMemo(() => {
    const list = tasks ?? [];
    const open = list.filter((t) => t.status !== 'concluida' && t.status !== 'cancelada');
    return {
      open: open.length,
      bugs: open.filter((t) => t.kind === 'bug').length,
      done: list.filter((t) => t.status === 'concluida').length,
      total: list.filter((t) => t.status !== 'cancelada').length,
    };
  }, [tasks]);

  const addVersion = async () => {
    if (!project || !newVersion.trim()) return;
    const { error } = await sb().from('project_versions').insert({ project_id: project.id, server_id: serverId, version: newVersion.trim(), created_by: me });
    if (error) return toast.error(error);
    setNewVersion('');
    void load();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<Gamepad2 className="size-5" />}
        title="Projetos"
        subtitle={project ? project.name : 'Desenvolvimento de jogos'}
        actions={
          canManage ? (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setProjModal({ open: true, edit: false })}>
              <span className="hidden sm:inline">Novo projeto</span>
            </Button>
          ) : null
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={<Gamepad2 className="size-10" />}
          title="Nenhum projeto ainda"
          action={canManage ? <Button onClick={() => setProjModal({ open: true, edit: false })}>Criar projeto</Button> : null}
        >
          Crie um projeto para organizar tarefas, bugs, versões e arquivos do jogo — por exemplo, o ALPHA — Templo da Magia.
        </EmptyState>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 sm:px-6 pt-4 flex items-center gap-2 overflow-x-auto nx-scroll shrink-0">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => openView({ kind: 'projects', serverId, projectId: p.id })}
                className={cx(
                  'h-9 px-3.5 rounded-xl text-sm whitespace-nowrap border transition-colors',
                  project?.id === p.id ? 'border-accent bg-accent/12 text-fg' : 'border-line text-fg-2 hover:text-fg',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          {project ? (
            <div className="flex-1 min-h-0 overflow-y-auto nx-scroll px-4 sm:px-6 py-4 space-y-4">
              <Card className="p-4 flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold truncate">{project.name}</h2>
                    <Badge tone={project.status === 'ativo' ? 'success' : project.status === 'lancado' ? 'accent' : 'neutral'}>{PROJECT_STATUS[project.status]}</Badge>
                  </div>
                  {project.description ? <p className="text-sm text-fg-2 mt-1">{project.description}</p> : null}
                  {project.roblox_place_id ? <p className="text-xs text-fg-3 mt-1">Place ID: {project.roblox_place_id}</p> : null}
                </div>
                <div className="flex gap-5 text-center">
                  <div>
                    <div className="text-xl font-bold tabular-nums">{stats.open}</div>
                    <div className="text-[12px] text-fg-3">abertos</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold tabular-nums text-danger">{stats.bugs}</div>
                    <div className="text-[12px] text-fg-3">bugs</div>
                  </div>
                  <div>
                    <div className="text-xl font-bold tabular-nums text-success">
                      {stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%
                    </div>
                    <div className="text-[12px] text-fg-3">concluído</div>
                  </div>
                </div>
                {canManage ? (
                  <Button size="sm" variant="secondary" onClick={() => setProjModal({ open: true, edit: true })}>
                    Editar
                  </Button>
                ) : null}
              </Card>

              <div className="flex items-center justify-between gap-2">
                <Tabs
                  value={tab}
                  onChange={setTab}
                  items={[
                    { value: 'quadro', label: 'Quadro' },
                    { value: 'bugs', label: 'Bugs e melhorias' },
                    { value: 'versoes', label: 'Versões' },
                    { value: 'historico', label: 'Histórico' },
                  ]}
                />
                {canManage ? (
                  <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setTaskModal({ open: true, task: null })}>
                    Item
                  </Button>
                ) : null}
              </div>

              {tasks === null ? (
                <div className="flex justify-center py-10">
                  <Spinner className="size-6" />
                </div>
              ) : tab === 'quadro' ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {COLUMNS.map((col) => {
                    const items = tasks.filter((t) => t.status === col.key);
                    return (
                      <div key={col.key} className="rounded-2xl bg-[#0f1319] border border-line-soft p-2.5 min-h-[120px]">
                        <div className="flex items-center justify-between px-1 pb-2">
                          <span className="text-[13px] font-semibold text-fg-2">{col.label}</span>
                          <span className="text-[12px] text-fg-3">{items.length}</span>
                        </div>
                        <div className="space-y-2">
                          {items.map((t) => (
                            <TaskCard
                              key={t.id}
                              t={t}
                              canEdit={canManage || t.assignee_id === me}
                              onOpen={() => setTaskModal({ open: true, task: t })}
                              onMove={(s) => void move(t, s)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : tab === 'bugs' ? (
                <Card className="divide-y divide-line-soft">
                  {tasks.filter((t) => t.kind !== 'tarefa').length === 0 ? (
                    <p className="p-6 text-sm text-fg-3 text-center">Nenhum bug ou melhoria registrado.</p>
                  ) : (
                    tasks
                      .filter((t) => t.kind !== 'tarefa')
                      .map((t) => (
                        <button key={t.id} onClick={() => setTaskModal({ open: true, task: t })} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised/40">
                          <Badge tone={t.kind === 'bug' ? 'danger' : 'violet'}>{KIND_ICON[t.kind]}</Badge>
                          <span className={cx('flex-1 text-sm', t.status === 'concluida' && 'line-through text-fg-3')}>{t.title}</span>
                          <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                          <span className="text-[12px] text-fg-3 w-28 text-right">{COLUMNS.find((c) => c.key === t.status)?.label ?? 'Cancelada'}</span>
                        </button>
                      ))
                  )}
                </Card>
              ) : tab === 'versoes' ? (
                <Card className="p-4">
                  {canManage ? (
                    <div className="flex gap-2 mb-4">
                      <Input value={newVersion} onChange={(e) => setNewVersion(e.target.value)} placeholder="Ex.: 0.9.0 — sistema de combate" />
                      <Button icon={<Rocket className="size-4" />} onClick={() => void addVersion()} disabled={!newVersion.trim()}>
                        Registrar
                      </Button>
                    </div>
                  ) : null}
                  {versions.length === 0 ? (
                    <p className="text-sm text-fg-3">Nenhuma versão registrada.</p>
                  ) : (
                    <ul className="space-y-2">
                      {versions.map((v) => (
                        <li key={v.id} className="flex items-center gap-3 text-sm">
                          <Badge tone={v.status === 'publicada' ? 'success' : 'neutral'}>{v.status.replace('_', ' ')}</Badge>
                          <span className="font-medium">{v.version}</span>
                          <span className="text-fg-3 ml-auto">{formatDate(v.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ) : (
                <Card className="p-4">
                  {activity.length === 0 ? (
                    <p className="text-sm text-fg-3">Sem alterações registradas.</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {activity.map((a) => (
                        <li key={a.id} className="flex items-start gap-3 text-sm">
                          <History className="size-4 text-fg-3 mt-0.5 shrink-0" />
                          <span className="flex-1">
                            <b className="text-fg">{a.actor_kind === 'claude' ? 'Claude' : a.actor_kind === 'system' ? 'Sistema' : displayNameFor(a.actor_id, serverId)}</b>{' '}
                            <span className="text-fg-2">{a.summary}</span>
                          </span>
                          <span className="text-[12px] text-fg-3 shrink-0">{formatRelative(a.created_at)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              )}
            </div>
          ) : null}
        </div>
      )}
      <ProjectModal serverId={serverId} project={projModal.edit ? project : null} open={projModal.open} onClose={() => setProjModal({ open: false, edit: false })} />
      {project ? (
        <TaskModal
          project={project}
          task={taskModal.task}
          open={taskModal.open}
          canManage={canManage}
          onClose={() => {
            setTaskModal({ open: false, task: null });
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
