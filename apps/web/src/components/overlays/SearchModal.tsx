import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gamepad2, Hash, MessageSquare, Search, User, Volume2 } from 'lucide-react';
import { useApp, displayNameFor } from '../../store/app';
import { sb } from '../../lib/supabase';
import { formatMessageTime } from '../../lib/format';
import type { Message, Project } from '../../types/db';
import { Avatar, cx, Spinner } from '../ui';

interface Result {
  key: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  run: () => void;
}

export function SearchModal() {
  const open = useApp((s) => s.searchOpen);
  const setOpen = useApp((s) => s.setSearch);
  const servers = useApp((s) => s.servers);
  const channels = useApp((s) => s.channels);
  const profiles = useApp((s) => s.profiles);
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useApp.getState().searchOpen);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      setQ('');
      setMessages([]);
      return;
    }
    void sb()
      .from('projects')
      .select('*')
      .limit(100)
      .then(({ data }) => setProjects((data ?? []) as Project[]));
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setMessages([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await sb().rpc('search_messages', { p_query: term, p_limit: 20 });
      const list = (data ?? []) as Message[];
      await useApp.getState().ensureProfiles(list.map((m) => m.author_id));
      setMessages(list);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useMemo<Result[]>(() => {
    const term = q.trim().toLowerCase();
    const app = useApp.getState();
    const close = () => setOpen(false);
    const out: Result[] = [];
    if (!term) return out;
    for (const s of servers) {
      if (s.name.toLowerCase().includes(term)) out.push({ key: 's' + s.id, icon: <Gamepad2 className="size-4" />, title: s.name, subtitle: 'Servidor', run: () => { void app.selectServer(s.id); close(); } });
      for (const c of channels[s.id] ?? []) {
        if (c.name.toLowerCase().includes(term)) {
          out.push({
            key: 'c' + c.id,
            icon: c.kind === 'text' ? <Hash className="size-4" /> : <Volume2 className="size-4" />,
            title: c.name,
            subtitle: s.name,
            run: () => {
              if (c.kind === 'text') app.openChannel(s.id, c.id);
              else app.openView({ kind: 'call', serverId: s.id, channelId: c.id });
              close();
            },
          });
        }
      }
    }
    for (const p of Object.values(profiles)) {
      if (p.display_name.toLowerCase().includes(term) || p.username.includes(term)) {
        out.push({ key: 'u' + p.id, icon: <User className="size-4" />, title: p.display_name, subtitle: '@' + p.username, run: () => { app.setModal({ kind: 'profile', userId: p.id }); close(); } });
      }
    }
    for (const p of projects) {
      if (p.name.toLowerCase().includes(term)) out.push({ key: 'p' + p.id, icon: <Gamepad2 className="size-4" />, title: p.name, subtitle: 'Projeto', run: () => { app.openView({ kind: 'projects', serverId: p.server_id, projectId: p.id }); close(); } });
    }
    for (const m of messages) {
      const where = m.dm_thread_id ? 'Mensagem privada' : `#${Object.values(channels).flat().find((c) => c.id === m.channel_id)?.name ?? 'canal'}`;
      out.push({
        key: 'm' + m.id,
        icon: <MessageSquare className="size-4" />,
        title: m.content.slice(0, 120) || '(anexo)',
        subtitle: `${m.author_kind === 'claude' ? 'NEXUS IA' : displayNameFor(m.author_id)} · ${where} · ${formatMessageTime(m.created_at)}`,
        run: () => {
          if (m.dm_thread_id) app.openDm(m.dm_thread_id);
          else if (m.server_id && m.channel_id) {
            void app.selectServer(m.server_id).then(() => app.openChannel(m.server_id!, m.channel_id!));
          }
          close();
        },
      });
    }
    return out.slice(0, 40);
  }, [q, servers, channels, profiles, projects, messages, setOpen]);

  useEffect(() => setSel(0), [q]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-3 animate-fade-in" role="dialog" aria-modal="true" aria-label="Buscar">
      <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl rounded-2xl border border-line bg-[#141924] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line-soft">
          <Search className="size-5 text-fg-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === 'Enter') {
                results[sel]?.run();
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Buscar canais, pessoas, projetos e mensagens…"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-fg-3"
          />
          {loading ? <Spinner className="size-4" /> : null}
        </div>
        <div className="max-h-[55vh] overflow-y-auto nx-scroll p-2">
          {q.trim() && results.length === 0 && !loading ? <p className="text-sm text-fg-3 text-center py-8">Nada encontrado.</p> : null}
          {!q.trim() ? <p className="text-sm text-fg-3 text-center py-8">Digite para buscar. Dica: Ctrl+K abre a busca de qualquer lugar.</p> : null}
          {results.map((r, i) => (
            <button key={r.key} onMouseEnter={() => setSel(i)} onClick={r.run} className={cx('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left', i === sel ? 'bg-raised' : '')}>
              <span className="size-8 rounded-lg bg-[#0d1118] border border-line flex items-center justify-center text-fg-2 shrink-0">
                {r.key.startsWith('u') ? <Avatar name={r.title} size={24} /> : r.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] truncate">{r.title}</span>
                {r.subtitle ? <span className="block text-[12px] text-fg-3 truncate">{r.subtitle}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
