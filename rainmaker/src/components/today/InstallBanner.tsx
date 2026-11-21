"use client";

import { Download } from "lucide-react";
import { useInstall } from "@/components/pwa";
import { RainMark } from "@/components/ui";

/** Shown on phones where Chrome says the app can be installed. */
export function InstallBanner() {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return (
    <div className="card row" style={{ padding: 14, gap: 12, marginBottom: 14 }}>
      <span className="brand-mark" style={{ width: 40, height: 40, borderRadius: 11, flex: "none" }}>
        <RainMark size={22} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>Install Rainmaker</b>
        <span className="faint small" style={{ display: "block" }}>
          Opens full screen from your home screen, like any app.
        </span>
      </span>
      <button className="btn primary sm" onClick={() => void install()}>
        <Download size={15} /> Install
      </button>
    </div>
  );
}
