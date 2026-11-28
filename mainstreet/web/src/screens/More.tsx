import { Activity, ChevronRight, LogOut, Mic, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AUTH_EVENT, logout } from "../api";
import type { Me } from "../api";
import { setAtlasOpen } from "../atlas/open";
import { href } from "../router";
import type { ScreenId } from "../router";
import { cycleTheme, useTheme } from "../theme";
import { PageHeader } from "../ui";

const LINKS: { id: ScreenId; label: string; sub: string; icon: LucideIcon }[] = [
  { id: "crew", label: "Crew", sub: "Pause, resume or run each agent", icon: Users },
  { id: "activity", label: "Activity", sub: "Everything the crew did", icon: Activity },
  { id: "settings", label: "Settings", sub: "Targets, caps, pricing, keys and voice", icon: Settings },
];

export function More({ me }: { me: Me }) {
  const theme = useTheme();
  return (
    <div className="page">
      <PageHeader title="More" sub={me.agencyName || undefined} />
      <ul className="menu">
        {LINKS.map((l) => (
          <li key={l.id}>
            <a href={href(l.id)} className="menu-row">
              <l.icon size={20} aria-hidden />
              <span>
                <b>{l.label}</b>
                <small className="muted">{l.sub}</small>
              </span>
              <ChevronRight size={18} aria-hidden className="muted" />
            </a>
          </li>
        ))}
        <li>
          <button type="button" className="menu-row" onClick={() => setAtlasOpen(true)}>
            <Mic size={20} aria-hidden />
            <span>
              <b>Talk to Atlas</b>
              <small className="muted">Ask what's happening, or give an order</small>
            </span>
            <ChevronRight size={18} aria-hidden className="muted" />
          </button>
        </li>
        <li>
          <button type="button" className="menu-row" onClick={cycleTheme}>
            <span className="theme-swatch" aria-hidden />
            <span>
              <b>Theme</b>
              <small className="muted">{theme === "system" ? "Follows your phone" : theme === "dark" ? "Dark" : "Light"}</small>
            </span>
            <ChevronRight size={18} aria-hidden className="muted" />
          </button>
        </li>
        {me.passwordRequired ? (
          <li>
            <button
              type="button"
              className="menu-row"
              onClick={async () => {
                await logout().catch(() => undefined);
                window.dispatchEvent(new Event(AUTH_EVENT));
              }}
            >
              <LogOut size={20} aria-hidden />
              <span>
                <b>Sign out</b>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
