import { useMemo, type ReactElement } from 'react';
import { colorFromString } from '../../lib/format';

function serverInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 || /^\p{N}+$/u.test(w));
  const list = words.length ? words : name.split(/\s+/).filter(Boolean);
  return ((list[0]?.[0] ?? '?') + (list[1]?.[0] ?? '')).toUpperCase();
}
import { cx } from '../ui';

// Arte padrão do banner do servidor: céu noturno com templos (desenho original).
function pagoda(x: number, base: number, s: number, tiers: number, key: string) {
  const parts: ReactElement[] = [];
  let y = base;
  let w = 22;
  parts.push(<rect key={`${key}-b`} x={x - w - 4} y={y - 6} width={(w + 4) * 2} height={6} />);
  y -= 6;
  for (let i = 0; i < tiers; i++) {
    const h = 13 - i * 1.4;
    const bw = w - 6;
    parts.push(<rect key={`${key}-w${i}`} x={x - bw} y={y - h} width={bw * 2} height={h} />);
    // janelas acesas
    for (let j = -1; j <= 1; j++) {
      parts.push(
        <rect key={`${key}-l${i}${j}`} x={x + j * (bw * 0.55) - 1.6} y={y - h + 4} width={3.2} height={h - 7} fill="#ffcf7a" opacity={0.75 - i * 0.12} />,
      );
    }
    y -= h;
    const r = w + 7;
    parts.push(
      <path
        key={`${key}-r${i}`}
        d={`M${x - r - 4},${y + 1} C${x - r + 4},${y - 1} ${x - w},${y - 6} ${x},${y - 9} C${x + w},${y - 6} ${x + r - 4},${y - 1} ${x + r + 4},${y + 1} L${x + r - 2},${y + 2.5} C${x + w * 0.6},${y - 1} ${x - w * 0.6},${y - 1} ${x - r + 2},${y + 2.5} Z`}
      />,
    );
    y -= 7;
    w = w * 0.78;
  }
  parts.push(<rect key={`${key}-sp`} x={x - 0.9} y={y - 14} width={1.8} height={16} />);
  parts.push(<circle key={`${key}-sc`} cx={x} cy={y - 15} r={2} />);
  return (
    <g key={key} transform={`translate(${x * (1 - s)}, ${base * (1 - s)}) scale(${s})`}>
      {parts}
    </g>
  );
}

export function ServerBanner({ seed, className }: { seed: string; className?: string }) {
  const stars = useMemo(() => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
    const rand = () => {
      h = (h * 1664525 + 1013904223) >>> 0;
      return h / 4294967296;
    };
    return Array.from({ length: 70 }, () => ({ x: rand() * 400, y: rand() * 85, r: rand() * 0.9 + 0.2, o: rand() * 0.7 + 0.2 }));
  }, [seed]);

  return (
    <svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" className={cx('block', className)} aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1640" />
          <stop offset="0.55" stopColor="#1a2f7a" />
          <stop offset="1" stopColor="#3b3c9e" />
        </linearGradient>
        <radialGradient id="moon" cx="0.86" cy="0.5" r="0.3">
          <stop offset="0" stopColor="#c7d4ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c7d4ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#0b0e14" stopOpacity="0" />
          <stop offset="1" stopColor="#0b0e14" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <rect width="400" height="150" fill="url(#sky)" />
      <rect width="400" height="150" fill="url(#moon)" />
      <circle cx="352" cy="74" r="7" fill="#e8eeff" opacity="0.85" />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
      ))}
      <path d="M0,118 C40,96 70,104 110,92 C150,80 190,100 230,90 C270,80 320,98 400,86 L400,150 L0,150 Z" fill="#14205a" opacity="0.9" />
      <g fill="#0a1233">
        {pagoda(90, 132, 0.85, 3, 'a')}
        {pagoda(200, 140, 1.15, 4, 'b')}
        {pagoda(318, 134, 0.95, 3, 'c')}
        <path d="M0,140 L400,140 L400,150 L0,150 Z" />
      </g>
      <rect width="400" height="150" fill="url(#fade)" />
    </svg>
  );
}

export function ServerIcon({
  name,
  url,
  size = 48,
  className,
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  if (url) {
    return <img src={url} alt="" className={cx('object-cover', className)} style={{ width: size, height: size }} draggable={false} />;
  }
  const c = colorFromString(name);
  return (
    <span
      className={cx('flex items-center justify-center font-bold text-white select-none', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        background: `linear-gradient(135deg, ${c} 0%, #1b2130 140%)`,
      }}
    >
      {serverInitials(name)}
    </span>
  );
}
