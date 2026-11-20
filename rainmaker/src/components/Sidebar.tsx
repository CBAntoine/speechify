"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Bot, Inbox, Kanban, LayoutDashboard, Megaphone, Menu, Radar, Settings } from "lucide-react";
import { RainMark } from "./ui";

const NAV = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/prospects", label: "Find clients", icon: Radar },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/inbox", label: "Inbox", icon: Inbox, countKey: "inbox" as const },
  { href: "/ads", label: "Ad Studio", icon: Megaphone },
  { href: "/agents", label: "Agents", icon: Bot },
];

export function Sidebar({ inbox, claude, runtime, agencyName }: { inbox: number; claude: boolean; runtime: string; agencyName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <>
      <div className="mobile-bar">
        <button className="btn ghost icon" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <span className="brand-mark" style={{ width: 26, height: 26 }}>
          <RainMark size={15} />
        </span>
        <span className="brand-name" style={{ fontSize: 16 }}>
          Rainmaker
        </span>
      </div>
      {open && <div className="scrim" style={{ zIndex: 59 }} onClick={() => setOpen(false)} />}
      <nav className={`sidebar ${open ? "open" : ""}`} aria-label="Main">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <RainMark />
          </span>
          <span className="brand-name">Rainmaker</span>
        </Link>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav-link" aria-current={active(n.href) ? "page" : undefined}>
            <n.icon size={17} aria-hidden />
            {n.label}
            {n.countKey === "inbox" && inbox > 0 && <span className="count">{inbox}</span>}
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
          <Link href="/settings" className="status-pill">
            <span className={`dot ${claude ? "" : "off"}`} />
            <span className="truncate">
              <b>{claude ? "Claude connected" : "Demo mode"}</b>
              <br />
              <span className="faint">{claude ? (runtime === "managed" ? "Managed Agents" : "Messages API") : "Add an API key"} · {agencyName}</span>
            </span>
          </Link>
        </div>
      </nav>
    </>
  );
}
