import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Pencil, Trash2, X } from 'lucide-react';
import { useApp, displayNameFor, roleColorFor } from '../../store/app';
import { useMessages, type TargetKind } from '../../store/messages';
import { useSession } from '../../store/session';
import { formatDateLong, formatMessageTime, formatTime, sameDay } from '../../lib/format';
import { hasPerm } from '../../lib/permissions';
import type { Message } from '../../types/db';
import { Avatar, Badge, ClaudeAvatar, cx, EmptyState, Spinner } from '../ui';
import { MessageContent } from './MessageContent';
import { Attachments } from './Attachments';

const GROUP_MS = 5 * 60 * 1000;

function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3 px-4 my-4" role="separator">
      <div className="flex-1 h-px bg-line" />
      <span className="text-[12px] font-medium text-fg-3">{formatDateLong(iso)}</span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-fg-3 text-sm">
      <span className="inline-flex gap-0.5">
        <span className="size-1.5 rounded-full bg-[#b9a6ff] animate-bounce [animation-delay:-0.3s]" />
        <span className="size-1.5 rounded-full bg-[#b9a6ff] animate-bounce [animation-delay:-0.15s]" />
        <span className="size-1.5 rounded-full bg-[#b9a6ff] animate-bounce" />
      </span>
      <span className="ml-1.5">Claude está pensando…</span>
    </span>
  );
}

const MessageItem = memo(function MessageItem({
  m,
  grouped,
  serverId,
  canModerate,
  target,
}: {
  m: Message;
  grouped: boolean;
  serverId: string | null;
  canModerate: boolean;
  target: string;
}) {
  const me = useSession((s) => s.userId);
  const profile = useApp((s) => (m.author_id ? s.profiles[m.author_id] : undefined));
  useApp((s) => (serverId ? s.memberRoles[serverId] : undefined));
  const setModal = useApp((s) => s.setModal);
  const { edit, remove, discardFailed } = useMessages.getState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);

  const isClaude = m.author_kind === 'claude';
  const isSystem = m.author_kind === 'system';
  const mine = m.author_id === me && m.author_kind === 'user';
  const mentioned = !!me && (m.mentions.includes(me) || m.mentions_everyone) && !mine;
  const name = isClaude ? 'Claude' : isSystem ? 'NEXUS' : displayNameFor(m.author_id, serverId);
  const color = isClaude ? '#a78bfa' : roleColorFor(m.author_id, serverId) ?? '#8ea1ff';
  const pendingClaude = isClaude && m.meta?.status === 'pending';
  const errorClaude = isClaude && m.meta?.status === 'error';

  const saveEdit = async () => {
    if (draft.trim() && draft !== m.content) await edit(m.id, draft);
    setEditing(false);
  };

  return (
    <div
      className={cx(
        'group relative flex gap-3.5 px-4 sm:px-5 hover:bg-white/[0.018]',
        grouped ? 'py-0.5' : 'pt-3 pb-0.5 mt-1',
        mentioned && 'bg-warn/[0.06] border-l-2 border-warn/70 pl-[14px] sm:pl-[18px]',
        m._pending && 'opacity-60',
      )}
    >
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="hidden group-hover:block text-[10.5px] text-fg-3 pt-1 text-right tabular-nums">{formatTime(m.created_at)}</span>
        ) : isClaude ? (
          <ClaudeAvatar size={40} />
        ) : (
          <button onClick={() => m.author_id && setModal({ kind: 'profile', userId: m.author_id, serverId })} aria-label={`Perfil de ${name}`}>
            <Avatar name={name} url={profile?.avatar_url} size={40} />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[15px] font-semibold" style={{ color }}>
              {name}
            </span>
            {isClaude ? <Badge tone="accent" className="!bg-accent !text-white !border-accent">BOT</Badge> : null}
            <span className="text-[12px] text-fg-3">{formatMessageTime(m.created_at)}</span>
          </div>
        ) : null}

        {editing ? (
          <div className="mt-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-full rounded-xl bg-[#0d1118] border border-line px-3 py-2 text-[15px] outline-none focus:border-accent resize-none"
              rows={Math.min(8, draft.split('\n').length + 1)}
              autoFocus
            />
            <div className="text-[12px] text-fg-3 mt-1">
              Enter para salvar · Esc para cancelar
            </div>
          </div>
        ) : pendingClaude && !m.content ? (
          <div className="mt-1">
            <ThinkingDots />
          </div>
        ) : (
          <>
            {m.content ? <MessageContent content={m.content} highlightSelf={me} /> : null}
            {errorClaude ? (
              <div className="mt-1 flex items-center gap-1.5 text-[13px] text-danger">
                <AlertCircle className="size-4" /> {String(m.meta?.error ?? 'O Claude não conseguiu responder.')}
              </div>
            ) : null}
            {m.edited_at ? <span className="text-[11px] text-fg-3">(editado)</span> : null}
          </>
        )}
        <Attachments items={m.attachments} />
        {m._failed ? (
          <div className="mt-1 flex items-center gap-3 text-[13px] text-danger">
            <span className="flex items-center gap-1">
              <AlertCircle className="size-4" /> Não enviada
            </span>
            <button className="underline" onClick={() => discardFailed(target, m.id)}>
              Descartar
            </button>
          </div>
        ) : null}
      </div>

      {!m._pending && !m._failed && !editing && (mine || canModerate) ? (
        <div className="absolute -top-3 right-4 hidden group-hover:flex items-center rounded-lg border border-line bg-[#171c27] shadow-lg">
          {mine ? (
            <button
              className="size-8 flex items-center justify-center text-fg-2 hover:text-fg"
              aria-label="Editar mensagem"
              onClick={() => {
                setDraft(m.content);
                setEditing(true);
              }}
            >
              <Pencil className="size-4" />
            </button>
          ) : null}
          <button
            className="size-8 flex items-center justify-center text-fg-2 hover:text-danger"
            aria-label="Apagar mensagem"
            onClick={() => {
              if (confirm('Apagar esta mensagem? Isso não pode ser desfeito.')) void remove(m);
            }}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="absolute top-2 right-4 flex gap-1">
          <button className="size-7 rounded-md bg-success/20 text-success flex items-center justify-center" onClick={() => void saveEdit()} aria-label="Salvar">
            <Check className="size-4" />
          </button>
          <button className="size-7 rounded-md bg-raised text-fg-2 flex items-center justify-center" onClick={() => setEditing(false)} aria-label="Cancelar">
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
});

export function MessageList({
  target,
  kind,
  serverId,
  intro,
}: {
  target: string;
  kind: TargetKind;
  serverId: string | null;
  intro: React.ReactNode;
}) {
  const bucket = useMessages((s) => s.buckets[target]);
  const load = useMessages((s) => s.load);
  const loadOlder = useMessages((s) => s.loadOlder);
  const perms = useApp((s) => (serverId ? s.myPerms[serverId] : undefined));
  const typing = useApp((s) => s.typing[target]);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const canModerate = !!serverId && hasPerm(perms, 'manage_messages');

  useEffect(() => {
    stick.current = true;
    void load(target, kind);
  }, [target, kind, load]);

  const items = bucket?.items ?? [];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length, items[items.length - 1]?.content]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 120 && bucket?.hasMore && !bucket.loading && bucket.loaded) {
      prevHeight.current = el.scrollHeight;
      void loadOlder(target, kind);
    }
  }, [bucket, loadOlder, target, kind]);

  const typingNames = Object.entries(typing ?? {})
    .filter(([, until]) => until > Date.now())
    .map(([uid]) => displayNameFor(uid, serverId));

  return (
    <div className="flex-1 min-h-0 relative flex flex-col">
      <div ref={ref} onScroll={onScroll} className="flex-1 overflow-y-auto nx-scroll pb-3" aria-live="polite">
        {bucket?.loading && !bucket.loaded ? (
          <div className="h-full flex items-center justify-center">
            <Spinner className="size-6" />
          </div>
        ) : bucket?.error ? (
          <EmptyState title="Não foi possível carregar as mensagens">{bucket.error}</EmptyState>
        ) : (
          <>
            {bucket && !bucket.hasMore ? <div className="px-5 pt-6 pb-2">{intro}</div> : null}
            {bucket?.loading && bucket.loaded ? (
              <div className="flex justify-center py-3">
                <Spinner />
              </div>
            ) : null}
            {items.map((m, i) => {
              const prev = items[i - 1];
              const newDay = !prev || !sameDay(prev.created_at, m.created_at);
              const grouped =
                !!prev &&
                !newDay &&
                prev.author_id === m.author_id &&
                prev.author_kind === m.author_kind &&
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_MS;
              return (
                <div key={m.id}>
                  {newDay && i > 0 ? <DateDivider iso={m.created_at} /> : null}
                  <MessageItem m={m} grouped={grouped} serverId={serverId} canModerate={canModerate} target={target} />
                </div>
              );
            })}
          </>
        )}
      </div>
      <div className="h-5 px-5 text-[12px] text-fg-3 shrink-0">
        {typingNames.length ? (
          <span>
            <b className="text-fg-2">{typingNames.slice(0, 3).join(', ')}</b> {typingNames.length > 1 ? 'estão digitando…' : 'está digitando…'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
