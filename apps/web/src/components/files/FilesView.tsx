import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronRight,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  Lock,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { sb } from '../../lib/supabase';
import { onTable } from '../../lib/bus';
import { randomId, safeFileName, signedUrl } from '../../lib/storage';
import { formatBytes, formatRelative } from '../../lib/format';
import { openExternal } from '../../lib/platform';
import { hasPerm } from '../../lib/permissions';
import type { FileKind, FileRow } from '../../types/db';
import { Badge, Button, Card, cx, EmptyState, Field, Input, Modal, Select, Spinner, Textarea } from '../ui';
import { ViewHeader } from '../layout/ViewHeader';

const MAX = 50 * 1024 * 1024;

function inferKind(f: File): FileKind {
  const n = f.name.toLowerCase();
  if (f.type.startsWith('image/')) return 'imagem';
  if (/\.(fbx|obj|blend|glb|gltf|stl|rbxm|rbxmx|dae|3ds)$/.test(n)) return 'modelo3d';
  if (/\.(lua|luau|js|ts|py|json)$/.test(n)) return 'script';
  if (/\.(pdf|docx?|txt|md|odt|xlsx?|pptx?)$/.test(n)) return 'documento';
  return 'arquivo';
}

const KIND: Record<FileKind, { label: string; icon: React.ReactNode }> = {
  arquivo: { label: 'Arquivo', icon: <FileText className="size-4" /> },
  imagem: { label: 'Imagem', icon: <ImageIcon className="size-4" /> },
  modelo3d: { label: 'Modelo 3D', icon: <Box className="size-4" /> },
  documento: { label: 'Documento', icon: <FileText className="size-4" /> },
  referencia: { label: 'Referência', icon: <ImageIcon className="size-4" /> },
  link: { label: 'Link', icon: <Link2 className="size-4" /> },
  ideia: { label: 'Ideia', icon: <Lightbulb className="size-4" /> },
  cronograma: { label: 'Cronograma', icon: <FileText className="size-4" /> },
  script: { label: 'Script', icon: <FileCode2 className="size-4" /> },
};

function NoteModal({ serverId, folder, open, onClose }: { serverId: string; folder: string; open: boolean; onClose: () => void }) {
  const me = useSession((s) => s.userId);
  const projects = useApp((s) => s.projects[serverId]) ?? [];
  const [kind, setKind] = useState<'link' | 'ideia' | 'cronograma'>('link');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await sb().from('files').insert({
      server_id: serverId,
      folder,
      name: name.trim(),
      kind,
      url: kind === 'link' ? url.trim() : null,
      description: description.trim() || null,
      project_id: project || null,
      uploaded_by: me,
    });
    setBusy(false);
    if (error) return toast.error(error);
    setName('');
    setUrl('');
    setDescription('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar link ou ideia"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={!name.trim() || (kind === 'link' && !/^https?:\/\//i.test(url))}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tipo">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="link">Link / referência</option>
            <option value="ideia">Ideia</option>
            <option value="cronograma">Cronograma</option>
          </Select>
        </Field>
        <Field label="Título">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        {kind === 'link' ? (
          <Field label="Endereço (https://…)">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
        ) : null}
        <Field label="Descrição">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </Field>
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
      </div>
    </Modal>
  );
}

export function FilesView({ serverId }: { serverId: string }) {
  const perms = useApp((s) => s.myPerms[serverId]);
  const projects = useApp((s) => s.projects[serverId]) ?? [];
  const me = useSession((s) => s.userId);
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileRow[] | null>(null);
  const [kindFilter, setKindFilter] = useState<'' | FileKind>('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [privateUpload, setPrivateUpload] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canManage = hasPerm(perms, 'manage_files');

  const load = useCallback(async () => {
    const { data, error } = await sb().from('files').select('*').eq('server_id', serverId).order('updated_at', { ascending: false }).limit(1000);
    if (error) toast.error(error);
    setFiles((data ?? []) as FileRow[]);
    void useApp.getState().ensureProfiles((data ?? []).map((f) => (f as FileRow).uploaded_by));
  }, [serverId]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  useEffect(() => onTable('files', () => void load()), [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await sb().rpc('search_files', { p_server: serverId, p_query: q });
      setResults((data ?? []) as FileRow[]);
    }, 250);
    return () => clearTimeout(t);
  }, [query, serverId]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const f of files ?? []) {
      const parts = f.folder.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
    }
    if (folder) set.add(folder);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [files, folder]);

  const subfolders = folders.filter((f) => (folder ? f.startsWith(folder + '/') && !f.slice(folder.length + 1).includes('/') : !f.includes('/')));
  const list = (results ?? (files ?? []).filter((f) => f.folder === folder)).filter((f) => !kindFilter || f.kind === kindFilter);

  const upload = async (picked: FileList | null) => {
    if (!picked?.length) return;
    for (const f of Array.from(picked)) {
      if (f.size > MAX) {
        toast.warn(`"${f.name}" passa de 50 MB`, 'O plano gratuito do servidor limita cada arquivo a 50 MB.');
        continue;
      }
      setUploading(f.name);
      const path = `${serverId}/${randomId()}/${safeFileName(f.name)}`;
      const up = await sb().storage.from('project-files').upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) {
        toast.error(up.error, `Falha ao enviar "${f.name}"`);
        continue;
      }
      const { error } = await sb().from('files').insert({
        server_id: serverId,
        folder,
        name: f.name,
        kind: inferKind(f),
        storage_path: path,
        mime_type: f.type || null,
        size_bytes: f.size,
        visibility: privateUpload ? 'privado' : 'servidor',
        uploaded_by: me,
      });
      if (error) {
        toast.error(error, `Falha ao registrar "${f.name}"`);
        await sb().storage.from('project-files').remove([path]);
      }
    }
    setUploading(null);
    void load();
  };

  const open = async (f: FileRow) => {
    if (f.kind === 'link' && f.url) return openExternal(f.url);
    if (!f.storage_path) return;
    try {
      openExternal(await signedUrl('project-files', f.storage_path, { download: f.name }));
    } catch (err) {
      toast.error(err, 'Não foi possível abrir');
    }
  };

  const remove = async (f: FileRow) => {
    if (!confirm(`Excluir "${f.name}"?`)) return;
    if (f.storage_path) await sb().storage.from('project-files').remove([f.storage_path]);
    const { error } = await sb().from('files').delete().eq('id', f.id);
    if (error) return toast.error(error);
    setFiles((cur) => cur?.filter((x) => x.id !== f.id) ?? cur);
  };

  const setProject = async (f: FileRow, projectId: string) => {
    const { error } = await sb().from('files').update({ project_id: projectId || null }).eq('id', f.id);
    if (error) return toast.error(error);
    setFiles((cur) => cur?.map((x) => (x.id === f.id ? { ...x, project_id: projectId || null } : x)) ?? cur);
  };

  const crumbs = folder ? folder.split('/') : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ViewHeader
        icon={<FolderOpen className="size-5" />}
        title="Arquivos"
        subtitle="Documentos, imagens, modelos 3D, scripts, links e ideias"
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setNoteOpen(true)}>
              <span className="hidden sm:inline">Link/ideia</span>
            </Button>
            <Button size="sm" icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()} loading={!!uploading}>
              <span className="hidden sm:inline">{uploading ? 'Enviando…' : 'Enviar'}</span>
            </Button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
          </>
        }
      />
      <div className="flex-1 min-h-0 flex">
        <aside className="hidden md:flex w-60 shrink-0 border-r border-line-soft flex-col p-2 overflow-y-auto nx-scroll">
          <button onClick={() => setFolder('')} className={cx('h-9 px-2.5 rounded-lg flex items-center gap-2 text-sm text-left', folder === '' ? 'bg-raised text-fg' : 'text-fg-2 hover:bg-raised/60')}>
            <FolderOpen className="size-4" /> Todos os arquivos
          </button>
          {folders.map((f) => (
            <button
              key={f}
              onClick={() => setFolder(f)}
              className={cx('h-8 pr-2 rounded-lg flex items-center gap-2 text-[13px] text-left truncate', folder === f ? 'bg-raised text-fg' : 'text-fg-2 hover:bg-raised/60')}
              style={{ paddingLeft: 10 + (f.split('/').length - 1) * 14 }}
            >
              <Folder className="size-4 shrink-0" /> <span className="truncate">{f.split('/').pop()}</span>
            </button>
          ))}
          <button
            onClick={() => {
              const name = prompt('Nome da nova pasta:');
              if (name?.trim()) setFolder((folder ? folder + '/' : '') + name.trim().replace(/\//g, '-'));
            }}
            className="h-8 px-2.5 mt-2 rounded-lg flex items-center gap-2 text-[13px] text-mention hover:bg-raised/60"
          >
            <FolderPlus className="size-4" /> Nova pasta
          </button>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-2 border-b border-line-soft">
            <nav className="flex items-center gap-1 text-sm min-w-0 flex-1" aria-label="Pasta atual">
              <button className="text-fg-2 hover:text-fg" onClick={() => setFolder('')}>
                Arquivos
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="size-4 text-fg-3" />
                  <button className="text-fg-2 hover:text-fg truncate" onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))}>
                    {c}
                  </button>
                </span>
              ))}
            </nav>
            <div className="relative">
              <Search className="size-4 text-fg-3 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar arquivos…" className="pl-9 !h-9 w-52" />
            </div>
            <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="!h-9 !w-auto">
              <option value="">Todos os tipos</option>
              {Object.entries(KIND).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-[13px] text-fg-2">
              <input type="checkbox" checked={privateUpload} onChange={(e) => setPrivateUpload(e.target.checked)} className="accent-[#5b7cff]" />
              Enviar como privado
            </label>
          </div>

          <div
            className="flex-1 overflow-y-auto nx-scroll p-4 sm:p-5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            {files === null ? (
              <div className="flex justify-center py-10">
                <Spinner className="size-6" />
              </div>
            ) : (
              <>
                {!results && subfolders.length ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-4">
                    {subfolders.map((f) => (
                      <button key={f} onClick={() => setFolder(f)} className="h-12 rounded-xl border border-line bg-card hover:border-[#33405a] flex items-center gap-2 px-3 text-sm text-left">
                        <Folder className="size-5 text-warn shrink-0" /> <span className="truncate">{f.split('/').pop()}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {list.length === 0 ? (
                  <EmptyState icon={<Upload className="size-10" />} title={results ? 'Nada encontrado' : 'Pasta vazia'}>
                    {results ? 'Tente outras palavras.' : 'Arraste arquivos para cá ou use o botão Enviar. Limite de 50 MB por arquivo.'}
                  </EmptyState>
                ) : (
                  <Card className="divide-y divide-line-soft overflow-hidden">
                    {list.map((f) => {
                      const mine = f.uploaded_by === me;
                      return (
                        <div key={f.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-raised/30">
                          <span className="size-9 rounded-lg bg-[#0d1118] border border-line flex items-center justify-center text-fg-2 shrink-0">{KIND[f.kind].icon}</span>
                          <div className="min-w-0 flex-1">
                            <button className="text-[14px] text-fg hover:underline truncate block max-w-full text-left" onClick={() => void open(f)}>
                              {f.name}
                            </button>
                            <div className="text-[12px] text-fg-3 flex items-center gap-1.5 flex-wrap">
                              <span>{KIND[f.kind].label}</span>
                              {f.size_bytes ? <span>· {formatBytes(f.size_bytes)}</span> : null}
                              <span>· {displayNameFor(f.uploaded_by, serverId)}</span>
                              <span>· {formatRelative(f.updated_at)}</span>
                              {results && f.folder ? <span>· {f.folder}</span> : null}
                              {f.visibility === 'privado' ? (
                                <Badge>
                                  <Lock className="size-3" /> privado
                                </Badge>
                              ) : null}
                            </div>
                            {f.description ? <p className="text-[12.5px] text-fg-2 mt-0.5 line-clamp-2">{f.description}</p> : null}
                          </div>
                          <Select value={f.project_id ?? ''} onChange={(e) => void setProject(f, e.target.value)} className="!h-8 !w-36 text-[12px] hidden lg:block" disabled={!mine && !canManage} aria-label="Projeto">
                            <option value="">Sem projeto</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                          <button className="size-8 rounded-lg text-fg-3 hover:text-fg hover:bg-raised flex items-center justify-center" onClick={() => void open(f)} aria-label="Abrir ou baixar">
                            {f.kind === 'link' ? <ExternalLink className="size-4" /> : <Download className="size-4" />}
                          </button>
                          {mine || canManage ? (
                            <button className="size-8 rounded-lg text-fg-3 hover:text-danger hover:bg-raised flex items-center justify-center" onClick={() => void remove(f)} aria-label="Excluir">
                              <Trash2 className="size-4" />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <NoteModal serverId={serverId} folder={folder} open={noteOpen} onClose={() => { setNoteOpen(false); void load(); }} />
    </div>
  );
}
