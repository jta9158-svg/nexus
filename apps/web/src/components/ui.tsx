import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Bot, Loader2, X } from 'lucide-react';
import { colorFromString, initials } from '../lib/format';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------
// Botões
// ---------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong shadow-[0_6px_20px_-8px_rgb(91_124_255/0.7)]',
  secondary: 'bg-raised text-fg hover:bg-[#232a3a] border border-line',
  ghost: 'text-fg-2 hover:text-fg hover:bg-raised',
  danger: 'bg-danger/90 text-white hover:bg-danger',
  success: 'bg-success-strong text-white hover:bg-success shadow-[0_6px_20px_-8px_rgb(34_197_94/0.7)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-5 text-[15px] rounded-xl gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-medium transition-colors select-none disabled:opacity-50 whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tone?: 'default' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, tone = 'default', size = 'md', className, children, ...rest },
  ref,
) {
  const dims = size === 'sm' ? 'size-8 rounded-lg' : size === 'lg' ? 'size-11 rounded-xl' : 'size-9 rounded-lg';
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex items-center justify-center transition-colors shrink-0 disabled:opacity-40',
        dims,
        tone === 'danger'
          ? 'bg-danger/15 text-danger hover:bg-danger/25'
          : tone === 'success'
            ? 'bg-success/15 text-success hover:bg-success/25'
            : active
              ? 'bg-raised text-fg'
              : 'text-fg-2 hover:text-fg hover:bg-raised',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------
const fieldBase =
  'w-full rounded-xl bg-[#0d1118] border border-line text-fg placeholder:text-fg-3 px-3.5 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(fieldBase, 'py-2.5 min-h-20 resize-y', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(fieldBase, 'h-10 pr-8 appearance-none bg-no-repeat', className)} {...rest}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a3abba' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 10px center',
      }}
    >
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-fg-2 mb-1.5">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-danger mt-1.5">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-fg-3 mt-1.5">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className="text-sm text-fg font-medium cursor-pointer">
          {label}
        </label>
        {description ? <p className="text-xs text-fg-3 mt-0.5">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 rounded-full transition-colors shrink-0 disabled:opacity-50',
          checked ? 'bg-success' : 'bg-[#2a3243]',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------
export type StatusKind = 'online' | 'idle' | 'dnd' | 'offline';

const statusColor: Record<StatusKind, string> = {
  online: 'bg-success',
  idle: 'bg-warn',
  dnd: 'bg-danger',
  offline: 'bg-[#5b6375]',
};

export function StatusDot({ status, className }: { status: StatusKind; className?: string }) {
  return <span className={cx('inline-block rounded-full', statusColor[status], className)} />;
}

export function Avatar({
  name,
  url,
  size = 40,
  status,
  speaking,
  className,
  ringColor = '#10141b',
}: {
  name: string;
  url?: string | null;
  size?: number;
  status?: StatusKind;
  speaking?: boolean;
  className?: string;
  ringColor?: string;
}) {
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <span
      className={cx('relative inline-flex shrink-0 rounded-full', speaking && 'ring-2 ring-success ring-offset-2 ring-offset-[#10141b]', className)}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="size-full rounded-full object-cover bg-raised" draggable={false} loading="lazy" />
      ) : (
        <span
          className="size-full rounded-full flex items-center justify-center font-semibold text-white select-none"
          style={{ background: colorFromString(name), fontSize: Math.max(10, size * 0.38) }}
          aria-hidden
        >
          {initials(name)}
        </span>
      )}
      {status ? (
        <span
          className={cx('absolute -bottom-0.5 -right-0.5 rounded-full', statusColor[status])}
          style={{ width: dot, height: dot, boxShadow: `0 0 0 3px ${ringColor}` }}
          aria-label={status === 'online' ? 'Online' : status === 'idle' ? 'Ausente' : status === 'dnd' ? 'Não perturbe' : 'Offline'}
        />
      ) : null}
    </span>
  );
}

export function ClaudeAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full text-white', className)}
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, #8b7cf6 0%, #6d5ce8 55%, #5b7cff 100%)',
        boxShadow: '0 0 0 1px rgb(255 255 255 / 0.08) inset',
      }}
      aria-hidden
    >
      <Bot style={{ width: size * 0.52, height: size * 0.52 }} strokeWidth={2.1} />
    </span>
  );
}

// ---------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-fg-3', className ?? 'size-5')} />;
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'violet';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-raised text-fg-2 border-line',
    accent: 'bg-accent/15 text-mention border-accent/25',
    success: 'bg-success/12 text-success border-success/25',
    warn: 'bg-warn/12 text-warn border-warn/25',
    danger: 'bg-danger/12 text-danger border-danger/25',
    violet: 'bg-violet/15 text-[#b9a6ff] border-violet/25',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none', tones[tone], className)}>
      {children}
    </span>
  );
}

export function CountBadge({ count, tone = 'danger' }: { count: number; tone?: 'danger' | 'neutral' }) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        'inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none',
        tone === 'danger' ? 'bg-danger text-white' : 'bg-raised text-fg-2',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center px-6 py-10', className)}>
      {icon ? <div className="mb-3 text-fg-3">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {children ? <div className="mt-1.5 text-sm text-fg-2 max-w-md">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-[14px] border border-line bg-card', className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-fg-3">{children}</h3>
      {action}
    </div>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' | 'warn' }) {
  const color = tone === 'success' ? 'bg-success' : tone === 'warn' ? 'bg-warn' : 'bg-accent';
  return (
    <div className="h-1.5 w-full rounded-full bg-[#0d1118] overflow-hidden">
      <div className={cx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ value: T; label: ReactNode; count?: number }>;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('flex gap-1 overflow-x-auto nx-scroll', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'h-8 px-3 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors inline-flex items-center gap-1.5',
            value === it.value ? 'bg-raised text-fg' : 'text-fg-2 hover:text-fg hover:bg-raised/60',
          )}
        >
          {it.label}
          {it.count ? <span className="text-[11px] text-fg-3">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  bare,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  bare?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button[data-autofocus]');
      el?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 animate-fade-in" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panelRef}
        className={cx(
          'relative w-full max-h-[92dvh] flex flex-col bg-[#131822] border border-line shadow-2xl animate-slide-up',
          'rounded-t-2xl sm:rounded-2xl nx-safe-bottom',
          widths[size],
        )}
      >
        {bare ? (
          children
        ) : (
          <>
            {title ? (
              <div className="flex items-start gap-3 px-5 pt-5 pb-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-fg">{title}</h2>
                  {description ? <p className="text-sm text-fg-2 mt-1">{description}</p> : null}
                </div>
                <IconButton label="Fechar" onClick={onClose} size="sm">
                  <X className="size-4" />
                </IconButton>
              </div>
            ) : null}
            <div className="px-5 pb-5 overflow-y-auto nx-scroll">{children}</div>
            {footer ? <div className="px-5 py-4 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div> : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-accent/30 bg-accent/8 text-fg',
    warn: 'border-warn/30 bg-warn/8 text-fg',
    danger: 'border-danger/30 bg-danger/8 text-fg',
    success: 'border-success/30 bg-success/8 text-fg',
  };
  return (
    <div className={cx('rounded-xl border px-3.5 py-3 text-sm', tones[tone], className)}>
      {title ? <div className="font-semibold mb-0.5">{title}</div> : null}
      {children ? <div className="text-fg-2">{children}</div> : null}
    </div>
  );
}
