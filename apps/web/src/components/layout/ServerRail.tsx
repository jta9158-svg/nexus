import { Gamepad2, Plus } from 'lucide-react';
import { useApp, serverUnread } from '../../store/app';
import { cx } from '../ui';
import { ServerIcon } from './ServerArt';

function RailItem({
  active,
  label,
  onClick,
  children,
  unread,
  mentions,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  unread?: boolean;
  mentions?: number;
}) {
  return (
    <div className="relative flex justify-center group w-full">
      <span
        className={cx(
          'absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-fg transition-all',
          active ? 'h-10' : unread ? 'h-2' : 'h-0 group-hover:h-5',
        )}
      />
      <button
        onClick={onClick}
        aria-label={label}
        title={label}
        className={cx(
          'relative size-12 overflow-hidden transition-all duration-150 flex items-center justify-center',
          active ? 'rounded-[16px] ring-2 ring-accent/70 ring-offset-2 ring-offset-ink' : 'rounded-[24px] hover:rounded-[16px]',
        )}
      >
        {children}
      </button>
      {mentions ? (
        <span className="absolute bottom-0 right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center ring-[3px] ring-ink">
          {mentions > 99 ? '99+' : mentions}
        </span>
      ) : null}
    </div>
  );
}

export function ServerRail({ className }: { className?: string }) {
  const servers = useApp((s) => s.servers);
  const active = useApp((s) => s.activeServerId);
  const view = useApp((s) => s.view);
  const selectServer = useApp((s) => s.selectServer);
  const selectHome = useApp((s) => s.selectHome);
  const setModal = useApp((s) => s.setModal);
  useApp((s) => s.unread); // re-render quando mudar
  const dmUnread = Object.values(useApp.getState().unread)
    .filter((u) => !u.serverId)
    .reduce((a, b) => a + b.unread, 0);

  const homeActive = active === null && (view.kind === 'home' || view.kind === 'dm' || view.kind === 'claude' || view.kind === 'companion');

  return (
    <nav className={cx('w-[72px] shrink-0 flex flex-col items-center gap-2 py-2 overflow-y-auto nx-scroll', className)} aria-label="Servidores">
      <RailItem active={homeActive} label="Início e mensagens privadas" onClick={selectHome} mentions={dmUnread}>
        <span className={cx('size-full flex items-center justify-center', homeActive ? 'bg-accent text-white' : 'bg-[#1a1f2b] text-fg-2 hover:bg-accent hover:text-white')}>
          <Gamepad2 className="size-6" />
        </span>
      </RailItem>
      <div className="w-8 h-px bg-line my-1" />
      {servers.map((s) => {
        const u = serverUnread(s.id);
        return (
          <RailItem
            key={s.id}
            active={active === s.id}
            label={s.name}
            onClick={() => void selectServer(s.id)}
            unread={u.unread > 0}
            mentions={u.mentions}
          >
            <ServerIcon name={s.name} url={s.icon_url} size={48} />
          </RailItem>
        );
      })}
      <RailItem active={false} label="Criar ou entrar em um servidor" onClick={() => setModal({ kind: 'createServer' })}>
        <span className="size-full flex items-center justify-center bg-[#1a1f2b] text-success hover:bg-success hover:text-white transition-colors">
          <Plus className="size-6" />
        </span>
      </RailItem>
    </nav>
  );
}
