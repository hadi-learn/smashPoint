export function Shuttle({ size = 20, className = '', style }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 64 64" aria-label="shuttlecock" role="img">
      <defs>
        <linearGradient id="sp-feather" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#fde68a" />
        </linearGradient>
      </defs>
      <path d="M14 6 L50 6 L40 38 L24 38 Z" fill="url(#sp-feather)" stroke="#eab308" strokeWidth="2" strokeLinejoin="round" />
      <path d="M24 6 L28 38 M32 6 L32 38 M40 6 L36 38" stroke="#ca8a04" strokeWidth="1.5" />
      <path d="M22 26 L42 26" stroke="#ca8a04" strokeWidth="1.5" />
      <rect x="23" y="37" width="18" height="6" rx="2" fill="#facc15" stroke="#a16207" strokeWidth="1.5" />
      <path d="M23 43 Q32 62 41 43 Z" fill="#facc15" stroke="#a16207" strokeWidth="2" />
    </svg>
  );
}

export function Target({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="target" role="img">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}
