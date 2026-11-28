// The shell: sign-in gate, navigation (sidebar on desktop, tab bar on
// phones), the live stream, and Atlas.

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Ellipsis,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Monitor,
  Moon,
  Pause,
  Play,
  Settings as SettingsIcon,
  SquareKanban,
  Sun,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AUTH_EVENT, getMe, logout } from "./api";
import type { Me } from "./api";
import { run } from "./commands";
import { talkToAtlas, toggleAtlas, useAtlasOpen } from "./atlas/open";
import { currentRoute, href, navigate, useRoute } from "./router";
import type { ScreenId } from "./router";
import { connectStream, disconnectStream, loadOverview, loadSettings, setMe, useStore } from "./store";
import { cycleTheme, useTheme } from "./theme";
import { Button, cx, DialogHost, Dot, Loading, Toasts } from "./ui";
import { BrandMark } from "./brand";
import { Today } from "./screens/Today";
import { Pipeline } from "./screens/Pipeline";
import { LeadDetailScreen } from "./screens/LeadDetail";
import { Outreach } from "./screens/Outreach";
import { Approvals } from "./screens/Approvals";
import { Crew } from "./screens/Crew";
import { SettingsScreen } from "./screens/Settings";
import { ActivityScreen } from "./screens/Activity";
import { More } from "./screens/More";
import { Login } from "./screens/Login";

// The voice SDK is heavy: it loads after the dashboard is on screen.
const Atlas = lazy(() => import("./atlas/Atlas"));

export function App() {
  const me = useStore((s) => s.me);
  const [state, setState] = useState<"checking" | "ready" | "offline">("checking");
  const [offlineMsg, setOfflineMsg] = useState("");

  const check = useCallback(async () => {
    try {
      const m = await getMe();
      setMe(m);
      setState("ready");
    } catch (err) {
      setOfflineMsg(err instanceof Error ? err.message : String(err));
      setState("offline");
    }
  }, []);

  useEffect(() => {
    void check();
    const onAuth = () => void check();
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, [check]);

  if (state === "checking") {
    return (
      <div className="splash">
        <BrandMark size={44} />
        <Loading label="Opening Mainstreet…" />
      </div>
    );
  }
  if (state === "offline" || !me) {
    return (
      <div className="splash">
        <BrandMark size={44} />
        <h1>Can't reach Mainstreet</h1>
        <p className="muted">{offlineMsg || "The server didn't answer."}</p>
        <Button tone="primary" onClick={() => void check()}>
          Try again
        </Button>
      </div>
    );
  }
  if (me.passwordRequired && !me.authed) return <Login onSignedIn={() => void check()} />;
  return <Shell me={me} />;
}

const NAV: { id: ScreenId; label: string; icon: LucideIcon }[] = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: SquareKanban },
  { id: "outreach", label: "Outreach", icon: Megaphone },
  { id: "approvals", label: "Approvals", icon: BadgeCheck },
  { id: "crew", label: "Crew", icon: Users },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const TABS: { id: ScreenId; label: string; icon: LucideIcon }[] = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "pipeline", label: "Pipeline", icon: SquareKanban },
  { id: "outreach", label: "Outreach", icon: Megaphone },
  { id: "approvals", label: "Approvals", icon: BadgeCheck },
  { id: "more", label: "More", icon: Ellipsis },
];

function Shell({ me }: { me: Me }) {
  const route = useRoute();
  const overview = useStore((s) => s.overview);
  const live = useStore((s) => s.live);
  const atlasOpen = useAtlasOpen();
  const pending = overview?.approvals.filter((a) => a.status === "pending").length ?? 0;
  const demo = me.demo || overview?.demo;

  useEffect(() => {
    connectStream();
    void loadOverview();
    void loadSettings();
    // The home-screen shortcut "Talk to Atlas" opens #/today?atlas=1.
    if (currentRoute().query.get("atlas") === "1") {
      talkToAtlas();
      navigate("today");
    }
    // A slow safety net in case the stream misses something.
    const t = window.setInterval(() => void loadOverview(), 60_000);
    return () => {
      window.clearInterval(t);
      disconnectStream();
    };
  }, []);

  // Each screen starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.screen, route.param]);

  const active: ScreenId = route.screen === "lead" ? "pipeline" : route.screen;
  const moreActive = ["crew", "activity", "settings", "more"].includes(route.screen);

  return (
    <div className={cx("shell", atlasOpen && "atlas-is-open")}>
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href={href("today")}>
          <BrandMark size={30} />
          <span>
            <b>Mainstreet</b>
            <small>{me.agencyName || "Your agency"}</small>
          </span>
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.id} href={href(n.id)} className={cx("nav-item", active === n.id && "is-active")} aria-current={active === n.id ? "page" : undefined}>
              <n.icon size={18} aria-hidden />
              <span>{n.label}</span>
              {n.id === "approvals" && pending > 0 ? <span className="badge">{pending}</span> : null}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <CrewPower paused={Boolean(overview?.paused)} />
          <div className="sidebar-row">
            <span className="live-flag" title={live ? "Live updates are on" : "Reconnecting to live updates…"}>
              <Dot tone={live ? "green" : "amber"} pulse={live} /> {live ? "Live" : "Reconnecting"}
            </span>
            <ThemeButton />
            {me.passwordRequired ? <SignOut /> : null}
          </div>
        </div>
      </aside>

      <header className="topbar">
        <a className="brand" href={href("today")}>
          <BrandMark size={28} />
          <b>Mainstreet</b>
        </a>
        <div className="topbar-right">
          {overview?.paused ? (
            <span className="chip tone-amber">
              <Pause size={12} aria-hidden /> Paused
            </span>
          ) : null}
          <span className="live-flag" title={live ? "Live updates are on" : "Reconnecting…"}>
            <Dot tone={live ? "green" : "amber"} pulse={live} label={live ? "Live" : "Reconnecting"} />
          </span>
          <ThemeButton />
        </div>
      </header>

      <main className="main" id="main">
        {demo ? (
          <div className="banner tone-blue" role="note">
            <span>
              <b>Demo mode:</b> fictional businesses, nothing is sent.
            </span>
          </div>
        ) : null}
        {overview?.paused ? (
          <div className="banner tone-amber" role="status">
            <span>
              <b>The crew is paused.</b> Nothing is searched, built or sent until you resume.
            </span>
            <Button size="sm" tone="primary" icon={Play} onClick={() => void run("resume_crew", {})}>
              Resume
            </Button>
          </div>
        ) : null}
        <Screen screen={route.screen} param={route.param} me={me} />
      </main>

      <nav className="tabbar" aria-label="Main navigation">
        {TABS.map((t) => {
          const on = t.id === "more" ? moreActive : active === t.id;
          return (
            <a key={t.id} href={href(t.id)} className={cx("tab", on && "is-active")} aria-current={on ? "page" : undefined}>
              <span className="tab-icon">
                <t.icon size={21} aria-hidden />
                {t.id === "approvals" && pending > 0 ? <span className="badge">{pending}</span> : null}
              </span>
              <span>{t.label}</span>
            </a>
          );
        })}
      </nav>

      <Suspense fallback={<OrbPlaceholder />}>
        <Atlas ownerName={me.ownerName} agencyName={me.agencyName} />
      </Suspense>

      <Toasts />
      <DialogHost />
    </div>
  );
}

function Screen({ screen, param, me }: { screen: ScreenId; param?: string; me: Me }) {
  switch (screen) {
    case "today":
      return <Today me={me} />;
    case "pipeline":
      return <Pipeline />;
    case "lead":
      return param ? <LeadDetailScreen id={param} /> : <Pipeline />;
    case "outreach":
      return <Outreach />;
    case "approvals":
      return <Approvals />;
    case "crew":
      return <Crew />;
    case "settings":
      return <SettingsScreen />;
    case "activity":
      return <ActivityScreen />;
    case "more":
      return <More me={me} />;
    default:
      return <Today me={me} />;
  }
}

/** Until the Atlas chunk loads: the same button, so a tap is never lost. */
function OrbPlaceholder() {
  return (
    <button type="button" className="atlas-fab" onClick={toggleAtlas} aria-label="Talk to Atlas">
      <span className="orb idle" aria-hidden />
    </button>
  );
}

export function ThemeButton() {
  const theme = useTheme();
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = theme === "light" ? "Light theme" : theme === "dark" ? "Dark theme" : "Theme follows your device";
  return <Button tone="ghost" icon={Icon} onClick={cycleTheme} aria-label={`${label}. Change theme`} title={label} />;
}

function SignOut() {
  return (
    <Button
      tone="ghost"
      icon={LogOut}
      aria-label="Sign out"
      title="Sign out"
      onClick={async () => {
        await logout().catch(() => undefined);
        window.dispatchEvent(new Event(AUTH_EVENT));
        navigate("today");
      }}
    />
  );
}

function CrewPower({ paused }: { paused: boolean }) {
  return paused ? (
    <Button tone="primary" icon={Play} onClick={() => void run("resume_crew", {})} className="w-full">
      Resume the crew
    </Button>
  ) : (
    <Button
      tone="ghost"
      icon={Pause}
      className="w-full"
      onClick={() =>
        void run("pause_crew", {}, { confirm: { title: "Pause the whole crew?", body: "Nothing new is searched, built or sent until you resume. Replies still come in.", confirmLabel: "Pause everything" } })
      }
    >
      Pause everything
    </Button>
  );
}
