"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { openAssistant } from "@/components/store/bus";

// The two interactive bits of a prospect's AI guide demo page.

/** The playbook's call to action above the guide: a waving hand that starts a chat. */
export function GuideCallout() {
  return (
    <button type="button" className="guide-callout" onClick={() => openAssistant({ mode: "text" })}>
      <span className="guide-hand" aria-hidden>
        👋
      </span>
      Click here for a quick answer
    </button>
  );
}

/** Print the demo page with its link highlighted, to leave with the owner. */
export function PrintButton() {
  return (
    <button type="button" className="btn sm" onClick={() => window.print()}>
      <Printer size={15} /> Print with link
    </button>
  );
}

/** Opened with ?print=1 (the "Print with link" button in the CRM): print once the page has drawn. */
export function AutoPrint() {
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("print")) return;
    const t = setTimeout(() => window.print(), 900);
    return () => clearTimeout(t);
  }, []);
  return null;
}
