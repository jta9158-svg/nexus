import type { ReactNode } from 'react';
import { Menu, PanelRight } from 'lucide-react';
import { useApp } from '../../store/app';
import { cx, IconButton } from '../ui';

export function ViewHeader({
  icon,
  title,
  subtitle,
  actions,
  rightPanel,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  rightPanel?: boolean;
  className?: string;
}) {
  const setMobileNav = useApp((s) => s.setMobileNav);
  const rightOpen = useApp((s) => s.rightPanelOpen);
  const setRight = useApp((s) => s.setRightPanel);
  return (
    <div className={cx('h-14 shrink-0 flex items-center gap-2 px-3 sm:px-5 border-b border-line-soft', className)}>
      <IconButton label="Abrir menu" className="md:hidden -ml-1" onClick={() => setMobileNav(true)}>
        <Menu className="size-5" />
      </IconButton>
      {icon ? <span className="text-fg-3 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex items-baseline gap-3 flex-1">
        <h1 className="text-[17px] font-semibold text-fg truncate shrink-0 max-w-[70%]">{title}</h1>
        {subtitle ? <span className="hidden sm:block min-w-0 text-[13px] text-fg-3 truncate">{subtitle}</span> : null}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {actions}
        {rightPanel ? (
          <IconButton label={rightOpen ? 'Esconder painel' : 'Mostrar painel (call, Claude, membros)'} active={rightOpen} className="xl:hidden" onClick={() => setRight(!rightOpen)}>
            <PanelRight className="size-5" />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
