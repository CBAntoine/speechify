"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't sign in");
      window.location.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 12, width: "100%", marginTop: 18 }}>
      <label className="field">
        <span>Password</span>
        <span style={{ position: "relative" }}>
          <input
            className="input"
            style={{ height: 48, paddingRight: 48 }}
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="btn ghost icon" style={{ position: "absolute", right: 4, top: 6 }} onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      {error && (
        <div className="tip warn">
          <span>{error}</span>
        </div>
      )}
      <button className="btn primary lg" disabled={busy || !password}>
        {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />} Sign in
      </button>
    </form>
  );
}
