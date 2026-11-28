// The Mainstreet mark: a storefront with an awning, in the accent colour.

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <path d="M14 26h36l-3-10H17z" fill="var(--accent-ink)" />
      <path d="M14 26c0 4 3 6 6 6s6-2 6-6c0 4 3 6 6 6s6-2 6-6c0 4 3 6 6 6s6-2 6-6" fill="none" stroke="var(--accent-ink)" strokeWidth="3" />
      <path d="M18 34v14h28V34" fill="none" stroke="var(--accent-ink)" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M28 48v-9h8v9" fill="var(--accent-ink)" />
    </svg>
  );
}
