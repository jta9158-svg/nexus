import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { FileText, Paperclip, Plus, SendHorizontal, Smile, X } from 'lucide-react';
import { useApp } from '../../store/app';
import { useMessages, type TargetKind } from '../../store/messages';
import { useClaudeVisible, useSession } from '../../store/session';
import { toast } from '../../store/toast';
import { callFunction } from '../../lib/supabase';
import { sendTyping } from '../../lib/realtime';
import { formatBytes } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import type { Message } from '../../types/db';
import { Avatar, ClaudeAvatar, cx } from '../ui';

const EMOJIS = ['😀', '😂', '🤣', '😅', '😊', '😍', '😎', '🤔', '😮', '😢', '😡', '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '✨', '🎉', '💯', '✅', '❌', '⚠️', '💡', '🚀', '🎮', '🛠️', '🐛', '🧪', '💰', '📈', '🗺️', '⚔️', '🛡️', '🧙', '🏯', '⚡', '🌀', '💧'];
const MAX_FILE = 25 * 1024 * 1024;

interface Candidate {
  id: string;
  username: string;
  label: string;
  avatar?: string | null;
  special?: 'claude' | 'todos';
}

/** Dispara a resposta do Claude a uma mensagem com @Claude no canal. */
export async function askClaudeInChannel(msg: Message): Promise<void> {
  try {
    await callFunction('claude-channel', { message_id: msg.id });
  } catch (err) {
    toast.warn('O Claude não pôde responder', (err as Error).message);
  }
}

export function Composer({
  target,
  kind,
  serverId,
  placeholder,
}: {
  target: string;
  kind: TargetKind;
  serverId: string | null;
  placeholder: string;
}) {
  const send = useMessages((s) => s.send);
  const perms = useApp((s) => (serverId ? s.myPerms[serverId] : undefined));
  const members = useApp((s) => (serverId ? s.members[serverId] : undefined));
  const dm = useApp((s) => (kind === 'dm' ? s.dms.find((d) => d.id === target) : undefined));
  const profiles = useApp((s) => s.profiles);
  const me = useSession((s) => s.userId);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [sel, setSel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = kind === 'dm' || hasPerm(perms, 'send_messages');
  const canAttach = kind === 'dm' || hasPerm(perms, 'attach_files');
  const claudeVisible = useClaudeVisible();
  const canClaude = kind === 'channel' && claudeVisible && hasPerm(perms, 'use_claude');

  useEffect(() => {
    setText('');
    setFiles([]);
    setMention(null);
  }, [target]);

  // Altura automática do campo
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(220, ta.scrollHeight) + 'px';
  }, [text]);

  const candidates = useMemo<Candidate[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const ids = kind === 'dm' ? dm?.participants ?? [] : (members ?? []).map((m) => m.user_id);
    const list: Candidate[] = [];
    if (canClaude && 'claude'.startsWith(q)) list.push({ id: 'claude', username: 'Claude', label: 'Claude (assistente)', special: 'claude' });
    if (kind === 'channel' && hasPerm(perms, 'mention_everyone') && 'todos'.startsWith(q))
      list.push({ id: 'todos', username: 'todos', label: 'Todos do servidor', special: 'todos' });
    for (const id of ids) {
      if (id === me) continue;
      const p = profiles[id];
      if (!p) continue;
      if (p.username.startsWith(q) || p.display_name.toLowerCase().includes(q)) {
        list.push({ id, username: p.username, label: p.display_name, avatar: p.avatar_url });
      }
      if (list.length >= 8) break;
    }
    return list;
  }, [mention, kind, dm, members, profiles, me, canClaude, perms]);

  const insertMention = (c: Candidate) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(taRef.current?.selectionStart ?? text.length);
    const next = `${before}@${c.username} ${after}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = before.length + c.username.length + 2;
      taRef.current?.setSelectionRange(pos, pos);
      taRef.current?.focus();
    });
  };

  const onChange = (value: string) => {
    setText(value);
    const pos = taRef.current?.selectionStart ?? value.length;
    const m = /(^|\s)@([A-Za-z0-9_.]{0,32})$/.exec(value.slice(0, pos));
    if (m) {
      setMention({ query: m[2], start: pos - m[2].length - 1 });
      setSel(0);
    } else {
      setMention(null);
    }
    if (value.trim()) sendTyping(serverId, target);
  };

  const addFiles = (list: FileList | File[]) => {
    if (!canAttach) {
      toast.warn('Você não tem permissão para enviar arquivos aqui');
      return;
    }
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) {
        toast.warn(`"${f.name}" passa de 25 MB`, 'Use a área de Arquivos do servidor para arquivos grandes.');
        continue;
      }
      if (next.length >= 10) break;
      next.push(f);
    }
    setFiles(next);
  };

  const submit = async () => {
    if (!canSend) return;
    const content = text;
    const sending = files;
    if (!content.trim() && sending.length === 0) return;
    setText('');
    setFiles([]);
    setMention(null);
    const msg = await send(target, kind, content, sending);
    if (msg?.mentions_claude && canClaude) void askClaudeInChannel(msg);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => (s + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => (s - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(candidates[sel]);
        return;
      }
      if (e.key === 'Escape') {
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files ?? []);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  if (!canSend) {
    return (
      <div className="px-4 sm:px-5 pb-4">
        <div className="h-12 rounded-xl border border-line bg-[#0d1118] flex items-center px-4 text-sm text-fg-3">
          Você não tem permissão para enviar mensagens neste canal.
        </div>
      </div>
    );
  }

  return (
    <div
      className="px-3 sm:px-5 pb-3 sm:pb-4 shrink-0 relative"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {dragging ? (
        <div className="absolute inset-x-3 sm:inset-x-5 -top-24 bottom-3 rounded-2xl border-2 border-dashed border-accent bg-accent/10 z-10 flex items-center justify-center text-sm text-fg pointer-events-none">
          Solte para anexar
        </div>
      ) : null}

      {mention && candidates.length ? (
        <div className="absolute left-3 right-3 sm:left-5 sm:right-5 bottom-full mb-2 rounded-xl border border-line bg-[#171c27] shadow-2xl p-1.5 z-20" role="listbox">
          <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-fg-3 font-semibold">Mencionar</div>
          {candidates.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === sel}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(c);
              }}
              className={cx('w-full h-10 px-2 rounded-lg flex items-center gap-2.5 text-left', i === sel ? 'bg-raised' : 'hover:bg-raised/60')}
            >
              {c.special === 'claude' ? (
                <ClaudeAvatar size={26} />
              ) : c.special === 'todos' ? (
                <span className="size-[26px] rounded-full bg-warn/20 text-warn flex items-center justify-center text-xs font-bold">@</span>
              ) : (
                <Avatar name={c.label} url={c.avatar} size={26} />
              )}
              <span className="text-sm text-fg">{c.label}</span>
              <span className="text-xs text-fg-3">@{c.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      {files.length ? (
        <div className="flex gap-2 overflow-x-auto nx-scroll pb-2">
          {files.map((f, i) => (
            <div key={i} className="shrink-0 flex items-center gap-2 rounded-xl border border-line bg-[#151a24] pl-2.5 pr-1.5 h-12 max-w-[240px]">
              <FileText className="size-4 text-fg-2 shrink-0" />
              <div className="min-w-0">
                <div className="text-[13px] truncate">{f.name}</div>
                <div className="text-[11px] text-fg-3">{formatBytes(f.size)}</div>
              </div>
              <button className="size-7 rounded-md text-fg-3 hover:text-fg hover:bg-raised flex items-center justify-center" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remover ${f.name}`}>
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <button
          className="size-11 shrink-0 rounded-xl bg-[#171c27] border border-line text-fg-2 hover:text-fg flex items-center justify-center disabled:opacity-40"
          onClick={() => fileRef.current?.click()}
          disabled={!canAttach}
          aria-label="Anexar arquivos"
          title="Anexar arquivos"
        >
          <Plus className="size-5" />
        </button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <div className="relative flex-1 min-w-0 flex items-end rounded-xl bg-[#171c27] border border-line focus-within:border-[#33405a]">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            rows={1}
            className="flex-1 min-w-0 bg-transparent resize-none outline-none px-4 py-[11px] text-[15px] text-fg placeholder:text-fg-3 max-h-[220px] nx-scroll"
            aria-label={placeholder}
          />
          <div className="flex items-center gap-0.5 pr-1.5 pb-1.5">
            <button
              className="size-8 rounded-lg text-fg-2 hover:text-fg flex items-center justify-center"
              onClick={() => fileRef.current?.click()}
              disabled={!canAttach}
              aria-label="Anexar"
            >
              <Paperclip className="size-[18px]" />
            </button>
            <div className="relative">
              <button className="size-8 rounded-lg text-fg-2 hover:text-fg flex items-center justify-center" onClick={() => setEmojiOpen(!emojiOpen)} aria-label="Emojis">
                <Smile className="size-[18px]" />
              </button>
              {emojiOpen ? (
                <div className="absolute bottom-10 right-0 w-[264px] rounded-xl border border-line bg-[#171c27] shadow-2xl p-2 grid grid-cols-8 gap-0.5 z-20">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      className="size-8 rounded-md hover:bg-raised text-lg"
                      onClick={() => {
                        setText((t) => t + e);
                        setEmojiOpen(false);
                        taRef.current?.focus();
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="size-8 rounded-lg flex items-center justify-center text-white bg-accent hover:bg-accent-strong disabled:bg-transparent disabled:text-fg-3"
              onClick={() => void submit()}
              disabled={!text.trim() && !files.length}
              aria-label="Enviar"
            >
              <SendHorizontal className="size-[17px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Caixa "Pergunte ao @Claude" acima do campo de mensagem (como no layout). */
export function ClaudeAskBox({ target, serverId }: { target: string; serverId: string }) {
  const send = useMessages((s) => s.send);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setText('');
    const msg = await send(target, 'channel', `@Claude ${q}`, []);
    setBusy(false);
    if (msg) void askClaudeInChannel(msg);
  };
  void serverId;
  return (
    <div className="px-3 sm:px-5 pb-2.5 shrink-0">
      <div className="rounded-2xl border border-line bg-[#151a24] p-2.5 sm:p-3">
        <span className="inline-flex items-center rounded-md bg-accent/18 text-mention text-[13px] font-medium px-1.5 py-0.5 mb-1.5">@Claude</span>
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Analise o sistema de combate e me diga o que precisa ser melhorado…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-fg placeholder:text-fg-3 h-9 px-1"
            aria-label="Perguntar ao Claude neste canal"
          />
          <button
            onClick={() => void submit()}
            disabled={!text.trim() || busy}
            className="size-9 rounded-lg flex items-center justify-center text-fg hover:bg-raised disabled:text-fg-3"
            aria-label="Perguntar ao Claude"
          >
            <SendHorizontal className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
