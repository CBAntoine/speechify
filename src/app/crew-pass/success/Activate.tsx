"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SITE } from "@/lib/site";

export default function Activate({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<"working" | "ok" | "error">(sessionId ? "working" : "error");
  const [msg, setMsg] = useState(sessionId ? "" : "This page needs a checkout session. Did you arrive from Stripe?");

  useEffect(() => {
    if (!sessionId) return;
    let tries = 0;
    const go = async () => {
      const res = await fetch("/api/crew-pass/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (res?.ok) return setState("ok");
      // Payment confirmation can lag a few seconds behind the redirect.
      if (++tries < 4 && res?.status === 400 && /confirm/i.test(data?.message ?? "")) {
        window.setTimeout(go, 2500);
        return;
      }
      setMsg(data?.message || "We couldn't activate your pass. Contact support with your receipt.");
      setState("error");
    };
    void go();
  }, [sessionId]);

  return (
    <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
      {state === "working" && (
        <p className="page__lede" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="spinner" /> Confirming your payment…
        </p>
      )}
      {state === "ok" && (
        <>
          <p className="page__lede">
            You&apos;re in. Ads are off and {SITE.guideName} has a lot more time for you. Thanks for keeping {SITE.name}{" "}
            independent.
          </p>
          <Link className="btn btn--sunset" href="/?guide=1#map">
            Talk to {SITE.guideName}
          </Link>
        </>
      )}
      {state === "error" && <p className="voice-notice voice-notice--error">{msg}</p>}
    </div>
  );
}
