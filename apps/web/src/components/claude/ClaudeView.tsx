import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, ImageIcon, MessageSquarePlus, Paperclip, PanelLeft, Pencil, SendHorizontal, Square, Trash2, X } from 'lucide-react';
import { useApp } from '../../store/app';
import { useClaude, prepareUpload, type ClaudeUpload } from '../../store/claude';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { formatBytes, formatNumber, formatRelative } from '../../lib/format';
import type { Project } from '../../types/db';
import { Avatar, Button, ClaudeAvatar, cx, IconButton, Notice, Select, Spinner } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';
import { MessageContent } from '../chat/MessageContent';

const SUGGESTIONS = [
  'Analise este script do ALPHA, encontre problemas e proponha correções.',
  'Quanto o ALPHA faturou neste mês, considerando os lançamentos registrados?',
  'Monte uma lista de tarefas para revisar o mapa inicial.',
  'Como deixar os efeitos das skills mais leves no celular sem perder qualidade?',
];

export function ClaudeView({ conversationId }: { conversationId?: string | null }) {
  const { conversations, loaded, messages, streaming, loadConversations, loadMessages, createConversation, send, cancel, rename, remove, setProject } =
    useClaude();
  const quota = useApp((s) => s.claudeQuota);
  const openView = useApp((s) => s.openView);
  const me = useSession((s) => s.me);
  const [projects, setProjects] = useState<Project[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<ClaudeUpload[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [newProject, setNewProject] = useState<string>('');
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) void loadConversations();
    void sb()
      .from('projects')
      .select('*')
      .order('name')
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, [loaded, loadConversations]);

  const active = conversations.find((c) => c.id === conversationId) ?? null;
  const list = active ? messages[active.id] : undefined;
  const live = active ? streaming[active.id] : undefined;

  useEffect(() => {
    if (active && !messages[active.id]) void loadMessages(active.id);
  }, [active, messages, loadMessages]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list?.length, live?.text]);

  const projectName = useMemo(() => projects.find((p) => p.id === active?.project_id)?.name, [projects, active]);
  const allowed = !!quota?.allowed;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    const next = [...uploads];
    for (const f of Array.from(files).slice(0, 8)) {
      try {
        next.push(await prepareUpload(f));
      } catch (err) {
        toast.warn('Arquivo não adicionado', (err as Error).message);
      }
    }
    setUploads(next);
    setPreparing(false);
  };

  const submit = async (override?: string) => {
    const content = (override ?? text).trim();
    if ((!content && !uploads.length) || !allowed) return;
    let conv = active;
    if (!conv) {
      try {
        const proj = projects.find((p) => p.id === newProject);
        conv = await createConversation({ title: content.slice(0, 60) || 'Nova conversa', projectId: proj?.id ?? null, serverId: proj?.server_id ?? null });
        openView({ kind: 'claude', conversationId: conv.id });
      } catch (err) {
        toast.error(err, 'Não foi possível criar a conversa');
        return;
      }
    }
    const files = uploads;
    setText('');
    setUploads([]);
    await send(conv.id, content, files);
  };

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Lista de conversas */}
      <aside
        className={cx(
          'w-72 shrink-0 border-r border-line-soft flex-col bg-surface',
          listOpen ? 'flex absolute inset-y-0 left-0 z-30 shadow-2xl lg:static lg:shadow-none' : 'hidden lg:flex',
        )}
      >
        <div className="h-14 flex items-center gap-2 px-3 border-b border-line-soft">
          <Button
            size="sm"
            className="flex-1"
            icon={<MessageSquarePlus className="size-4" />}
            onClick={() => {
              openView({ kind: 'claude', conversationId: null });
              setListOpen(false);
            }}
          >
            Nova conversa
          </Button>
          <IconButton label="Fechar lista" className="lg:hidden" onClick={() => setListOpen(false)}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto nx-scroll p-2 space-y-0.5">
          {!loaded ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-sm text-fg-3 px-2 py-3">Suas conversas com a NEXUS IA aparecem aqui.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  openView({ kind: 'claude', conversationId: c.id });
                  setListOpen(false);
                }}
                className={cx('w-full text-left rounded-lg px-2.5 py-2 transition-colors', c.id === active?.id ? 'bg-raised' : 'hover:bg-raised/60')}
              >
                <div className="text-[14px] text-fg truncate flex items-center gap-1.5">
                  {streaming[c.id] ? <span className="size-1.5 rounded-full bg-violet animate-pulse" /> : null}
                  {c.title}
                </div>
                <div className="text-[12px] text-fg-3">{formatRelative(c.updated_at)}</div>
              </button>
            ))
          )}
        </div>
        {quota ? (
          <div className="border-t border-line-soft px-3 py-2.5 text-[12px] text-fg-3">
            Uso hoje: {formatNumber(quota.used_today)} tokens{quota.daily_limit ? ` de ${formatNumber(quota.daily_limit)}` : ''}
          </div>
        ) : null}
      </aside>

      {/* Conversa */}
      <section className="flex-1 min-w-0 flex flex-col relative">
        <ViewHeader
          icon={
            <span className="flex items-center gap-2">
              <IconButton label="Conversas" className="lg:hidden -ml-1" onClick={() => setListOpen(true)}>
                <PanelLeft className="size-5" />
              </IconButton>
              <ClaudeAvatar size={26} />
            </span>
          }
          title={
            editingTitle && active ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  void rename(active.id, title);
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                className="bg-[#0d1118] border border-line rounded-lg px-2 h-8 text-[15px] outline-none focus:border-accent w-full max-w-md"
              />
            ) : (
              active?.title ?? 'NEXUS IA'
            )
          }
          subtitle={active ? (projectName ? `Contexto: ${projectName}` : 'Sem projeto vinculado') : 'Converse por texto, envie imagens, PDFs e scripts'}
          actions={
            active ? (
              <>
                <IconButton
                  label="Renomear"
                  onClick={() => {
                    setTitle(active.title);
                    setEditingTitle(true);
                  }}
                >
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  label="Excluir conversa"
                  onClick={() => {
                    if (confirm('Excluir esta conversa e todo o histórico dela?')) {
                      void remove(active.id);
                      openView({ kind: 'claude', conversationId: null });
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </>
            ) : null
          }
        />

        <div ref={scroller} className="flex-1 overflow-y-auto nx-scroll">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {!allowed && quota ? (
              <Notice tone="warn" title="NEXUS IA indisponível para você">
                {quota.reason}
              </Notice>
            ) : null}

            {!active ? (
              <div className="pt-6 text-center">
                <ClaudeAvatar size={56} className="mx-auto" />
                <h2 className="text-2xl font-semibold mt-4">Olá{me ? `, ${me.display_name}` : ''}! Como posso ajudar?</h2>
                <p className="text-fg-2 mt-1.5">Escolha um projeto para eu usar como contexto (tarefas, arquivos e finanças que você pode ver).</p>
                <div className="max-w-xs mx-auto mt-4">
                  <Select value={newProject} onChange={(e) => setNewProject(e.target.value)} aria-label="Projeto de contexto">
                    <option value="">Sem projeto</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid sm:grid-cols-2 gap-2.5 mt-6 text-left">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      disabled={!allowed}
                      onClick={() => setText(s)}
                      className="rounded-xl border border-line bg-card hover:border-[#33405a] px-3.5 py-3 text-[14px] text-fg-2 hover:text-fg transition-colors disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : list === undefined ? (
              <div className="flex justify-center py-10">
                <Spinner className="size-6" />
              </div>
            ) : (
              <>
                {active && !active.project_id && projects.length ? (
                  <div className="flex items-center gap-2 text-[13px] text-fg-3">
                    Usar projeto como contexto:
                    <Select
                      className="!h-8 !w-auto text-[13px]"
                      value=""
                      onChange={(e) => {
                        const p = projects.find((x) => x.id === e.target.value);
                        if (p) void setProject(active.id, p.id, p.server_id);
                      }}
                    >
                      <option value="">Escolher…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                {list.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="flex justify-end gap-3">
                      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-[#1d2434] border border-line px-4 py-2.5">
                        {m.content ? <div className="whitespace-pre-wrap text-[15px]">{m.content}</div> : null}
                        {m.attachments.length ? (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {m.attachments.map((a, i) => (
                              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-[#0d1118] border border-line px-2 py-1 text-[12px] text-fg-2">
                                {a.type.startsWith('image/') ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
                                {a.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <Avatar name={me?.display_name ?? 'Você'} url={me?.avatar_url} size={32} />
                    </div>
                  ) : (
                    <div key={m.id} className="flex gap-3">
                      <ClaudeAvatar size={32} />
                      <div className="min-w-0 flex-1">
                        {m.content ? <MessageContent content={m.content} /> : null}
                        {m.status === 'error' ? <p className="text-sm text-danger mt-1">{m.error ?? 'Erro ao gerar a resposta.'}</p> : null}
                        {m.status === 'cancelled' ? <p className="text-xs text-fg-3 mt-1">Resposta interrompida.</p> : null}
                        {m.output_tokens ? (
                          <p className="text-[11px] text-fg-3 mt-1">
                            {m.model} · {formatNumber((m.input_tokens ?? 0) + m.output_tokens)} tokens
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ),
                )}
                {live ? (
                  <div className="flex gap-3">
                    <ClaudeAvatar size={32} />
                    <div className="min-w-0 flex-1">
                      {live.text ? <MessageContent content={live.text} /> : <span className="text-fg-3 text-sm">Pensando…</span>}
                      {live.error ? <p className="text-sm text-danger mt-1">{live.error}</p> : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Campo */}
        <div className="shrink-0 px-3 sm:px-6 pb-3 sm:pb-5 nx-safe-bottom">
          <div className="max-w-3xl mx-auto">
            {uploads.length ? (
              <div className="flex gap-2 overflow-x-auto nx-scroll pb-2">
                {uploads.map((u, i) => (
                  <span key={i} className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-line bg-card pl-2.5 pr-1 h-10 text-[13px]">
                    {u.kind === 'image' ? <ImageIcon className="size-4 text-fg-2" /> : <FileText className="size-4 text-fg-2" />}
                    <span className="max-w-[160px] truncate">{u.name}</span>
                    <span className="text-fg-3 text-[11px]">{formatBytes(u.size)}</span>
                    <button className="size-7 rounded-md hover:bg-raised flex items-center justify-center" onClick={() => setUploads(uploads.filter((_, j) => j !== i))} aria-label={`Remover ${u.name}`}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2 rounded-2xl border border-line bg-card px-2 py-2 focus-within:border-[#33405a]">
              <IconButton label="Anexar imagem, PDF ou script" onClick={() => fileRef.current?.click()} disabled={!allowed || preparing}>
                {preparing ? <Spinner className="size-4" /> : <Paperclip className="size-[18px]" />}
              </IconButton>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.lua,.luau,.json,.csv,.ts,.js,.py,.rbxlx,.rbxmx"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                disabled={!allowed}
                placeholder={allowed ? 'Mensagem para a NEXUS IA…' : 'NEXUS IA indisponível'}
                className="flex-1 min-w-0 bg-transparent resize-none outline-none text-[15px] py-2 px-1 max-h-48 nx-scroll placeholder:text-fg-3"
                style={{ height: Math.min(192, 24 + text.split('\n').length * 22) }}
              />
              {live && active ? (
                <IconButton label="Parar resposta" onClick={() => cancel(active.id)} className="bg-raised">
                  <Square className="size-4 fill-current" />
                </IconButton>
              ) : (
                <IconButton label="Enviar" onClick={() => void submit()} disabled={!allowed || (!text.trim() && !uploads.length)} className="bg-accent !text-white hover:!bg-accent-strong disabled:!bg-transparent disabled:!text-fg-3">
                  <SendHorizontal className="size-[18px]" />
                </IconButton>
              )}
            </div>
            <p className="text-[11px] text-fg-3 text-center mt-2">A NEXUS IA pode errar. Confira informações importantes — ela usa só os dados que você tem permissão para ver.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
