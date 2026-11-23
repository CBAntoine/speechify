"use client";

import { useEffect, useRef, useState } from "react";
import { compact } from "@/lib/format";
import { defaultPost } from "@/lib/post-text";
import type { JobState, Privacy, Short, YouTubeStatus } from "@/lib/types";

// Connecting a channel, and the post dialogs.

export function useYouTube(): [YouTubeStatus | null, () => Promise<void>] {
  const [yt, setYt] = useState<YouTubeStatus | null>(null);
  const refresh = async () => {
    const r = await fetch("/api/youtube", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setYt((await r.json()) as YouTubeStatus);
  };
  useEffect(() => {
    void refresh();
  }, []);
  return [yt, refresh];
}

function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size * 1.4} height={size} viewBox="0 0 28 20" aria-hidden="true" style={{ display: "block" }}>
      <rect width="28" height="20" rx="5" fill="#ff1f3d" />
      <path d="M11 5.5v9l8-4.5z" fill="#fff" />
    </svg>
  );
}

/** Header button: connect, or the connected channel with a disconnect menu. */
export function YouTubeButton({ yt, onSetup, onChanged }: { yt: YouTubeStatus | null; onSetup: () => void; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  if (!yt) return null;
  if (!yt.connected) {
    const label = yt.error ? "Reconnect YouTube" : "Connect YouTube";
    return (
      <button className="btn" onClick={() => (yt.configured ? (window.location.href = "/api/youtube/connect") : onSetup())} title={yt.error}>
        <PlayIcon /> {label}
      </button>
    );
  }
  const c = yt.channel;
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="btn yt-chip" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
        {c?.thumbnail ? <img src={c.thumbnail} alt="" width={18} height={18} /> : <PlayIcon />}
        <span className="yt-name">{c?.title ?? "YouTube"}</span>
        {c?.subscribers !== undefined && <span style={{ color: "var(--dim)" }}>{compact(c.subscribers)} subs</span>}
      </button>
      {menu && (
        <div className="menu" role="menu">
          {c && (
            <a role="menuitem" href={`https://www.youtube.com/channel/${c.id}`} target="_blank" rel="noreferrer">
              Open channel ↗
            </a>
          )}
          <a role="menuitem" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
            YouTube Studio ↗
          </a>
          <button
            role="menuitem"
            onClick={async () => {
              setMenu(false);
              if (!confirm("Disconnect this channel? Clip Factory will no longer be able to post to it.")) return;
              await fetch("/api/youtube/disconnect", { method: "POST" });
              onChanged();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** One-time setup: your own Google OAuth client, so the login stays on this computer. */
export function YouTubeSetup({ yt, onClose, onChanged }: { yt: YouTubeStatus | null; onClose: () => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ id: "", secret: "" });
  const [drag, setDrag] = useState(false);
  const save = async (body: unknown) => {
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/youtube/client", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Couldn't save it");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const readFile = async (f: File) => {
    try {
      await save(JSON.parse(await f.text()));
    } catch {
      setError("That file isn't the OAuth client JSON from Google Cloud Console.");
    }
  };
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  return (
    <Modal title="Connect a YouTube channel" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Clip Factory posts with your own Google OAuth client, so your login never leaves this computer. It's a one-time setup of about five minutes in Google Cloud (free).
      </p>
      <ol className="steps">
        <li>
          Create a project in Google Cloud and enable the <b>YouTube Data API v3</b>.{" "}
          <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">
            Open ↗
          </a>
        </li>
        <li>
          Set up the <b>OAuth consent screen</b> (Google Auth Platform): user type <b>External</b>, and add your Google account as a test user.{" "}
          <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">
            Open ↗
          </a>
          <div className="hint">
            While it says "Testing", Google ends the login after 7 days. Under Audience, press <b>Publish app</b> to stay connected. Google will warn that it hasn't verified the app; it's your own app, so choose Advanced → continue.
          </div>
        </li>
        <li>
          Create an <b>OAuth client ID</b> of type <b>Desktop app</b>, then download its JSON.{" "}
          <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">
            Open ↗
          </a>
          {yt && (
            <div className="hint">
              Using a Web application client instead? Add this authorised redirect URI:{" "}
              <code className="copy" onClick={() => copy(yt.redirectUri)} title="Copy">
                {yt.redirectUri}
              </code>
            </div>
          )}
        </li>
        <li>
          Drop that JSON here:
          <label
            className={`drop${drag ? " on" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }}
          >
            {yt?.configured ? `✓ OAuth client saved (${yt.clientType === "web" ? "web application" : "desktop app"}). Drop another to replace it.` : "client_secret_….json — drop it or click to choose"}
            <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
          </label>
          <details className="hint">
            <summary>Or paste the client ID and secret</summary>
            <div className="opts" style={{ marginTop: 8 }}>
              <label className="field">
                Client ID
                <input value={manual.id} onChange={(e) => setManual({ ...manual, id: e.target.value })} placeholder="….apps.googleusercontent.com" />
              </label>
              <label className="field">
                Client secret
                <input value={manual.secret} onChange={(e) => setManual({ ...manual, secret: e.target.value })} type="password" />
              </label>
            </div>
            <button className="btn" style={{ marginTop: 8 }} disabled={busy || !manual.id} onClick={() => save({ installed: { client_id: manual.id, client_secret: manual.secret } })}>
              Save
            </button>
          </details>
        </li>
      </ol>
      {error && <div className="err">{error}</div>}
      <div className="modal-foot">
        <span className="hint">Uploads count against your project's YouTube quota, and YouTube's own daily limit per channel still applies.</span>
        <button className="btn primary" disabled={!yt?.configured} onClick={() => (window.location.href = "/api/youtube/connect")}>
          <PlayIcon /> Sign in with Google
        </button>
      </div>
    </Modal>
  );
}

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Post one short: edit the title and description, pick who sees it and when. */
export function PostDialog({ job, short, yt, onClose }: { job: JobState; short: Short; yt: YouTubeStatus; onClose: () => void }) {
  const d = defaultPost(job, short);
  const [title, setTitle] = useState(short.youtube?.title ?? d.title);
  const [description, setDescription] = useState(d.description);
  const [privacy, setPrivacy] = useState<Privacy>(short.youtube?.privacy ?? "public");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState(localInput(new Date(Date.now() + 3600_000)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${job.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId: short.id, title, description, privacy, publishAt: when === "later" && privacy === "public" ? new Date(at).toISOString() : undefined }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Couldn't post");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Post to YouTube" onClose={onClose}>
      <div className="post-grid">
        <label className="field">
          Title <span className="count">{[...title].length}/100</span>
          <input ref={first} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Description
          <textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="opts">
          <label className="field">
            Who can see it
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)}>
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
          <label className="field">
            When
            <select value={privacy === "public" ? when : "now"} disabled={privacy !== "public"} onChange={(e) => setWhen(e.target.value as "now" | "later")}>
              <option value="now">Now</option>
              <option value="later">Schedule…</option>
            </select>
          </label>
          {when === "later" && privacy === "public" && (
            <label className="field">
              Goes live
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </label>
          )}
        </div>
        {when === "later" && privacy === "public" && <div className="hint">YouTube keeps it private and publishes it at that time; this computer can be off.</div>}
      </div>
      {error && <div className="err">{error}</div>}
      <div className="modal-foot">
        <span className="hint">
          Posting to <b>{yt.channel?.title ?? "your channel"}</b> as a Short.
        </span>
        <button className="btn primary" onClick={post} disabled={busy || !title.trim()}>
          <PlayIcon /> {when === "later" && privacy === "public" ? "Schedule" : "Post"}
        </button>
      </div>
    </Modal>
  );
}

/** Post every shipped short at once, or spread them out. */
export function PostAllDialog({ job, yt, onClose }: { job: JobState; yt: YouTubeStatus; onClose: () => void }) {
  const todo = job.shorts.filter((s) => s.status === "done" && s.file && (!s.youtube || s.youtube.status === "failed"));
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [mode, setMode] = useState<"now" | "spread" | "start">("spread");
  const [every, setEvery] = useState(6);
  const [at, setAt] = useState(localInput(new Date(Date.now() + 3600_000)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scheduled = privacy === "public" && mode !== "now";
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/jobs/${job.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacy, everyHours: scheduled ? every : undefined, startAt: scheduled && mode === "start" ? new Date(at).toISOString() : undefined }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? "Couldn't post");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Post ${todo.length} short${todo.length === 1 ? "" : "s"} to YouTube`} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        In posting order, best first, with the titles, descriptions and hashtags Clip Factory wrote. To edit one first, use its own Post button.
      </p>
      <div className="opts">
        <label className="field">
          Who can see them
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)}>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="field">
          When
          <select value={privacy === "public" ? mode : "now"} disabled={privacy !== "public"} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="spread">One now, then spaced out</option>
            <option value="start">Start later, spaced out</option>
            <option value="now">All now</option>
          </select>
        </label>
        {scheduled && (
          <label className="field">
            Every (hours)
            <input type="number" min={1} max={168} value={every} onChange={(e) => setEvery(Math.max(1, Math.min(168, Number(e.target.value) || 1)))} />
          </label>
        )}
        {scheduled && mode === "start" && (
          <label className="field">
            First one goes live
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
        )}
      </div>
      {scheduled && <div className="hint">YouTube holds the scheduled ones as private and publishes each on time; this computer can be off.</div>}
      {error && <div className="err">{error}</div>}
      <div className="modal-foot">
        <span className="hint">
          Posting to <b>{yt.channel?.title ?? "your channel"}</b>.
        </span>
        <button className="btn primary" onClick={go} disabled={busy || !todo.length}>
          <PlayIcon /> Post {todo.length}
        </button>
      </div>
    </Modal>
  );
}

/** Where a short stands on YouTube, for its card. */
export function PostState({ short, onPost }: { short: Short; onPost: () => void }) {
  const y = short.youtube;
  if (!y)
    return (
      <button className="btn yt" onClick={onPost}>
        <PlayIcon size={10} /> Post
      </button>
    );
  const label =
    y.status === "queued"
      ? "Waiting to upload"
      : y.status === "uploading"
        ? `Uploading ${Math.round(y.progress * 100)}%`
        : y.status === "processing"
          ? "YouTube is processing"
          : y.status === "scheduled"
            ? `Live ${y.publishAt ? new Date(y.publishAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "soon"}`
            : y.status === "posted"
              ? `Posted · ${y.privacy}`
              : "Upload failed";
  return (
    <div className="yt-state">
      {y.url ? (
        <a className={`btn yt${y.status === "failed" ? "" : " on"}`} href={y.url} target="_blank" rel="noreferrer">
          <PlayIcon size={10} /> {label} ↗
        </a>
      ) : (
        <span className={`btn yt${y.status === "failed" ? "" : " on"}`}>
          <PlayIcon size={10} /> {label}
        </span>
      )}
      {(y.status === "uploading" || y.status === "queued") && (
        <span className="bar" style={{ display: "block", margin: "4px 0 0" }}>
          <i style={{ width: `${Math.round(y.progress * 100)}%` }} />
        </span>
      )}
      {y.note && <span className="hint" style={{ color: "var(--amber)" }}>{y.note}</span>}
      {y.status === "failed" && (
        <>
          <span className="hint" style={{ color: "var(--pink)" }}>{y.error}</span>
          <button className="btn" onClick={onPost}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
