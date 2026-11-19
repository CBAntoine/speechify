import Link from "next/link";
import { SITE } from "@/lib/site";
import { REGIONS } from "@/lib/data";
import AskButton from "./AskButton";

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id="lg-sunset" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4f9a" />
          <stop offset="0.55" stopColor="#ff7a59" />
          <stop offset="1" stopColor="#ffb347" />
        </linearGradient>
        <linearGradient id="lg-lagoon" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#25e2d0" />
          <stop offset="1" stopColor="#4db2ff" />
        </linearGradient>
      </defs>
      <path d="M16 2.5c-6 0-10.8 4.7-10.8 10.6C5.2 20.8 16 29.5 16 29.5s10.8-8.7 10.8-16.4C26.8 7.2 22 2.5 16 2.5z" fill="url(#lg-sunset)" />
      <circle cx="16" cy="13" r="5.4" fill="#0a0a14" />
      <path d="M12.4 13.6c1.2-1.6 2.4-1.6 3.6 0s2.4 1.6 3.6 0" stroke="url(#lg-lagoon)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="brand" aria-label={`${SITE.name} home`}>
          <Logo />
          <span className="brand__text">
            <span className="brand__name">{SITE.name}</span>
            <span className="brand__sub">Unofficial GTA VI guide</span>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/#map">Map</Link>
          <Link href="/news">Intel</Link>
          <Link href="/tips">Tips</Link>
          <Link href="/regions/vice-city">Regions</Link>
          <Link href="/crew-pass" className="site-nav__crew">
            Crew Pass
          </Link>
        </nav>
        <span className="launch-pill" title="GTA VI released November 19, 2026">
          <span className="live-dot" aria-hidden="true" /> Launch week
        </span>
        <AskButton />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link href="/" className="brand">
            <Logo size={26} />
            <span className="brand__name">{SITE.name}</span>
          </Link>
          <p>{SITE.tagline}. Secrets, tips and news for GTA VI, checked and sourced, updated daily.</p>
        </div>
        <nav className="site-footer__cols" aria-label="Footer">
          <div>
            <h3>Explore</h3>
            <Link href="/#map">Live map</Link>
            <Link href="/news">Daily intel</Link>
            <Link href="/tips">Tips &amp; tricks</Link>
            <Link href="/crew-pass">Crew Pass</Link>
          </div>
          <div>
            <h3>Regions</h3>
            {REGIONS.map((r) => (
              <Link key={r.id} href={`/regions/${r.id}`}>
                {r.name}
              </Link>
            ))}
          </div>
          <div>
            <h3>About</h3>
            <Link href="/about">How we verify</Link>
            <Link href="/about#advertise">Advertise</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </nav>
      </div>
      <p className="site-footer__legal">{SITE.disclaimer}</p>
    </footer>
  );
}
