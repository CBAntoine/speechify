"use client";

import { compact, pad2 } from "@/lib/format";
import { TOOLS, type JobState, type StackReport } from "@/lib/types";

const MODE_LABEL = { native: "", builtin: "BUILT-IN", off: "OFF", missing: "NOT INSTALLED" } as const;

export function ClippingStack({ job, stack }: { job: JobState | null; stack: StackReport | null }) {
  // Only show a combined count when (nearly) every repo's stars came back.
  const counts = Object.values(stack?.stars ?? {}).filter((v): v is number => typeof v === "number");
  const stars = counts.length >= 15 ? counts.reduce((a, b) => a + b, 0) : 0;
  const recent = job?.activeTool ?? null;
  return (
    <section className="panel" aria-label="The clipping stack">
      <div className="ph">
        <span className="name">THE CLIPPING STACK / 18 REPOS</span>
        <span className="right">{stars ? `${compact(stars)}★ combined` : `${TOOLS.filter((t) => stack?.items[t.id]?.available).length || "—"} installed`}</span>
      </div>
      <div className="pb">
        <div className="stack">
          {TOOLS.map((t) => {
            const run = job?.tools[t.id];
            const item = stack?.items[t.id];
            const state = run?.state ?? "idle";
            const mode = run?.mode;
            const done = state === "done";
            const cls = [state === "active" ? "active" : "", done ? "done" : "", state === "skipped" ? "skipped" : "", recent === t.id ? "recent" : ""].join(" ");
            const star = stack?.stars?.[t.id];
            const engine = run?.engine ?? item?.engine;
            const badge = mode ? MODE_LABEL[mode] : !job && item && !item.available ? "BUILT-IN" : "";
            return (
              <div key={t.id} className={`srow ${cls}`} tabIndex={0} data-cur={`stack-${t.id}`}>
                <span className={`num${done ? " ok" : ""}`}>{done ? "✓" : pad2(t.n)}</span>
                <span className="nm">
                  {t.name}
                  {badge && <span className="mode">{badge}</span>}
                </span>
                <span className="st">{star ? `★${compact(star)}` : ""}</span>
                <span className="under" style={{ background: t.color }} />
                <span className="tip" role="tooltip">
                  <span className="k">
                    {pad2(t.n)} {t.verb} · {t.repo}
                  </span>
                  <br />
                  <b>{t.tagline}.</b> {t.does}.
                  <br />
                  <span className="k">Runs here</span> {engine ?? "—"}
                  {run?.note ? (
                    <>
                      <br />
                      <span className="k">Note</span> {run.note}
                    </>
                  ) : null}
                  {run?.ms ? (
                    <>
                      <br />
                      <span className="k">Time</span> {(run.ms / 1000).toFixed(1)} s
                    </>
                  ) : null}
                  {item && !item.available && item.install ? (
                    <>
                      <br />
                      <span className="k">Install</span> {item.install}
                    </>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
