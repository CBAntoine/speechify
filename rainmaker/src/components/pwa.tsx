"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

// Android Chrome fires `beforeinstallprompt` when the app can be installed.
// An inline script in the root layout catches it before React loads and
// parks it on window.__rmInstall; this hook picks it up from there.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type W = Window & { __rmInstall?: InstallEvent | null };

export const INSTALL_CAPTURE_SCRIPT = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__rmInstall=e;window.dispatchEvent(new Event('rm-install'));});window.addEventListener('appinstalled',function(){window.__rmInstall=null;window.dispatchEvent(new Event('rm-install'));});`;

export function useInstall() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const w = window as W;
    const sync = () => setEvt(w.__rmInstall ?? null);
    sync();
    window.addEventListener("rm-install", sync);
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => setStandalone(mq.matches);
    onMode();
    mq.addEventListener?.("change", onMode);
    return () => {
      window.removeEventListener("rm-install", sync);
      mq.removeEventListener?.("change", onMode);
    };
  }, []);
  return {
    canInstall: Boolean(evt) && !standalone,
    standalone,
    async install(): Promise<boolean> {
      const w = window as W;
      const e = w.__rmInstall;
      if (!e) return false;
      await e.prompt();
      const choice = await e.userChoice;
      w.__rmInstall = null;
      setEvt(null);
      return choice.outcome === "accepted";
    },
  };
}

export function InstallButton({ className = "btn sm", label = "Install app" }: { className?: string; label?: string }) {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return (
    <button type="button" className={className} onClick={() => void install()}>
      <Download size={15} /> {label}
    </button>
  );
}

/** Registers the service worker (production only, so dev reloads stay fresh). */
export function PwaSetup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);
  return null;
}

/** True once mounted on a device with a share sheet (false during server render). */
export function useCanShare(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canShare()), []);
  return ok;
}

/** Use the phone's share sheet when there is one. */
export function canShare(data?: ShareData): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (data && typeof navigator.canShare === "function") return navigator.canShare(data);
  return true;
}

export async function shareOrCopy(data: { title?: string; text: string }): Promise<"shared" | "copied" | "cancelled"> {
  if (canShare()) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard.writeText(data.title ? `${data.title}\n\n${data.text}` : data.text);
  return "copied";
}
