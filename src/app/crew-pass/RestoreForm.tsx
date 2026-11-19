"use client";

import { useState } from "react";

export default function RestoreForm() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="newsletter"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const email = new FormData(e.currentTarget).get("email");
        const res = await fetch("/api/crew-pass/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch(() => null);
        const data = await res?.json().catch(() => null);
        setMsg(data?.message || "Something went wrong. Try again.");
        setBusy(false);
      }}
    >
      <div className="newsletter__row">
        <input name="email" type="email" required placeholder="you@example.com" aria-label="Email you paid with" />
        <button type="submit" className="btn btn--ghost" disabled={busy}>
          {busy ? "Sending…" : "Send link"}
        </button>
      </div>
      {msg && (
        <p className="newsletter__msg" role="status">
          {msg}
        </p>
      )}
    </form>
  );
}
