import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Download,
  Hand,
  ListTodo,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCompanion, COMPANION_SCOPES, MODES, scopeAvailable } from '../../store/companion';
import { useSession } from '../../store/session';
import { useApp } from '../../store/app';
import { sb } from '../../lib/supabase';
import { formatDate, formatRelative, formatTime } from '../../lib/format';
import type { CompanionTask, CompanionTaskStatus, Project } from '../../types/db';
import { Badge, Button, Card, ClaudeAvatar, cx, EmptyState, Field, Input, Modal, Notice, ProgressBar, Select, Spinner, Tabs, Textarea, Toggle } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

const STATUS: Record<CompanionTaskStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'violet'; icon: React.ReactNode }> = {
  aguardando: { label: 'Aguardando', tone: 'neutral', icon: <Clock className="size-3.5" /> },
  executando: { label: 'Executando', tone: 'accent', icon: <Loader2 className="size-3.5 animate-spin" /> },
  aguardando_confirmacao: { label: 'Aguardando confirmação', tone: 'warn', icon: <Hand className="size-3.5" /> },
  bloqueada: { label: 'Bloqueada', tone: 'warn', icon: <Pause className="size-3.5" /> },
  concluida: { label: 'Concluída', tone: 'success', icon: <CheckCircle2 className="size-3.5" /> },
  falhou: { label: 'Falhou', tone: 'danger', icon: <AlertTriangle className="size-3.5" /> },
  cancelada: { label: 'Cancelada', tone: 'neutral', icon: <XCircle className="size-3.5" /> },
};

function TaskCard({ t, projects }: { t: CompanionTask; projects: Project[] }) {
  const { action, deleteTask } = useCompanion();
  const [open, setOpen] = useState(false);
  const s = STATUS[t.status];
  const project = projects.find((p) => p.id === t.project_id);
  const active = ['aguardando', 'executando', 'aguardando_confirmacao', 'bloqueada'].includes(t.status);
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={s.tone}>
              {s.icon} {s.label}
            </Badge>
            {t.priority === 'alta' ? <Badge tone="danger">Alta prioridade</Badge> : null}
            {project ? <span className="text-[12px] text-fg-3">{project.name}</span> : null}
          </div>
          <h3 className="text-[15px] font-semibold mt-1.5">{t.title}</h3>
          <p className="text-[12px] text-fg-3">
            Criada {formatRelative(t.created_at)}
            {t.started_at ? ` · iniciada ${formatTime(t.started_at)}` : ''}
            {t.finished_at ? ` · terminou ${formatTime(t.finished_at)}` : ''}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {t.status === 'executando' || t.status === 'aguardando' ? (
            <Button size="sm" variant="secondary" icon={<Pause className="size-3.5" />} onClick={() => void action(t.id, 'pausar')}>
              Pausar
            </Button>
          ) : null}
          {t.status === 'bloqueada' ? (
            <Button size="sm" variant="secondary" icon={<Play className="size-3.5" />} onClick={() => void action(t.id, 'retomar')}>
              Retomar
            </Button>
          ) : null}
          {t.status === 'falhou' || t.status === 'cancelada' ? (
            <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => void action(t.id, 'repetir')}>
              Repetir
            </Button>
          ) : null}
          {active ? (
            <Button size="sm" variant="ghost" onClick={() => confirm('Cancelar esta tarefa?') && void action(t.id, 'cancelar')}>
              Cancelar
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void deleteTask(t.id)} aria-label="Apagar tarefa" />
          )}
        </div>
      </div>
      {active ? (
        <div className="mt-3">
          <ProgressBar value={t.progress} tone={t.status === 'executando' ? 'accent' : 'warn'} />
          <div className="flex justify-between text-[12px] text-fg-3 mt-1">
            <span>{t.blocked_reason || t.progress_note || (t.status === 'aguardando' ? 'Na fila para começar' : 'Trabalhando…')}</span>
            <span className="tabular-nums">{t.progress}%</span>
          </div>
        </div>
      ) : null}
      {t.error ? <Notice tone="danger" className="mt-3">{t.error}</Notice> : null}
      {t.result ? (
        <div className="mt-3">
          <button className="text-[13px] text-mention hover:underline" onClick={() => setOpen(!open)}>
            {open ? 'Esconder resultado' : 'Ver resultado'}
          </button>
          {open ? <div className="mt-2 rounded-xl border border-line bg-[#0d1118] p-3 text-[14px] whitespace-pre-wrap">{t.result}</div> : null}
        </div>
      ) : null}
      <button className="text-[12px] text-fg-3 hover:text-fg-2 mt-2" onClick={() => setOpen(!open)}>
        {open ? '' : 'Ver instruções'}
      </button>
      {open ? <p className="text-[13px] text-fg-2 mt-1 whitespace-pre-wrap">{t.instructions}</p> : null}
    </Card>
  );
}

function NewTaskModal({ open, onClose, projects }: { open: boolean; onClose: () => void; projects: Project[] }) {
  const { createTask, permissions } = useCompanion();
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [project, setProject] = useState('');
  const [priority, setPriority] = useState<'baixa' | 'media' | 'alta'>('media');
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || !instructions.trim()) return;
    setBusy(true);
    const id = await createTask({ title, instructions, projectId: project || null, priority, scopes });
    setBusy(false);
    if (id) {
      setTitle('');
      setInstructions('');
      setScopes([]);
      onClose();
    }
  };

  const missing = scopes.filter((s) => !permissions[s]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova tarefa para o Claude"
      description="Ela roda no servidor: continua mesmo se você fechar o app. O Claude pergunta quando precisar de uma decisão."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!title.trim() || !instructions.trim()}>
            Criar e iniciar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Analisar scripts de combate do ALPHA" maxLength={200} />
        </Field>
        <Field label="O que o Claude deve fazer" hint="Seja específico: objetivo, arquivos envolvidos e o que você espera receber no final.">
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} placeholder="Leia os scripts enviados na pasta Scripts/Combate, encontre bugs e problemas de desempenho e proponha correções. Registre cada bug como tarefa no projeto." />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Projeto">
            <Select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Nenhum</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
            </Select>
          </Field>
        </div>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-fg-2 mb-1.5">Ferramentas que a tarefa pode usar</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {COMPANION_SCOPES.filter((s) => s.available).map((s) => (
              <label key={s.key} className="flex items-start gap-2 rounded-xl border border-line px-3 py-2 cursor-pointer hover:bg-raised/40">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#5b7cff] size-4"
                  checked={scopes.includes(s.key)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s.key] : scopes.filter((x) => x !== s.key))}
                />
                <span>
                  <span className="block text-sm">{s.label}</span>
                  <span className="block text-[12px] text-fg-3">{s.description}</span>
                </span>
              </label>
            ))}
          </div>
          {missing.length ? (
            <Notice tone="warn" className="mt-2">
              Você ainda não concedeu: {missing.map((m) => COMPANION_SCOPES.find((s) => s.key === m)?.label).join(', ')}. A tarefa vai parar e pedir sua autorização quando precisar.
            </Notice>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

export function CompanionView() {
  const store = useCompanion();
  const quota = useApp((s) => s.claudeQuota);
  const voiceReady = useSession((s) => !!s.appSettings?.voice_agent_ready);
  const [tab, setTab] = useState<'tarefas' | 'duvidas' | 'permissoes' | 'historico' | 'modo'>('tarefas');
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!store.loaded) void store.load();
    void sb()
      .from('projects')
      .select('*')
      .order('name')
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, [store.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === 'historico') void store.loadLogs();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = store.questions.filter((q) => q.status === 'pendente');
  const running = store.tasks.filter((t) => t.status === 'executando');
  const waiting = store.tasks.filter((t) => ['aguardando', 'aguardando_confirmacao', 'bloqueada'].includes(t.status));
  const done = store.tasks.filter((t) => ['concluida', 'falhou', 'cancelada'].includes(t.status));
  const granted = COMPANION_SCOPES.filter((s) => store.permissions[s.key]).length;

  const state = useMemo(() => {
    if (running.length) return { label: 'Trabalhando', tone: 'accent' as const, detail: `${running.length} tarefa(s) em execução` };
    if (pending.length) return { label: 'Aguardando você', tone: 'warn' as const, detail: `${pending.length} dúvida(s) pendente(s)` };
    return { label: 'Disponível', tone: 'success' as const, detail: 'Pronto para novas tarefas' };
  }, [running.length, pending.length]);

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(store.logs, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexus-claude-registros-${formatDate(new Date()).replace(/\//g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (!store.loaded) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<Sparkles className="size-5" />}
        title="Claude Companion"
        subtitle="Assistente da equipe: tarefas em segundo plano, dúvidas e permissões"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} disabled={!quota?.allowed}>
            <span className="hidden sm:inline">Nova tarefa</span>
          </Button>
        }
      />
      <div className="flex-1 overflow-y-auto nx-scroll">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
          {/* Estado */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center gap-3">
              <ClaudeAvatar size={42} />
              <div>
                <div className="text-[12px] text-fg-3">Estado</div>
                <div className="font-semibold flex items-center gap-1.5">
                  <span className={cx('size-2 rounded-full', state.tone === 'accent' ? 'bg-accent animate-pulse' : state.tone === 'warn' ? 'bg-warn' : 'bg-success')} />
                  {state.label}
                </div>
                <div className="text-[12px] text-fg-3">{state.detail}</div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[12px] text-fg-3">Modo</div>
              <div className="font-semibold">{MODES.find((m) => m.key === store.settings?.mode)?.label ?? '—'}</div>
              <button className="text-[12px] text-mention hover:underline" onClick={() => setTab('modo')}>
                Alterar
              </button>
            </Card>
            <Card className="p-4">
              <div className="text-[12px] text-fg-3">Voz nas calls</div>
              <div className="font-semibold flex items-center gap-1.5">
                <Mic className={cx('size-4', voiceReady ? 'text-success' : 'text-fg-3')} /> {voiceReady ? 'Disponível' : 'Ainda não ativada'}
              </div>
              <div className="text-[12px] text-fg-3">{voiceReady ? 'Chame pelo botão do robô na call' : 'O administrador ativa o serviço de voz'}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[12px] text-fg-3">Permissões concedidas</div>
              <div className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-success" /> {granted} de {COMPANION_SCOPES.filter((s) => scopeAvailable(s, voiceReady)).length}
              </div>
              <button className="text-[12px] text-mention hover:underline" onClick={() => setTab('permissoes')}>
                Revisar
              </button>
            </Card>
          </div>

          {!quota?.allowed ? <Notice tone="warn" title="O Claude ainda não está liberado para você">{quota?.reason}</Notice> : null}

          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'tarefas', label: 'Tarefas', count: running.length + waiting.length },
              { value: 'duvidas', label: 'Dúvidas', count: pending.length },
              { value: 'permissoes', label: 'Permissões' },
              { value: 'historico', label: 'Histórico' },
              { value: 'modo', label: 'Modo e voz' },
            ]}
          />

          {tab === 'tarefas' ? (
            <div className="space-y-5">
              {store.tasks.length === 0 ? (
                <EmptyState
                  icon={<ListTodo className="size-10" />}
                  title="Nenhuma tarefa ainda"
                  action={
                    <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)} disabled={!quota?.allowed}>
                      Criar tarefa
                    </Button>
                  }
                >
                  Peça algo demorado — o Claude trabalha em segundo plano enquanto você conversa ou joga, e avisa quando terminar.
                </EmptyState>
              ) : null}
              {[{ title: 'Em execução', list: running }, { title: 'Na fila e pausadas', list: waiting }, { title: 'Finalizadas', list: done }].map((g) =>
                g.list.length ? (
                  <section key={g.title}>
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-fg-3 mb-2">{g.title}</h3>
                    <div className="space-y-2.5">
                      {g.list.map((t) => (
                        <TaskCard key={t.id} t={t} projects={projects} />
                      ))}
                    </div>
                  </section>
                ) : null,
              )}
            </div>
          ) : null}

          {tab === 'duvidas' ? (
            <div className="space-y-3">
              {pending.length === 0 ? <EmptyState icon={<CircleDashed className="size-10" />} title="Nenhuma dúvida pendente">Quando o Claude precisar de uma decisão sua, ela aparece aqui e como notificação.</EmptyState> : null}
              {pending.map((q) => {
                const task = store.tasks.find((t) => t.id === q.task_id);
                return (
                  <Card key={q.id} className="p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={q.urgency === 'alta' ? 'danger' : q.urgency === 'media' ? 'warn' : 'neutral'}>Urgência {q.urgency}</Badge>
                      {q.blocking ? <Badge tone="warn">Bloqueia a tarefa</Badge> : <Badge>Não bloqueia</Badge>}
                      {task ? <span className="text-[12px] text-fg-3">Tarefa: {task.title}</span> : null}
                    </div>
                    <p className="mt-2 text-[15px]">{q.question}</p>
                    {q.options.length ? (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {q.options.map((o) => (
                          <Button key={o} size="sm" variant="secondary" onClick={() => void store.answer(q.id, o)}>
                            {o}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex gap-2 mt-3">
                      <Input
                        value={answers[q.id] ?? ''}
                        onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                        placeholder="Escreva sua resposta…"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && answers[q.id]?.trim()) void store.answer(q.id, answers[q.id]);
                        }}
                      />
                      <Button onClick={() => void store.answer(q.id, answers[q.id] ?? '')} disabled={!answers[q.id]?.trim()}>
                        Responder
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : null}

          {tab === 'permissoes' ? (
            <Card className="p-4 sm:p-5">
              <p className="text-sm text-fg-2 mb-3">
                Só você pode conceder ou revogar. Pessoas na call ou no chat <b>não</b> conseguem autorizar nada em seu nome. Toda mudança fica no histórico.
              </p>
              <div className="divide-y divide-line-soft">
                {COMPANION_SCOPES.map((s) => (
                  <div key={s.key} className="py-1.5">
                    <Toggle
                      checked={!!store.permissions[s.key]}
                      disabled={!scopeAvailable(s, voiceReady)}
                      onChange={(v) => void store.setPermission(s.key, v)}
                      label={
                        <span className="flex items-center gap-2">
                          {s.label}
                          {s.risk === 'alto' ? <Badge tone="danger">Sensível</Badge> : null}
                          {!scopeAvailable(s, voiceReady) ? <Badge>{s.key === 'ouvir_call' || s.key === 'falar_call' ? 'Aguardando ativação' : 'Próxima fase'}</Badge> : null}
                        </span>
                      }
                      description={s.description}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {tab === 'historico' ? (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-sm text-fg-2">O que o Claude fez e por quê. Gravações de áudio não são guardadas.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={exportLogs} disabled={!store.logs.length}>
                    Exportar
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} disabled={!store.logs.length} onClick={() => confirm('Excluir todos os registros exibidos?') && void store.deleteLogs()}>
                    Excluir
                  </Button>
                </div>
              </div>
              {store.logs.length === 0 ? (
                <p className="text-sm text-fg-3 py-6 text-center">Nenhum registro.</p>
              ) : (
                <ol className="space-y-1.5">
                  {store.logs.map((l) => (
                    <li key={l.id} className="flex gap-3 text-[13.5px]">
                      <span className="text-fg-3 tabular-nums shrink-0 w-28">
                        {formatDate(l.created_at)} {formatTime(l.created_at)}
                      </span>
                      <span className={cx('shrink-0 w-12', l.level === 'erro' ? 'text-danger' : l.level === 'aviso' ? 'text-warn' : 'text-fg-3')}>{l.level}</span>
                      <span className="text-fg-2">{l.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          ) : null}

          {tab === 'modo' ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                {MODES.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => void store.setMode(m.key)}
                    className={cx(
                      'text-left rounded-2xl border p-4 transition-colors',
                      store.settings?.mode === m.key ? 'border-accent bg-accent/10' : 'border-line bg-card hover:border-[#33405a]',
                    )}
                  >
                    <div className="font-semibold">{m.label}</div>
                    <div className="text-[13px] text-fg-2 mt-1">{m.description}</div>
                  </button>
                ))}
              </div>
              <Card className="p-4 sm:p-5">
                <Field label="Tarefas ao mesmo tempo" hint="Tarefas que mexem no mesmo recurso nunca rodam juntas, mesmo com limite maior.">
                  <Select value={String(store.settings?.max_concurrent_tasks ?? 2)} onChange={(e) => void store.setMaxConcurrent(Number(e.target.value))} className="max-w-[160px]">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Card>
              <Notice tone="info" title="O que o modo muda hoje">
                Nas tarefas em segundo plano: em “Só quando chamado” e “Trabalhador em segundo plano” o Claude só pede sua atenção quando uma dúvida bloqueia o
                trabalho (as outras ficam na aba Dúvidas); em “Participante ativo” ele pode registrar sugestões extras. Nos canais de texto ele só responde quando
                alguém escreve @Claude, em qualquer modo.
              </Notice>
              <Card className="p-4 sm:p-5 space-y-3">
                <div className="font-semibold">Voz do Claude na call</div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Voz">
                    <Select value={store.settings?.voice_option ?? 'voz1'} onChange={(e) => void store.setVoice({ voice_option: e.target.value as 'voz1' | 'voz2' })}>
                      <option value="voz1">Voz 1 (padrão)</option>
                      <option value="voz2">Voz 2</option>
                    </Select>
                  </Field>
                  <Field label="Velocidade da fala">
                    <Select value={store.settings?.voice_speed ?? 'normal'} onChange={(e) => void store.setVoice({ voice_speed: e.target.value as 'lenta' | 'normal' | 'rapida' })}>
                      <option value="lenta">Mais devagar</option>
                      <option value="normal">Normal</option>
                      <option value="rapida">Mais rápida</option>
                    </Select>
                  </Field>
                </div>
                <Toggle
                  checked={store.settings?.voice_greeting ?? true}
                  onChange={(v) => void store.setVoice({ voice_greeting: v })}
                  label="Cumprimentar ao entrar na call"
                  description="Uma frase curta avisando que entrou e como chamar."
                />
              </Card>
              <Notice tone="info" title="Como funciona na call">
                {voiceReady ? (
                  <>
                    Na call, toque no botão do robô para chamar o Claude. Ele só entra quando você chama, mostra que está ouvindo e pode ser pausado, silenciado ou tirado da
                    call por quem chamou. Ele responde quando alguém diz “Claude” (no modo “Participante ativo” pode comentar sozinho quando for útil). Não grava a conversa e
                    nunca fala de finanças na call. Precisa das permissões “Ouvir calls” e “Falar nas calls” liberadas aqui.
                  </>
                ) : (
                  <>O serviço de voz ainda não foi ativado pelo administrador do NEXUS. Quando estiver ativo, o botão do robô aparece nas calls.</>
                )}
              </Notice>
            </div>
          ) : null}
        </div>
      </div>
      <NewTaskModal open={creating} onClose={() => setCreating(false)} projects={projects} />
    </div>
  );
}
