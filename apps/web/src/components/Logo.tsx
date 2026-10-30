export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="nxa" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7DB4FF" />
          <stop offset="0.55" stopColor="#5B7CFF" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="nxb" x1="16" y1="10" x2="48" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2F5BFF" />
          <stop offset="1" stopColor="#5B32D6" />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="13" height="44" rx="4.5" fill="url(#nxa)" />
      <rect x="41" y="10" width="13" height="44" rx="4.5" fill="url(#nxa)" />
      <path
        d="M12.2 13.6c-1.1-1.7.1-3.6 2.1-3.6h6.3c1.5 0 2.9.8 3.7 2.1l26.9 40.3c1.1 1.7-.1 3.6-2.1 3.6h-6.3c-1.5 0-2.9-.8-3.7-2.1z"
        fill="url(#nxb)"
      />
      <path d="M23 12.4 41 39.5V54L23 26.9z" fill="#fff" fillOpacity="0.1" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <LogoMark size={size + 4} />
      <span className="font-bold tracking-[0.04em] text-fg" style={{ fontSize: size * 0.82 }}>
        NEXUS
      </span>
    </span>
  );
}
