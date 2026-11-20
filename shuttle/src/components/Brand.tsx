export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className="brand" href="#/" aria-label="Shuttle, all recordings">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 16c4.4-7.4 17.6-7.4 22 0-4.4 7.4-17.6 7.4-22 0Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="3.8" className="brand-dot" />
      </svg>
      {!compact && <span className="brand-word">Shuttle</span>}
    </a>
  );
}
