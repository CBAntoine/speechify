"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PUBLIC_CONFIG, SITE } from "@/lib/site";
import { Icon } from "./icons";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function isCrew() {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === "na_crew_ui=1");
}

/**
 * Google AdSense unit when configured; otherwise a house ad for Crew Pass /
 * direct sponsorships. Crew Pass members never see either.
 */
export default function AdSlot({ variant = "inline" }: { variant?: "inline" | "sidebar" }) {
  const [crew, setCrew] = useState<boolean | null>(null);
  const pushed = useRef(false);
  const slot = variant === "sidebar" ? PUBLIC_CONFIG.adsenseSlotSidebar : PUBLIC_CONFIG.adsenseSlotInline;
  const live = !!PUBLIC_CONFIG.adsenseClient && !!slot;

  useEffect(() => setCrew(isCrew()), []);
  useEffect(() => {
    if (crew !== false || !live || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      /* ad blockers */
    }
  }, [crew, live]);

  if (crew) return null;

  if (!live) {
    return (
      <aside className={`ad ad--${variant} ad--house`} aria-label="Sponsored">
        <span className="ad__label">Sponsored</span>
        <div className="ad__house">
          <Icon name="crown" size={variant === "sidebar" ? 18 : 22} />
          <div>
            <strong>Go ad-free with Crew Pass</strong>
            <span>
              More time with {SITE.guideName}, early pins and zero ads. {PUBLIC_CONFIG.crewPassPrice}.
            </span>
          </div>
          <Link className="btn btn--ghost btn--sm" href="/crew-pass">
            See perks
          </Link>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`ad ad--${variant}`} aria-label="Advertisement">
      <span className="ad__label">Advertisement</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={PUBLIC_CONFIG.adsenseClient}
        data-ad-slot={slot}
        data-ad-format={variant === "sidebar" ? "rectangle" : "auto"}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
