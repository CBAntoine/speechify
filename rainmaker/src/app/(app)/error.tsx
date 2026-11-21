"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";

// Shown when a screen fails to load, most often because the database is
// unreachable right after deploying.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <div className="card card-pad stack" style={{ maxWidth: 560, margin: "40px auto", gap: 12 }}>
        <h2 className="display" style={{ margin: 0, fontSize: 22 }}>
          This screen didn&apos;t load
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Usually that means the server can&apos;t reach its database. If you just deployed, check that <span className="mono">DATABASE_URL</span> is set and the
          database is running, then try again.
        </p>
        {error.digest && <p className="faint small" style={{ margin: 0 }}>Error reference: {error.digest}</p>}
        <div className="row wrap">
          <button className="btn primary" onClick={() => reset()}>
            <RefreshCw size={15} /> Try again
          </button>
          <Link href="/settings" className="btn">
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
