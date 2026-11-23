"use client";

import { useState } from "react";
import { DEFAULT_OPTIONS, TOOLS, type JobOptions, type Privacy, type StackReport, type YouTubeStatus } from "@/lib/types";

const DUB_LANGS = [
  ["es", "ES"],
  ["de", "DE"],
  ["ja", "JP"],
  ["fr", "FR"],
  ["pt", "PT"],
] as const;

type Opts = Omit<JobOptions, "url" | "file">;

export function SourceForm(props: { stack: StackReport | null; yt: YouTubeStatus | null; onStarted: (id: string) => void; onClose?: () => void }) {
  const [url, setUrl] = useState("");
  const [opts, setOpts] = useState<Opts>({ ...DEFAULT_OPTIONS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const stack = props.stack;
  const native = stack ? TOOLS.filter((t) => stack.items[t.id]?.available).length : null;

  const startUrl = async () => {
    setError(null);
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("Paste a full link, like https://www.youtube.com/watch?v=…");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim(), options: opts }) });
      const body = (await r.json()) as { id?: string; error?: string };
      if (!r.ok || !body.id) throw new Error(body.error ?? "Couldn't start the job");
      props.onStarted(body.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File) => {
    setError(null);
    if (!/\.(mp4|m4v|mov|mkv|webm|avi|flv|ts)$/i.test(file.name)) {
      setError("That isn't a video file (mp4, mov, mkv, webm…).");
      return;
    }
    setBusy(true);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/upload?name=${encodeURIComponent(file.name)}&options=${encodeURIComponent(JSON.stringify(opts))}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      setBusy(false);
      setProgress(null);
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string; error?: string };
        if (xhr.status >= 300 || !body.id) throw new Error(body.error ?? "Upload failed");
        props.onStarted(body.id);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setProgress(null);
      setError("Upload failed. Is the server still running?");
    };
    xhr.send(file);
  };

  type Flag = "hook" | "removeSilence" | "stems" | "denoise" | "slowmo" | "teaser" | "punchIns" | "sfx" | "titleBar" | "progressBar" | "censor" | "audience";
  const toggle = (k: Flag, label: string, title?: string) => (
    <button type="button" className={`chipbtn${opts[k] ? " on" : ""}`} aria-pressed={opts[k]} onClick={() => set(k, !opts[k])} title={title}>
      {label}
    </button>
  );

  return (
    <div
      className={`source-form${drag ? " drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) upload(f);
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h2>01 · Pull the VOD</h2>
          <p>A YouTube, Twitch or Kick link, or drop a recording. Gameplay with a facecam works best.</p>
        </div>
        {props.onClose && (
          <button className="btn" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <form
        className="urlrow"
        onSubmit={(e) => {
          e.preventDefault();
          void startUrl();
        }}
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.twitch.tv/videos/…" aria-label="VOD link" disabled={busy} />
        <button className="btn primary" type="submit" disabled={busy}>
          Make shorts
        </button>
      </form>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn" style={{ cursor: busy ? "default" : "pointer" }}>
          Choose a file…
          <input type="file" accept="video/*,.mkv,.flv,.ts" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <span className="hint">or drop it anywhere here</span>
        {progress !== null && (
          <span className="hint" style={{ color: "var(--lime)" }}>
            Uploading {Math.round(progress * 100)}%
          </span>
        )}
      </div>
      {error && <div className="err">{error}</div>}

      <div className="opts">
        <label className="field">
          Shorts
          <input type="number" min={1} max={50} value={opts.count} onChange={(e) => set("count", Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
        </label>
        <label className="field">
          Length (s)
          <span style={{ display: "flex", gap: 4 }}>
            <input type="number" min={5} max={170} value={opts.minSec} onChange={(e) => set("minSec", Number(e.target.value) || 15)} style={{ width: "50%" }} aria-label="Shortest" />
            <input type="number" min={8} max={180} value={opts.maxSec} onChange={(e) => set("maxSec", Number(e.target.value) || 45)} style={{ width: "50%" }} aria-label="Longest" />
          </span>
        </label>
        <label className="field">
          Layout
          <select value={opts.layout} onChange={(e) => set("layout", e.target.value as Opts["layout"])}>
            <option value="auto">Auto (facecam split)</option>
            <option value="split">Facecam on top</option>
            <option value="crop">9:16 follow-cam</option>
            <option value="cutout">Streamer cutout</option>
            <option value="fit">Fit + blur</option>
          </select>
        </label>
        <label className="field">
          Captions
          <select
            value={opts.captions ? opts.captionStyle : "off"}
            onChange={(e) => (e.target.value === "off" ? set("captions", false) : setOpts((o) => ({ ...o, captions: true, captionStyle: e.target.value as Opts["captionStyle"] })))}
          >
            <option value="pop">Word pop</option>
            <option value="karaoke">Karaoke</option>
            <option value="clean">Clean</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="field">
          Upscale
          <select value={opts.upscale} onChange={(e) => set("upscale", e.target.value as Opts["upscale"])}>
            <option value="auto">Auto (low-res only)</option>
            <option value="4k">4K export</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="field">
          Language
          <select value={opts.language ?? ""} onChange={(e) => set("language", e.target.value || undefined)}>
            <option value="">Detect</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="pt">Portuguese</option>
            <option value="ja">Japanese</option>
          </select>
        </label>
      </div>
      <div className="toggles">
        {toggle("hook", "Hook text")}
        {toggle("removeSilence", "Cut dead air")}
        {toggle("stems", "Split stems")}
        {toggle("denoise", "Clean voice")}
        {toggle("slowmo", "Slow-mo replay", "Replays the payoff at 0.35× when there's no cold open")}
        {toggle("audience", "Audience signals", "YouTube's Most replayed graph, live-chat replay and timestamped comments, when the VOD has them")}
      </div>
      <div className="toggles">
        <span className="hint" style={{ alignSelf: "center", margin: "0 4px 0 0" }}>
          Edit:
        </span>
        {toggle("teaser", "Cold open", "Open on 1–3 s of the payoff, then rewind to the setup")}
        {toggle("punchIns", "Punch-ins", "Hard zoom-ins on the payoff and the loudest reactions")}
        {toggle("sfx", "Sound FX", "A whoosh into each cut, a hit under the payoff zoom")}
        {toggle("titleBar", "Title bar", "A headline in a white box across the top")}
        {toggle("progressBar", "Progress bar", "A thin bar along the top that fills up")}
        {toggle("censor", "Bleep swearing", "Masks swear words in captions and titles and bleeps them. Strong swearing early in a video can limit ads on YouTube.")}
      </div>
      <div className="toggles">
        <span className="hint" style={{ alignSelf: "center", margin: "0 4px 0 0" }}>
          Dub:
        </span>
        {DUB_LANGS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            className={`chipbtn${opts.dub.includes(code) ? " on" : ""}`}
            aria-pressed={opts.dub.includes(code)}
            onClick={() => set("dub", opts.dub.includes(code) ? opts.dub.filter((d) => d !== code) : [...opts.dub, code])}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="toggles" style={{ alignItems: "center" }}>
        <button
          type="button"
          className={`chipbtn${opts.publish ? " on" : ""}`}
          aria-pressed={Boolean(opts.publish)}
          disabled={!props.yt?.connected}
          onClick={() => set("publish", opts.publish ? undefined : { privacy: "public", everyHours: 6 })}
          title={props.yt?.connected ? undefined : "Connect a YouTube channel first (top of the page)"}
        >
          ▶ Post to YouTube when done
        </button>
        {opts.publish && (
          <>
            <select className="chipbtn" value={opts.publish.privacy} onChange={(e) => set("publish", { ...opts.publish!, privacy: e.target.value as Privacy })} aria-label="Who can see them">
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
            {opts.publish.privacy === "public" && (
              <select className="chipbtn" value={opts.publish.everyHours ?? 0} onChange={(e) => set("publish", { ...opts.publish!, everyHours: Number(e.target.value) || undefined })} aria-label="Spacing">
                <option value={0}>all at once</option>
                <option value={3}>one every 3 h</option>
                <option value={6}>one every 6 h</option>
                <option value={12}>one every 12 h</option>
                <option value={24}>one a day</option>
              </select>
            )}
          </>
        )}
        {!props.yt?.connected && <span className="hint">Connect YouTube at the top to post automatically.</span>}
        {props.yt?.connected && opts.publish && <span className="hint">to {props.yt.channel?.title ?? "your channel"}</span>}
      </div>
      <label className="field">
        Direction for the orchestrator (optional)
        <input value={opts.instructions ?? ""} onChange={(e) => set("instructions", e.target.value || undefined)} placeholder="e.g. only the funniest fails, nothing with music" />
      </label>
      {stack && (
        <div className="hint">
          {native} of 18 repos installed{stack.gpu ? ` · ${stack.gpu}` : " · CPU only"} · {stack.claude.enabled ? "Claude picks the moments" : "no ANTHROPIC_API_KEY: the built-in scorer picks the moments"}.
          {native !== null && native < 18 && <> Run <code>npm run setup -- --full</code> for the rest.</>}
        </div>
      )}
    </div>
  );
}
