import { useEffect, useRef } from 'react';
import { AtSign, Bell, CheckCheck, HelpCircle, MessageSquare, Sparkles, UserPlus } from 'lucide-react';
import { useApp } from '../../store/app';
import { formatRelative } from '../../lib/format';
import { ensureNotificationPermission } from '../../lib/notify';
import type { NotificationRow } from '../../types/db';
import { cx } from '../ui';

const ICON: Record<NotificationRow['kind'], React.ReactNode> = {
  mention: <AtSign className="size-4" />,
  dm: <MessageSquare className="size-4" />,
  invite: <Bell className="size-4" />,
  task: <Sparkles className="size-4" />,
  question: <HelpCircle className="size-4" />,
  claude: <Sparkles className="size-4" />,
  system: <Bell className="size-4" />,
  friend: <UserPlus className="size-4" />,
};

export function NotificationsPopover({ onClose }: { onClose: () => void }) {
  const notifications = useApp((s) => s.notifications);
  const markRead = useApp((s) => s.markNotificationsRead);
  const openChannel = useApp((s) => s.openChannel);
  const openDm = useApp((s) => s.openDm);
  const openView = useApp((s) => s.openView);
  const selectServer = useApp((s) => s.selectServer);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', fn), 0);
    document.addEventListener('keydown', key);
    void ensureNotificationPermission();
    return () => {
      document.removeEventListener('mousedown', fn);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const go = async (n: NotificationRow) => {
    void markRead([n.id]);
    onClose();
    if (n.link.dm_thread_id) openDm(n.link.dm_thread_id);
    else if (n.link.server_id && n.link.channel_id) {
      await selectServer(n.link.server_id);
      openChannel(n.link.server_id, n.link.channel_id);
    } else if (n.link.task_id || n.link.question_id) openView({ kind: 'companion' });
    else if (n.link.friends) openView({ kind: 'friends' });
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-11 z-40 w-[min(380px,calc(100vw-24px))] rounded-2xl border border-line bg-[#141924] shadow-2xl animate-slide-up overflow-hidden"
      role="dialog"
      aria-label="Notificações"
    >
      <div className="flex items-center justify-between px-4 h-12 border-b border-line-soft">
        <span className="font-semibold">Notificações</span>
        <button className="text-[13px] text-mention hover:underline flex items-center gap-1" onClick={() => void markRead()}>
          <CheckCheck className="size-4" /> Marcar todas como lidas
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto nx-scroll">
        {notifications.length === 0 ? (
          <p className="text-sm text-fg-3 text-center py-10">Nenhuma notificação.</p>
        ) : (
          notifications.map((n) => (
            <button key={n.id} onClick={() => void go(n)} className={cx('w-full flex gap-3 px-4 py-3 text-left hover:bg-raised/50 border-b border-line-soft last:border-0', !n.read_at && 'bg-accent/[0.05]')}>
              <span className={cx('size-8 rounded-full flex items-center justify-center shrink-0', n.kind === 'question' ? 'bg-warn/15 text-warn' : n.kind === 'mention' ? 'bg-accent/15 text-mention' : 'bg-raised text-fg-2')}>
                {ICON[n.kind]}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[14px] truncate', n.read_at ? 'text-fg-2' : 'text-fg font-medium')}>{n.title}</span>
                {n.body ? <span className="block text-[13px] text-fg-3 line-clamp-2">{n.body}</span> : null}
                <span className="block text-[11.5px] text-fg-3 mt-0.5">{formatRelative(n.created_at)}</span>
              </span>
              {!n.read_at ? <span className="size-2 rounded-full bg-accent mt-2 shrink-0" /> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
