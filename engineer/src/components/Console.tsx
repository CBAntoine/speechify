"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseConfig, summarize } from "@/review/fortios.ts";
import { redactionCounts, sanitize } from "@/review/sanitize.ts";
import { parseHits } from "@/review/hits.ts";
import { changeContext } from "@/review/context.ts";
import { countsSentence, SEVERITIES, type Finding, type FindingsDoc } from "@/review/findings.ts";
import type { ReviewStatus, ReviewSummary } from "@/review/runs.ts";
import type { ChangeDraft } from "@/lib/changes";
import { findWorkflow, WORKFLOWS } from "@/voice/workflows.ts";
import { Voice, type Params, type ToolHandlers } from "./Voice";

// The engineer's console: loaded backups, reviews, reports, change drafts and
// the workflow design. Everything here can be done with the buttons, and the
// voice agent does the same things through its tools.

interface Backup {
  key: string;
  fileName: string;
  device: string;
  model: string | null;
  version: string | null;
  build: string | null;
  policies: number;
  lines: number;
  redactedText: string;
  redacted: Record<string, number>;
  secretsRemoved: number;
  sample: boolean;
}

interface Hits {
  fileName: string;
  text: string;
  days: number | null;
  exportedAt: string | null;
  policies: number;
}

interface Deviations {
  fileName: string;
  text: string;
  count: number;
}

interface Outputs {
  report: string | null;
  findings: FindingsDoc | null;
}

type ReviewState = ReviewStatus & { consoleUrl: string; outputs: Outputs | null };

interface Change {
  id: string;
  device: string;
  request: string;
  createdAt: string;
  draft: ChangeDraft;
}

type View = "workspace" | "review" | "finding" | "change" | "workflows";

export interface ConsoleProps {
  voiceUnavailable: string | null;
  reviewsUnavailable: string | null;
  changesUnavailable: string | null;
  budgetUsd: number;
}

const RUNNING = new Set(["starting", "working", "grading", "waiting"]);

const today = () => new Date().toLocaleDateString("en-CA");

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The request failed (${res.status}).`);
  return data;
}

function readBackup(fileName: string, text: string, sample = false): Backup {
  const { text: redactedText, redactions } = sanitize(text.replace(/^﻿/, ""));
  const parsed = parseConfig(redactedText);
  const s = summarize(parsed);
  const policies = Object.values(s.policies).reduce((a, b) => a + b, 0);
  if (!parsed.header.config_version && policies === 0) throw new Error(`${fileName} doesn't look like a FortiGate backup.`);
  return {
    key: `${fileName}-${Date.now()}`,
    fileName,
    device: s.hostname || fileName.replace(/\.[^.]+$/, ""),
    model: s.model,
    version: s.version,
    build: s.build,
    policies,
    lines: parsed.line_count,
    redactedText,
    redacted: redactionCounts(redactions),
    secretsRemoved: redactions.length,
    sample,
  };
}

function findFinding(doc: FindingsDoc | null | undefined, id: string): Finding | undefined {
  if (!doc) return undefined;
  const q = id.trim().toUpperCase();
  const n = Number(q.replace(/^F-?/, ""));
  return doc.findings.find((f) => f.id.toUpperCase() === q) ?? (Number.isInteger(n) ? doc.findings.find((f) => Number(f.id.replace(/^F-?/i, "")) === n) : undefined);
}

export function Console({ voiceUnavailable, reviewsUnavailable, changesUnavailable, budgetUsd }: ConsoleProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hits, setHits] = useState<Hits | null>(null);
  const [deviations, setDeviations] = useState<Deviations | null>(null);
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<ReviewState | null>(null);
  const [view, setView] = useState<View>("workspace");
  const [findingId, setFindingId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [changeId, setChangeId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const notifyRef = useRef<((text: string) => void) | null>(null);
  const lastPhase = useRef<string | null>(null);

  const backup = backups.find((b) => b.key === selected) ?? backups[backups.length - 1] ?? null;
  const findings = active?.outputs?.findings ?? null;
  const finding = findFinding(findings, findingId ?? "") ?? null;
  const change = changes.find((c) => c.id === changeId) ?? changes[0] ?? null;

  // The tools read the latest state through this ref.
  const state = useRef({ backups, backup, hits, deviations, reviews, activeId, active, view, finding, changes });
  state.current = { backups, backup, hits, deviations, reviews, activeId, active, view, finding, changes };

  const say = (kind: "ok" | "error", text: string) => setMessage({ kind, text });

  // ── Loading files ──
  const addFile = useCallback(async (file: File) => {
    const text = await file.text();
    const t = text.trimStart();
    if (/#config-version=|^config firewall policy\s*$/m.test(text)) {
      const b = readBackup(file.name, text);
      setBackups((prev) => [...prev.filter((x) => x.device !== b.device), b]);
      setSelected(b.key);
      return `Loaded ${b.device}: ${b.policies} policies, ${b.secretsRemoved} secrets removed in your browser.`;
    }
    if (t.startsWith("[") && /"check"\s*:/.test(t)) {
      const data = JSON.parse(t) as unknown[];
      setDeviations({ fileName: file.name, text, count: data.length });
      return `Loaded ${data.length} accepted deviations.`;
    }
    const h = parseHits(text, { source: file.name, periodDays: null, exportedAt: new Date(file.lastModified).toISOString() });
    setHits({ fileName: file.name, text, days: null, exportedAt: h.exported_at, policies: h.policies.length });
    return `Loaded hit counts for ${h.policies.length} policies. Set how many days they cover below.`;
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const f of Array.from(files)) {
        try {
          say("ok", await addFile(f));
        } catch (err) {
          say("error", err instanceof Error ? err.message : `Couldn't read ${f.name}.`);
        }
      }
      setView("workspace");
    },
    [addFile],
  );

  const loadSample = useCallback(async () => {
    const s = await api<{ backup: { name: string; text: string }; hits: { name: string; text: string; days: number; exportedAt: string }; deviations: { name: string; text: string } }>("/api/samples");
    const b = { ...readBackup(s.backup.name, s.backup.text, true) };
    const h = parseHits(s.hits.text, { source: s.hits.name, periodDays: s.hits.days, exportedAt: s.hits.exportedAt });
    const devs = JSON.parse(s.deviations.text) as unknown[];
    setBackups((prev) => [...prev.filter((x) => !x.sample && x.device !== b.device), b]);
    setSelected(b.key);
    setHits({ fileName: s.hits.name, text: s.hits.text, days: s.hits.days, exportedAt: s.hits.exportedAt, policies: h.policies.length });
    setDeviations({ fileName: s.deviations.name, text: s.deviations.text, count: devs.length });
    setView("workspace");
    return { b, hits: h.policies.length, devs: devs.length };
  }, []);

  // ── Reviews ──
  const refreshReviews = useCallback(async () => {
    if (reviewsUnavailable) return;
    try {
      const r = await api<{ reviews: ReviewSummary[] }>("/api/reviews");
      setReviews(r.reviews);
    } catch {
      /* The list is a convenience; the error shows when someone acts. */
    }
  }, [reviewsUnavailable]);

  const fetchStatus = useCallback(async (id: string) => {
    const s = await api<ReviewState>(`/api/reviews/${id}`);
    if (state.current.activeId === id) setActive(s);
    return s;
  }, []);

  useEffect(() => {
    void refreshReviews();
    const t = window.setInterval(() => void refreshReviews(), 60_000);
    return () => window.clearInterval(t);
  }, [refreshReviews]);

  // Follow the review on screen until it's finished and its report is in.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        const s = await fetchStatus(activeId);
        const needMore = RUNNING.has(s.phase) || (s.phase === "done" && !s.outputs);
        if (lastPhase.current !== null && lastPhase.current !== s.phase) {
          if (s.phase === "done") {
            const f = s.outputs?.findings;
            notifyRef.current?.(`The review of ${s.device} finished${f ? `: ${countsSentence(f.summary)}` : ""}. ${s.detail}`);
            void refreshReviews();
          } else if (s.phase === "waiting" && s.pending[0]) {
            notifyRef.current?.(`The review of ${s.device} is waiting for approval to run: ${s.pending[0].summary}`);
          } else if (s.phase === "stopped") {
            notifyRef.current?.(`The review of ${s.device} stopped. ${s.detail}`);
          }
        }
        lastPhase.current = s.phase;
        if (needMore && !stop) timer = window.setTimeout(tick, 8_000);
      } catch (err) {
        if (!stop) {
          say("error", err instanceof Error ? err.message : "Couldn't check the review.");
          timer = window.setTimeout(tick, 20_000);
        }
      }
    };
    lastPhase.current = null;
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [activeId, fetchStatus, refreshReviews]);

  const openReview = useCallback((id: string) => {
    setActive(null);
    setActiveId(id);
    setFindingId(null);
    setView("review");
  }, []);

  const startReview = useCallback(
    async (target: Backup, notes = "") => {
      const h = state.current.hits;
      const d = state.current.deviations;
      const r = await api<{ id: string; device: string; budgetUsd: number }>("/api/reviews", {
        method: "POST",
        body: {
          backup: { name: target.fileName, text: target.redactedText },
          redacted: target.redacted,
          hits: h ? { name: h.fileName, text: h.text, days: h.days, exportedAt: h.exportedAt } : null,
          deviations: d ? { name: d.fileName, text: d.text } : null,
          notes,
          reviewDate: today(),
        },
      });
      openReview(r.id);
      void refreshReviews();
      return r;
    },
    [openReview, refreshReviews],
  );

  const answer = useCallback(
    async (allow: boolean) => {
      const s = state.current.active;
      const call = s?.pending[0];
      if (!s || !call) return "Nothing is waiting for approval.";
      await api(`/api/reviews/${s.id}/approval`, { method: "POST", body: { event_id: call.id, allow } });
      void fetchStatus(s.id);
      return `${allow ? "Allowed" : "Declined"} the call to ${call.tool}. The review carries on.`;
    },
    [fetchStatus],
  );

  // ── Changes ──
  const contexts = useMemo(() => new Map<string, ReturnType<typeof changeContext>>(), []);
  const draftChange = useCallback(
    async (target: Backup, request: string) => {
      let context = contexts.get(target.key);
      if (!context) {
        context = changeContext(parseConfig(target.redactedText));
        contexts.set(target.key, context);
      }
      const r = await api<{ draft: ChangeDraft }>("/api/changes", { method: "POST", body: { request, context } });
      const c: Change = { id: `chg-${Date.now()}`, device: target.device, request, createdAt: new Date().toISOString(), draft: r.draft };
      setChanges((prev) => [c, ...prev]);
      setChangeId(c.id);
      setView("change");
      return c;
    },
    [contexts],
  );

  // ── The agent's tools ──
  const tools: ToolHandlers = useMemo(() => {
    const st = () => state.current;
    return {
      get_workspace: () => {
        const s = st();
        const out: string[] = [];
        if (!s.backups.length) out.push("No backup is loaded. The person can drop a FortiGate backup on the page, or you can load the sample with load_sample.");
        for (const b of s.backups) {
          out.push(
            `${b === s.backup ? "Selected backup" : "Backup"}: ${b.device}, ${b.model ?? "unknown model"} on FortiOS ${b.version ?? "unknown"}, ${b.policies} policies, ${b.secretsRemoved} secrets removed in the browser${b.sample ? ". This is the made-up sample" : ""}.`,
          );
        }
        out.push(s.hits ? `Hit counts for ${s.hits.policies} policies, covering ${s.hits.days ?? "an unknown number of"} days.` : "No hit counts loaded, so the unused-rule check would be skipped.");
        if (s.deviations) out.push(`${s.deviations.count} accepted deviations loaded.`);
        if (s.active) out.push(`Review on screen: ${s.active.device}, ${s.active.phase}. ${s.active.detail}`);
        const others = s.reviews.filter((r) => r.id !== s.activeId).slice(0, 3);
        if (others.length) out.push(`Other recent reviews: ${others.map((r) => `${r.device} on ${r.reviewDate} (${r.status})`).join("; ")}.`);
        if (s.changes.length) out.push(`${s.changes.length} change draft${s.changes.length === 1 ? "" : "s"} this session.`);
        out.push(`On screen: ${s.view}${s.view === "finding" && s.finding ? ` ${s.finding.id}` : ""}.`);
        if (reviewsUnavailable) out.push(`Reviews can't run here yet: ${reviewsUnavailable}`);
        if (changesUnavailable) out.push(`Change drafts can't run here yet: ${changesUnavailable}`);
        return out.join("\n");
      },
      load_sample: async () => {
        const { b, hits: h, devs } = await loadSample();
        return `Loaded the sample firewall ${b.device}: ${b.model} on FortiOS ${b.version}, ${b.policies} policies, ${b.secretsRemoved} secrets removed in the browser, with ${h} policies' hit counts covering 90 days and ${devs} accepted deviations. It's made up, with problems planted in it.`;
      },
      start_review: async (p: Params) => {
        if (p.confirmed !== true) return `Not started. Say it takes about 5 to 15 minutes and costs up to ${budgetUsd} dollars, then ask for a yes before calling start_review with confirmed true.`;
        if (reviewsUnavailable) return `Reviews can't run here yet: ${reviewsUnavailable}`;
        const s = st();
        const want = typeof p.backup === "string" ? p.backup.trim().toLowerCase() : "";
        const target = (want && s.backups.find((b) => b.device.toLowerCase().includes(want))) || s.backup;
        if (!target) return "No backup is loaded. Ask them to drop a FortiGate backup on the page, or offer the sample.";
        if (s.active && RUNNING.has(s.active.phase) && s.active.device === target.device) return `A review of ${target.device} is already running: ${s.active.detail}`;
        const r = await startReview(target, typeof p.notes === "string" ? p.notes : "");
        return `Started the review of ${r.device}. It runs in the background for about 5 to 15 minutes with a ${r.budgetUsd} dollar cap. You'll be told when it finishes.`;
      },
      check_review: async () => {
        const s = st();
        const id = s.activeId ?? s.reviews[0]?.id;
        if (!id) return "No review has been started yet.";
        if (!s.activeId) openReview(id);
        const r = await fetchStatus(id);
        const out = [`${r.device}: ${r.detail}`, `${r.minutes} minutes since it started${r.costUsd !== null ? `, ${r.costUsd.toFixed(2)} dollars spent so far` : ""}.`];
        if (r.grades.length) out.push(`Grading: ${r.grades.map((g) => `round ${g.iteration + 1} ${g.result.replace(/_/g, " ")}`).join(", ")}.`);
        if (r.pending[0]) out.push(`Waiting for approval to run: ${r.pending[0].summary}`);
        if (r.outputs?.findings) out.push(`Findings: ${countsSentence(r.outputs.findings.summary)}.`);
        return out.join(" ");
      },
      answer_approval: (p: Params) => answer(p.allow === true),
      get_findings: (p: Params) => {
        const s = st();
        if (!s.active) return "No review is open. Use check_review or start one.";
        const doc = s.active.outputs?.findings;
        if (!doc) return RUNNING.has(s.active.phase) ? `The review is still running: ${s.active.detail}` : "This review has no findings file. The full report may still be on screen.";
        setView("review");
        const sev = typeof p.severity === "string" && p.severity !== "all" ? p.severity : null;
        const list = doc.findings.filter((f) => !sev || f.severity === sev);
        const lines = list.slice(0, 12).map((f) => `${f.id}, ${f.severity}, ${f.check}: ${f.title} (${f.object})`);
        return [
          `${s.active.device}, reviewed ${s.active.reviewDate}: ${countsSentence(doc.summary)}.`,
          ...lines,
          list.length > 12 ? `${list.length - 12} more are on screen.` : "",
          doc.accepted_deviations.length
            ? `${doc.accepted_deviations.length} accepted deviation${doc.accepted_deviations.length === 1 ? " was" : "s were"} left out of the findings.`
            : "",
          doc.skipped_checks.length ? `Skipped checks: ${doc.skipped_checks.map((c) => `${c.check} (${c.reason})`).join("; ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n");
      },
      get_finding: (p: Params) => {
        const doc = st().active?.outputs?.findings;
        const f = findFinding(doc, typeof p.finding_id === "string" ? p.finding_id : "");
        if (!f) return doc ? `No finding ${String(p.finding_id)}. IDs run from ${doc.findings[0]?.id ?? "F-001"}.` : "No finished review is open.";
        setFindingId(f.id);
        setView("finding");
        return [
          `${f.id}, ${f.severity}, check ${f.check}: ${f.title}.`,
          `Where: ${f.object}${f.vdom ? ` in VDOM ${f.vdom}` : ""}${f.lines.length ? `, config lines ${f.lines.join(", ")}` : ""}. The evidence is on screen.`,
          `Why it matters: ${f.why}`,
          f.verify ? `To verify: ${f.verify}` : "",
          f.proposed_change
            ? `The drafted fix, for you to put in plain words (don't read it out): ${f.proposed_change.replace(/\s+/g, " ").trim().slice(0, 800)} The commands are on screen.`
            : "No fix is drafted for this one.",
          f.confidence === "unconfirmed" ? "This finding is unconfirmed." : "",
        ]
          .filter(Boolean)
          .join(" ");
      },
      draft_change: async (p: Params) => {
        if (changesUnavailable) return `Change drafts can't run here yet: ${changesUnavailable}`;
        const target = st().backup;
        if (!target) return "Load a FortiGate backup first, so the draft can be checked against the current rules.";
        const request = typeof p.request === "string" ? p.request.trim() : "";
        if (request.length < 8) return "Describe the request: source, destination, service, owner and any end date.";
        const pending = draftChange(target, request);
        // The voice tool gives up after 120 seconds; a slower draft still lands on screen and the agent is told.
        const c = await Promise.race([pending, new Promise<null>((r) => window.setTimeout(() => r(null), 105_000))]);
        if (!c) {
          pending.then(
            (late) => notifyRef.current?.(`The change draft for ${late.device} is ready on screen. ${late.draft.summary}`),
            (err: Error) => notifyRef.current?.(`The change draft failed: ${err.message}`),
          );
          return "Still drafting. It will appear on screen shortly, and you'll be told when it's ready.";
        }
        const d = c.draft;
        return [
          `Draft ready for ${c.device}. ${d.summary}`,
          `Risk: ${d.risk}. ${d.risk_reason}`,
          `Placement: ${d.placement}`,
          d.conflicts.length ? `Conflicts with existing rules: ${d.conflicts.join("; ")}` : "No conflicting rules found.",
          d.questions.length ? `Still to confirm: ${d.questions.join(" ")}` : "",
          "The commands, test plan and rollback are on screen.",
        ]
          .filter(Boolean)
          .join("\n");
      },
      show: (p: Params) => {
        const v = typeof p.view === "string" ? (p.view as View) : "workspace";
        const id = typeof p.id === "string" ? p.id : "";
        if (v === "finding" && id) {
          const f = findFinding(st().active?.outputs?.findings, id);
          if (!f) return `No finding ${id} on screen.`;
          setFindingId(f.id);
        }
        if (v === "review" && id && id.startsWith("sesn_")) openReview(id);
        if (v === "change" && id) setChangeId(id);
        setView(["workspace", "review", "finding", "change", "workflows"].includes(v) ? v : "workspace");
        return `Opened ${v}.`;
      },
      get_workflow: (p: Params) => {
        const w = findWorkflow(typeof p.workflow === "string" ? p.workflow : "");
        if (!w) return `No workflow matches that. The workflows are: ${WORKFLOWS.map((x) => `${x.code} ${x.name}`).join("; ")}.`;
        const status = w.status === "available" ? "Available now." : w.status === "drafts" ? "Available now as drafts." : "Designed, not connected yet.";
        return `${w.code}, ${w.name}. ${status} ${w.summary} It starts when: ${w.trigger.toLowerCase()}. Steps: ${w.steps.join("; ")}. What it needs: ${w.needs} Guardrail: ${w.guardrail}`;
      },
    };
  }, [answer, budgetUsd, changesUnavailable, draftChange, fetchStatus, loadSample, openReview, reviewsUnavailable, startReview]);

  const workspaceLine = useCallback(() => {
    const b = state.current.backup;
    return b ? `Selected backup: ${b.device} (${b.policies} policies${b.sample ? ", the made-up sample" : ""}).` : "No backup loaded yet.";
  }, []);

  // ── Layout ──
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            ⌁
          </span>
          <div>
            <h1>Engineer</h1>
            <p>Security engineering by conversation: FortiGate reviews and change drafts.</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Views">
          {(["workspace", "review", "change", "workflows"] as const).map((v) => (
            <button key={v} type="button" className={view === v || (v === "review" && view === "finding") ? "on" : ""} onClick={() => setView(v)}>
              {v === "workspace" ? "Workspace" : v === "review" ? "Review" : v === "change" ? "Changes" : "Workflows"}
            </button>
          ))}
        </nav>
      </header>

      <div className="layout">
        <Voice unavailable={voiceUnavailable} tools={tools} notifyRef={notifyRef} workspace={workspaceLine} />

        <main className="main">
          {message ? (
            <p className={`banner ${message.kind}`} role="status">
              {message.text}
              <button type="button" className="x" aria-label="Dismiss" onClick={() => setMessage(null)}>
                ×
              </button>
            </p>
          ) : null}

          {view === "workspace" ? (
            <section className="panel">
              <div
                className={`drop ${dragging ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void addFiles(e.dataTransfer.files);
                }}
              >
                <p>
                  <strong>Drop a FortiGate backup here</strong>, plus hit counts or accepted deviations if you have them.
                </p>
                <p className="muted">Secrets are removed in your browser before anything is sent.</p>
                <div className="row">
                  <label className="btn">
                    Choose files
                    <input type="file" multiple accept=".conf,.txt,.json,.csv" className="sr" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
                  </label>
                  <button type="button" className="btn ghost" onClick={() => void loadSample().then((r) => say("ok", `Loaded the sample firewall ${r.b.device}.`), (err) => say("error", String(err.message ?? err)))}>
                    Use the sample firewall
                  </button>
                </div>
              </div>

              {backups.length ? (
                <div className="cards">
                  {backups.map((b) => (
                    <article key={b.key} className={`card ${b === backup ? "selected" : ""}`}>
                      <header>
                        <label>
                          <input type="radio" name="backup" checked={b === backup} onChange={() => setSelected(b.key)} /> <strong>{b.device}</strong>
                        </label>
                        {b.sample ? <span className="tag">sample</span> : null}
                      </header>
                      <p className="muted">
                        {b.model ?? "Unknown model"}, FortiOS {b.version ?? "?"} build {b.build ?? "?"}
                      </p>
                      <p>
                        {b.policies} policies, {b.lines} lines. <span className="ok-text">{b.secretsRemoved} secrets removed in your browser.</span>
                      </p>
                    </article>
                  ))}
                </div>
              ) : null}

              <ul className="facts">
                <li>
                  {hits ? (
                    <>
                      Hit counts for {hits.policies} policies ({hits.fileName}), covering{" "}
                      <input
                        id="hits-days"
                        className="days"
                        type="number"
                        min={1}
                        placeholder="?"
                        value={hits.days ?? ""}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setHits({ ...hits, days: Number.isInteger(n) && n > 0 ? n : null });
                        }}
                        aria-label="Days the hit counters cover"
                      />{" "}
                      days
                    </>
                  ) : (
                    "No hit counts: the unused-rule check will be skipped."
                  )}
                </li>
                <li>{deviations ? `${deviations.count} accepted deviations (${deviations.fileName})` : "No accepted deviations."}</li>
              </ul>

              <div className="row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={!backup || Boolean(reviewsUnavailable)}
                  onClick={() => backup && void startReview(backup).then((r) => say("ok", `Started the review of ${r.device}.`), (err) => say("error", String(err.message ?? err)))}
                >
                  Review {backup ? backup.device : "a backup"}
                </button>
                <span className="muted">About 5 to 15 minutes, up to ${budgetUsd} per review.</span>
              </div>
              {reviewsUnavailable ? <p className="banner error">{reviewsUnavailable}</p> : null}

              <h2>Recent reviews</h2>
              {reviews.length ? (
                <ul className="list">
                  {reviews.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="linkish" onClick={() => openReview(r.id)}>
                        {r.device}
                      </button>{" "}
                      <span className="muted">
                        {r.reviewDate}, {r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No reviews yet.</p>
              )}
            </section>
          ) : null}

          {view === "review" || view === "finding" ? (
            <ReviewPanel
              review={active}
              loading={Boolean(activeId) && !active}
              finding={view === "finding" ? finding : null}
              onFinding={(id) => {
                setFindingId(id);
                setView("finding");
              }}
              onBack={() => setView("review")}
              onAnswer={(allow) => void answer(allow).then((t) => say("ok", t), (err) => say("error", String(err.message ?? err)))}
            />
          ) : null}

          {view === "change" ? (
            <section className="panel">
              <form
                className="request"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!backup) return say("error", "Load a FortiGate backup first.");
                  setDrafting(true);
                  void draftChange(backup, requestText)
                    .then(() => setRequestText(""), (err) => say("error", String(err.message ?? err)))
                    .finally(() => setDrafting(false));
                }}
              >
                <label htmlFor="req">Describe the access needed</label>
                <textarea
                  id="req"
                  rows={3}
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  placeholder="Finance laptops need HTTPS to the partner billing portal until 31 March. Owner: Finance."
                />
                <div className="row">
                  <button type="submit" className="btn primary" disabled={drafting || !requestText.trim() || !backup || Boolean(changesUnavailable)}>
                    {drafting ? "Drafting…" : `Draft against ${backup?.device ?? "a backup"}`}
                  </button>
                  <span className="muted">A draft only. Nothing is sent to a firewall.</span>
                </div>
                {changesUnavailable ? <p className="banner error">{changesUnavailable}</p> : null}
              </form>
              {change ? <ChangeView change={change} /> : <p className="muted">No drafts yet. Ask the engineer for one, or describe it above.</p>}
              {changes.length > 1 ? (
                <ul className="list">
                  {changes.map((c) => (
                    <li key={c.id}>
                      <button type="button" className="linkish" onClick={() => setChangeId(c.id)}>
                        {c.request.slice(0, 90)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {view === "workflows" ? <WorkflowsView /> : null}
        </main>
      </div>
    </div>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          },
          () => setDone(false),
        )
      }
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Code({ text, label }: { text: string; label: string }) {
  if (!text.trim()) return null;
  return (
    <div className="code">
      <div className="code-head">
        <span>{label}</span>
        <Copy text={text} />
      </div>
      <pre>{text}</pre>
    </div>
  );
}

const PHASE_LABEL: Record<string, string> = {
  starting: "Starting",
  working: "Working",
  grading: "Grading",
  waiting: "Needs approval",
  done: "Done",
  stopped: "Stopped",
};

function ReviewPanel({
  review,
  loading,
  finding,
  onFinding,
  onBack,
  onAnswer,
}: {
  review: ReviewState | null;
  loading: boolean;
  finding: Finding | null;
  onFinding: (id: string) => void;
  onBack: () => void;
  onAnswer: (allow: boolean) => void;
}) {
  if (loading) return <section className="panel"><p className="muted">Loading the review…</p></section>;
  if (!review) return <section className="panel"><p className="muted">No review open. Start one from the workspace, or ask the engineer.</p></section>;
  const doc = review.outputs?.findings ?? null;
  return (
    <section className="panel">
      <header className="review-head">
        <div>
          <h2>{review.device}</h2>
          <p className="muted">
            Reviewed {review.reviewDate}. {review.minutes} min{review.costUsd !== null ? `, $${review.costUsd.toFixed(2)}` : ""}.{" "}
            <a href={review.consoleUrl} target="_blank" rel="noreferrer">
              Open in Claude Console
            </a>
          </p>
        </div>
        <span className={`phase ${review.phase}`}>{PHASE_LABEL[review.phase] ?? review.phase}</span>
      </header>
      <p>{review.detail}</p>
      {review.grades.length ? (
        <ol className="grades">
          {review.grades.map((g) => (
            <li key={g.iteration} className={g.result}>
              Round {g.iteration + 1}: {g.result.replace(/_/g, " ")}
              {g.explanation ? <span className="muted"> {g.explanation.slice(0, 240)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {review.pending[0] ? (
        <div className="approval">
          <p>
            <strong>The review agent wants to run:</strong> <code>{review.pending[0].summary}</code>
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => onAnswer(true)}>
              Allow
            </button>
            <button type="button" className="btn ghost" onClick={() => onAnswer(false)}>
              Decline
            </button>
          </div>
        </div>
      ) : null}
      {review.lastMessage && review.phase !== "done" ? <p className="muted quote">{review.lastMessage.slice(0, 400)}</p> : null}

      {finding ? (
        <FindingView finding={finding} onBack={onBack} />
      ) : doc ? (
        <>
          <div className="sev-row">
            {SEVERITIES.map((s) => (
              <span key={s} className={`sev ${s}`}>
                {doc.summary[s]} {s}
              </span>
            ))}
          </div>
          <table className="findings">
            <thead>
              <tr>
                <th>ID</th>
                <th>Severity</th>
                <th>Check</th>
                <th>Finding</th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              {doc.findings.map((f) => (
                <tr key={f.id} onClick={() => onFinding(f.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onFinding(f.id)}>
                  <td className="mono">{f.id}</td>
                  <td>
                    <span className={`sev ${f.severity}`}>{f.severity}</span>
                  </td>
                  <td className="mono">{f.check}</td>
                  <td>{f.title}</td>
                  <td className="muted">{f.object}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {doc.accepted_deviations.length ? (
            <p className="muted">
              Accepted deviations: {doc.accepted_deviations.map((d) => `${d.check} ${d.object} (until ${d.expires})`).join("; ")}
            </p>
          ) : null}
        </>
      ) : null}
      {review.outputs?.report && !finding ? (
        <details className="report">
          <summary>Full report</summary>
          <Code text={review.outputs.report} label="report.md" />
        </details>
      ) : null}
    </section>
  );
}

function FindingView({ finding: f, onBack }: { finding: Finding; onBack: () => void }) {
  return (
    <article className="finding">
      <button type="button" className="linkish" onClick={onBack}>
        ← All findings
      </button>
      <h3>
        <span className={`sev ${f.severity}`}>{f.severity}</span> {f.id} · {f.check}: {f.title}
      </h3>
      <p className="muted">
        {f.object}
        {f.vdom ? `, VDOM ${f.vdom}` : ""}
        {f.lines.length ? `, lines ${f.lines.join(", ")}` : ""}
        {f.confidence === "unconfirmed" ? ", unconfirmed" : ""}
      </p>
      <h4>Why it matters</h4>
      <p>{f.why}</p>
      <Code text={f.evidence} label="Evidence" />
      <Code text={f.proposed_change} label="Proposed change (for review, not applied)" />
      {f.verify ? (
        <>
          <h4>Verify</h4>
          <p>{f.verify}</p>
        </>
      ) : null}
    </article>
  );
}

function ChangeView({ change: c }: { change: Change }) {
  const d = c.draft;
  return (
    <article className="change">
      <header className="review-head">
        <div>
          <h2>Draft for {c.device}</h2>
          <p className="muted">{c.request}</p>
        </div>
        <span className={`risk ${d.risk}`}>{d.risk} risk</span>
      </header>
      <p>{d.summary}</p>
      <p className="muted">{d.risk_reason}</p>
      {d.questions.length ? (
        <div className="approval">
          <strong>Still to confirm</strong>
          <ul>
            {d.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <h4>Placement</h4>
      <p>{d.placement}</p>
      {d.conflicts.length ? (
        <>
          <h4>Conflicts with existing rules</h4>
          <ul>
            {d.conflicts.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : null}
      <Code text={d.objects_cli} label="New objects" />
      <Code text={d.policy_cli} label="Policy" />
      <h4>Test plan</h4>
      <ol>
        {d.test_plan.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <Code text={d.rollback_cli} label="Rollback" />
      {d.assumptions.length ? (
        <>
          <h4>Assumptions</h4>
          <ul className="muted">
            {d.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

function WorkflowsView() {
  return (
    <section className="panel">
      <h2>The Cyber Security Engineer workflows</h2>
      <p className="muted">Two run today. Ask the engineer about any of them.</p>
      <div className="wf-grid">
        {WORKFLOWS.map((w) => (
          <article key={w.code} className="wf">
            <header>
              <span className="mono">{w.code}</span>
              <span className={`status ${w.status}`}>{w.status === "available" ? "Available" : w.status === "drafts" ? "Drafts" : "Designed"}</span>
            </header>
            <h3>{w.name}</h3>
            <p>{w.summary}</p>
            <p className="muted small">Needs: {w.needs}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
