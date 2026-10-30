import { useEffect, useState } from 'react';
import { Bell, Copy, Minus, Search, Square, UsersRound, X } from 'lucide-react';
import { desktop } from '../../lib/platform';
import { useApp } from '../../store/app';
import { cx, IconButton } from '../ui';
import { LogoMark } from '../Logo';
import { NotificationsPopover } from '../overlays/NotificationsPopover';
import { useIsMobile } from '../../lib/useMedia';

export function TitleBar() {
  const setSearch = useApp((s) => s.setSearch);
  const notifications = useApp((s) => s.notifications);
  const open = useApp((s) => s.notificationsOpen);
  const setOpen = useApp((s) => s.setNotificationsOpen);
  const selectHome = useApp((s) => s.selectHome);
  const setModal = useApp((s) => s.setModal);
  const unread = notifications.filter((n) => !n.read_at).length;
  const [maximized, setMaximized] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!desktop) return;
    void desktop.window.isMaximized().then(setMaximized);
    return desktop.window.onMaximizedChange(setMaximized);
  }, []);

  return (
    <header className={cx('h-14 shrink-0 flex items-center gap-3 pl-0 pr-2 select-none', desktop && 'nx-drag')}>
      <div className="w-[72px] flex justify-center shrink-0">
        <LogoMark size={30} />
      </div>
      <span className="font-bold tracking-[0.05em] text-[17px] text-fg -ml-1">NEXUS</span>

      <div className="flex-1 flex justify-center px-4">
        <button
          onClick={() => setSearch(true)}
          className="nx-no-drag w-full max-w-[490px] h-9 rounded-xl bg-[#151a24] border border-line/80 flex items-center gap-2.5 px-3.5 text-sm text-fg-3 hover:border-[#2c3546] transition-colors"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Buscar em NEXUS…</span>
          <kbd className="hidden md:inline text-[11px] text-fg-3 border border-line rounded px-1.5 py-0.5">Ctrl K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1 nx-no-drag relative">
        <IconButton label="Notificações" onClick={() => setOpen(!open)} active={open}>
          <span className="relative">
            <Bell className="size-[19px]" />
            {unread > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-danger text-[10px] font-bold text-white flex items-center justify-center">
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </span>
        </IconButton>
        <IconButton
          label="Mensagens privadas"
          onClick={() => {
            selectHome();
            setModal({ kind: 'newDm' });
          }}
        >
          <UsersRound className="size-[19px]" />
        </IconButton>
        {open && !isMobile ? <NotificationsPopover onClose={() => setOpen(false)} /> : null}
      </div>

      {desktop ? (
        <div className="flex items-center nx-no-drag ml-2 border-l border-line pl-2">
          <button className="size-10 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-raised rounded-lg" aria-label="Minimizar" onClick={() => desktop!.window.minimize()}>
            <Minus className="size-4" />
          </button>
          <button
            className="size-10 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-raised rounded-lg"
            aria-label={maximized ? 'Restaurar' : 'Maximizar'}
            onClick={() => desktop!.window.toggleMaximize()}
          >
            {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
          </button>
          <button
            className="size-10 flex items-center justify-center text-fg-2 hover:text-white hover:bg-danger rounded-lg"
            aria-label="Fechar (continua na bandeja)"
            title="Fechar (o NEXUS continua rodando na bandeja)"
            onClick={() => desktop!.window.close()}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
    </header>
  );
}
