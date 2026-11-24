"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Bot, ChevronRight, CircleDollarSign, Ellipsis, Film, Inbox, Kanban, LayoutDashboard, LogOut, Megaphone, Radar, Settings, Store, X, Zap } from "lucide-react";
import { openCopilot } from "./copilot/Copilot";
import { useOverlay } from "./client";
import { InstallButton, useInstall } from "./pwa";
import { RainMark } from "./ui";

const NAV = [
  { href: "/", label: "Today", short: "Today", icon: LayoutDashboard },
  { href: "/prospects", label: "Find clients", short: "Find", icon: Radar },
  { href: "/pipeline", label: "Pipeline", short: "Pipeline", icon: Kanban },
  { href: "/inbox", label: "Inbox", short: "Inbox", icon: Inbox, badge: true },
  { href: "/ads", label: "Ad Studio", short: "Ads", icon: Megaphone },
  { href: "/agents", label: "Agents", short: "Agents", icon: Bot },
  { href: "/autopilot", label: "Autopilot", short: "Autopilot", icon: Zap },
];

const SELL = [
  { href: "/sales", label: "Sales", icon: CircleDollarSign },
  { href: "/sell", label: "Store & pricing", icon: Store },
];

const MORE = [
  { href: "/ads", label: "Ad Studio", sub: "Tailored ads for any business", icon: Megaphone },
  { href: "/ads?mode=video", label: "Video ads", sub: "A video for the owner, from their real data", icon: Film },
  { href: "/agents", label: "Agents", sub: "Give a goal, watch it work", icon: Bot },
  { href: "/autopilot", label: "Autopilot", sub: "Finds, pitches and onboards clients daily", icon: Zap },
  { href: "/sales", label: "Sales", sub: "Orders, recurring revenue, onboarding", icon: CircleDollarSign },
  { href: "/sell", label: "Store & pricing", sub: "Your sales page, prices and payments", icon: Store },
  { href: "/playbooks", label: "Playbooks", sub: "How agencies land clients", icon: BookOpen },
  { href: "/settings", label: "Settings", sub: "Your agency, keys, data", icon: Settings },
];

const TITLES: [string, string][] = [
  ["/prospects", "Find clients"],
  ["/pipeline", "Pipeline"],
  ["/inbox", "Inbox"],
  ["/ads", "Ad Studio"],
  ["/agents", "Agents"],
  ["/playbooks", "Playbooks"],
  ["/autopilot", "Autopilot"],
  ["/sales", "Sales"],
  ["/sell", "Store & pricing"],
  ["/settings", "Settings"],
  ["/share", "Shared to Rainmaker"],
];

async function signOut() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
}

export function Sidebar({ inbox, claude, runtime, agencyName, canSignOut }: { inbox: number; claude: boolean; runtime: string; agencyName: string; canSignOut: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const { canInstall, install } = useInstall();
  useEffect(() => setMore(false), [path]);
  useOverlay(more, () => setMore(false));
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const title = TITLES.find(([p]) => path.startsWith(p))?.[1] ?? "Rainmaker";
  const moreActive = MORE.some((m) => active(m.href));

  // Refresh server data when the app comes back to the foreground.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  return (
    <>
      {/* Phones: top bar */}
      <header className="mobile-bar">
        <Link href="/" className="row" style={{ gap: 9 }} aria-label="Rainmaker home">
          <span className="brand-mark" style={{ width: 28, height: 28, borderRadius: 8 }}>
            <RainMark size={16} />
          </span>
        </Link>
        <span className="mobile-title truncate">{path === "/" ? "Rainmaker" : title}</span>
        <span className="spacer" />
        <button type="button" className="copilot-launch-sm" onClick={openCopilot} aria-label="Open the copilot">
          <span className="orb idle tone-sky" aria-hidden />
        </button>
        <InstallButton className="btn sm primary" label="Install" />
        <span className={`dot ${claude ? "" : "off"}`} title={claude ? "Claude connected" : "Demo mode"} style={{ marginRight: 4 }} />
      </header>

      {/* Desktop: sidebar */}
      <nav className="sidebar" aria-label="Main">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <RainMark />
          </span>
          <span className="brand-name">Rainmaker</span>
        </Link>
        <button type="button" className="copilot-launch" onClick={openCopilot} title="Tell the copilot what to do, by voice or text">
          <span className="orb idle tone-sky" aria-hidden />
          Copilot
          <kbd aria-hidden>⌘K</kbd>
        </button>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav-link" aria-current={active(n.href) ? "page" : undefined}>
            <n.icon size={17} aria-hidden />
            {n.label}
            {n.badge && inbox > 0 && <span className="count">{inbox}</span>}
          </Link>
        ))}
        <div className="nav-label">Sell</div>
        {SELL.map((n) => (
          <Link key={n.href} href={n.href} className="nav-link" aria-current={active(n.href) ? "page" : undefined}>
            <n.icon size={17} aria-hidden />
            {n.label}
          </Link>
        ))}
        <div className="nav-label">Learn</div>
        <Link href="/playbooks" className="nav-link" aria-current={active("/playbooks") ? "page" : undefined}>
          <BookOpen size={17} aria-hidden />
          Playbooks
        </Link>
        <div className="sidebar-foot">
          <Link href="/settings" className="nav-link" aria-current={active("/settings") ? "page" : undefined}>
            <Settings size={17} aria-hidden />
            Settings
          </Link>
          {canSignOut && (
            <button className="nav-link" style={{ border: 0, background: "none", cursor: "pointer", width: "100%" }} onClick={() => void signOut()}>
              <LogOut size={17} aria-hidden />
              Sign out
            </button>
          )}
          <Link href="/settings" className="status-pill">
            <span className={`dot ${claude ? "" : "off"}`} />
            <span className="truncate">
              <b>{claude ? "Claude connected" : "Demo mode"}</b>
              <br />
              <span className="faint">
                {claude ? (runtime === "managed" ? "Managed Agents" : "Messages API") : "Add an API key"} · {agencyName}
              </span>
            </span>
          </Link>
        </div>
      </nav>

      {/* Phones: bottom tabs */}
      <nav className="bottom-nav" aria-label="Main">
        {NAV.slice(0, 4).map((n) => (
          <Link key={n.href} href={n.href} className="tab-link" aria-current={active(n.href) ? "page" : undefined}>
            <span className="tab-icon">
              <n.icon size={21} aria-hidden />
              {n.badge && inbox > 0 && <span className="tab-badge">{inbox > 9 ? "9+" : inbox}</span>}
            </span>
            {n.short}
          </Link>
        ))}
        <button className="tab-link" aria-current={moreActive ? "page" : undefined} aria-expanded={more} onClick={() => setMore(true)}>
          <span className="tab-icon">
            <Ellipsis size={21} aria-hidden />
          </span>
          More
        </button>
      </nav>

      {more && (
        <>
          <div className="scrim" style={{ zIndex: 70 }} onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More">
            <div className="sheet-handle" />
            <div className="row between" style={{ padding: "4px 6px 10px" }}>
              <b style={{ fontSize: 16 }}>More</b>
              <button className="btn ghost icon sm" onClick={() => setMore(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {MORE.map((m) => (
                <Link key={m.href} href={m.href} className="sheet-link" aria-current={active(m.href) ? "page" : undefined} onClick={() => setMore(false)}>
                  <span className="icon-tile lg">
                    <m.icon size={19} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>{m.label}</div>
                    <div className="faint small">{m.sub}</div>
                  </span>
                  <ChevronRight size={18} className="faint" />
                </Link>
              ))}
              {canInstall && (
                <button className="sheet-link" onClick={() => void install()}>
                  <span className="icon-tile lg" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
                    <RainMark size={19} />
                  </span>
                  <span style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontWeight: 650 }}>Install Rainmaker</div>
                    <div className="faint small">Add it to your home screen like an app</div>
                  </span>
                </button>
              )}
              {canSignOut && (
                <button className="sheet-link" onClick={() => void signOut()}>
                  <span className="icon-tile lg" style={{ background: "var(--sunken)", color: "var(--text-2)" }}>
                    <LogOut size={19} />
                  </span>
                  <span style={{ flex: 1, textAlign: "left", fontWeight: 650 }}>Sign out</span>
                </button>
              )}
            </div>
            <div className="faint small" style={{ padding: "12px 6px 2px" }}>
              {claude ? "Claude connected" : "Demo mode: add an API key in Settings"} · {agencyName}
            </div>
          </div>
        </>
      )}
    </>
  );
}
