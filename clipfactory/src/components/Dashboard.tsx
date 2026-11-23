"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobState, JobSummary, Short, StackReport } from "@/lib/types";
import { Cursors } from "./Cursors";
import { Header, StageBar } from "./Header";
import { Inspector } from "./Inspector";
import { Monitor } from "./Monitor";
import { OutputPanel } from "./Output";
import { RenderQueue } from "./RenderQueue";
import { Sequence } from "./Sequence";
import { Shelf } from "./Shelf";
import { ClippingStack } from "./Stack";
import { PostAllDialog, PostDialog, useYouTube, YouTubeSetup } from "./YouTube";

function jobFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("job");
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [stack, setStack] = useState<StackReport | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [yt, refreshYt] = useYouTube();
  const [setup, setSetup] = useState(false);
  const [posting, setPosting] = useState<string | null>(null);
  const [postAll, setPostAll] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Coming back from Google's consent screen.
  useEffect(() => {
    const url = new URL(window.location.href);
    const r = url.searchParams.get("youtube");
    if (!r) return;
    setNotice(r === "connected" ? { ok: true, text: `YouTube connected${url.searchParams.get("channel") ? `: ${url.searchParams.get("channel")}` : ""}. Shipped shorts now have a Post button.` } : { ok: false, text: url.searchParams.get("message") ?? "The YouTube login didn't finish." });
    for (const k of ["youtube", "message", "channel"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url);
  }, []);

  const refreshJobs = useCallback(async () => {
    const r = await fetch("/api/jobs", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return [];
    const { jobs: list } = (await r.json()) as { jobs: JobSummary[] };
    setJobs(list);
    return list;
  }, []);

  // First load: the installed stack, the job list, and which job to show.
  useEffect(() => {
    fetch("/api/stack", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: StackReport | null) => s && setStack(s))
      .catch(() => {});
    refreshJobs().then((list) => {
      const fromUrl = jobFromUrl();
      const pick = fromUrl && list.some((j) => j.id === fromUrl) ? fromUrl : (list.find((j) => j.status === "running" || j.status === "queued") ?? list[0])?.id;
      if (pick) setJobId(pick);
      else setShowForm(true);
      setLoaded(true);
    });
  }, [refreshJobs]);

  // Live job state over server-sent events.
  useEffect(() => {
    if (!jobId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    window.history.replaceState(null, "", url);
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    es.onmessage = (e) => {
      try {
        setJob(JSON.parse(e.data) as JobState);
      } catch {
        /* partial message */
      }
    };
    return () => es.close();
  }, [jobId]);

  // Keep the job switcher fresh when a job finishes.
  const status = job?.status;
  useEffect(() => {
    if (status && status !== "running") void refreshJobs();
  }, [status, refreshJobs]);

  const openJob = (id: string) => {
    setSelected(null);
    setJob(null);
    setShowForm(false);
    setJobId(id);
  };

  const action = async (what: "cancel" | "restart") => {
    if (!job) return;
    await fetch(`/api/jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: what }) });
  };

  const current: Short | null = useMemo(() => {
    if (!job) return null;
    return job.shorts.find((s) => s.id === selected) ?? job.shorts.find((s) => s.id === job.live.shortId) ?? job.shorts.find((s) => s.status === "rendering") ?? job.shorts[0] ?? null;
  }, [job, selected]);

  const running = job?.status === "running" || job?.status === "queued";

  return (
    <div className="factory" ref={root}>
      <Header
        job={job}
        jobs={jobs}
        stack={stack}
        yt={yt}
        onYouTubeSetup={() => setSetup(true)}
        onYouTubeChanged={() => void refreshYt()}
        onNew={() => setShowForm(true)}
        onOpen={openJob}
        onCancel={() => action("cancel")}
        onRestart={() => action("restart")}
      />
      <StageBar job={job} />
      {notice && (
        <div className={`error-banner${notice.ok ? " ok" : ""}`} role="status">
          <span>{notice.text}</span>
          <button className="btn" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {job?.status === "failed" && (
        <div className="error-banner" role="alert">
          <span>{job.error ?? "The job failed."}</span>
          <button className="btn primary" onClick={() => action("restart")}>
            Run again
          </button>
        </div>
      )}
      <div className="grid-2">
        <Monitor
          job={job}
          stack={stack}
          focus={selected ? current : null}
          showForm={showForm || (loaded && !jobId)}
          yt={yt}
          onCloseForm={jobId ? () => setShowForm(false) : undefined}
          onStarted={(id) => {
            void refreshJobs();
            openJob(id);
          }}
          onVideo={setVideo}
        />
        <OutputPanel job={job} short={current} />
      </div>
      <div className="grid-2">
        <Inspector job={job} video={video} />
        <RenderQueue job={job} selected={current?.id ?? null} onSelect={setSelected} />
      </div>
      <Sequence job={job} selected={current?.id ?? null} onSelect={setSelected} />
      <ClippingStack job={job} stack={stack} />
      <Shelf
        job={job}
        yt={yt}
        onPlay={setSelected}
        onPost={(id) => (yt?.connected ? setPosting(id) : setSetup(true))}
        onPostAll={() => (yt?.connected ? setPostAll(true) : setSetup(true))}
      />
      {setup && (
        <YouTubeSetup
          yt={yt}
          onClose={() => setSetup(false)}
          onChanged={() => void refreshYt()}
        />
      )}
      {job && yt?.connected && posting && job.shorts.find((s) => s.id === posting) && (
        <PostDialog job={job} short={job.shorts.find((s) => s.id === posting)!} yt={yt} onClose={() => setPosting(null)} />
      )}
      {job && yt?.connected && postAll && <PostAllDialog job={job} yt={yt} onClose={() => setPostAll(false)} />}
      {job && running && <Cursors root={root} job={job} />}
    </div>
  );
}
