import { useState } from "react";
import { Lock } from "lucide-react";
import { login } from "../api";
import { BrandMark } from "../brand";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="splash">
      <form
        className="login"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!password) return;
          setBusy(true);
          setError(null);
          try {
            await login(password);
            onSignedIn();
          } catch (err) {
            setError(err instanceof Error && /401|password|wrong/i.test(err.message) ? "That password isn't right." : err instanceof Error ? err.message : "Couldn't sign in.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <BrandMark size={48} />
        <h1>Mainstreet</h1>
        <p className="muted">Sign in to run your crew.</p>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? (
          <p className="field-err" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy || !password}>
          <Lock size={16} aria-hidden /> {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
