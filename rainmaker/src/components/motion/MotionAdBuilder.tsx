"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ImagePlus, LoaderCircle, Mic, Music, Pencil, Plus, RefreshCw, Sparkles, Trash, Wand2, X } from "lucide-react";
import { api, useToast } from "@/components/client";
import { timeAgo } from "@/lib/format";
import { logoSharpness, sharpness, SHARP_4K } from "@/lib/motion/image-size";
import { ACCENTS, CAMERAS, FILLS, FORMATS, SFX, SHAPES, timeline } from "@/lib/motion/story";
import type { MotionAd, MotionShot } from "@/lib/types";
import { frameSize, loadPicture, MotionEngine, type MotionPictures } from "./engine";
import { MotionPlayer, type PlayerAudio } from "./MotionPlayer";
import { loadAudio } from "./sound";

// Ad Studio → Motion ad. The four steps of a motion-graphics ad made in
// code: (1) gather their assets, (2) a numbered storyboard you edit and
// approve, (3) the animation in Three.js, rendered to 1080p or 4K on your
// device, (4) sound design made in code, their own track, and narration.

type LeadLite = { id: string; name: string; niche: string; city?: string; website?: string; phone?: string };
type Listing = { ads: MotionAd[]; claude: boolean; elevenlabs: boolean };
type Voice = { voice_id: string; name: string; category?: string };

const GOALS = ["Book more appointments", "Get more calls and quote requests", "Sell more products", "Get known in town"];
const SHAPE_LABEL: Record<MotionShot["shape"], string> = { circle: "Circle", ring: "Ring", rounded: "Rounded square", square: "Square", pill: "Pill", card: "Tall card", phone: "Phone", bar: "Bar" };
const FILL_LABEL: Record<MotionShot["fill"], string> = { brand: "Brand colour", accent: "Accent colour", light: "Light", dark: "Dark", logo: "Logo", photo: "Photo" };
const CAMERA_LABEL: Record<MotionShot["camera"], string> = { still: "Still (drift)", push: "Push in", pull: "Pull back", tilt: "Tilt", orbit: "Orbit" };
const ACCENT_LABEL: Record<MotionShot["accent"], string> = { none: "None", orbit: "Orbiting dots", burst: "Burst", rings: "Ripples", lines: "Speed lines" };
const asset = (id: string) => `/api/assets/${id}`;
const UPLOAD_MAX = 4_200_000;

// ── Loading pictures and sound for the engine ────────────────

function usePictures(ad: MotionAd | undefined): MotionPictures | null {
  const key = ad ? [ad.assets.logo?.id ?? "", ...ad.assets.photos.map((p) => p.id)].join(",") : "";
  const [pics, setPics] = useState<{ key: string; pics: MotionPictures } | null>(null);
  useEffect(() => {
    if (!ad) return;
    let gone = false;
    const [logo, ...photos] = key.split(",");
    Promise.all([logo ? loadPicture(asset(logo), 1600) : Promise.resolve(undefined), ...photos.filter(Boolean).map((id) => loadPicture(asset(id), 1600))]).then(([l, ...p]) => {
      if (!gone) setPics({ key, pics: { logo: l, photos: p } });
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return pics && pics.key === key ? pics.pics : null;
}

function useAudio(ad: MotionAd | undefined): PlayerAudio {
  const musicId = ad?.assets.music?.id;
  const voiceId = ad?.voiceover?.assetId;
  const [a, setA] = useState<PlayerAudio & { key?: string }>({});
  useEffect(() => {
    let gone = false;
    const ctx = new OfflineAudioContext(2, 1, 48000);
    Promise.all([musicId ? loadAudio(ctx, asset(musicId)) : undefined, voiceId ? loadAudio(ctx, asset(voiceId)) : undefined]).then(([music, voice]) => {
      if (!gone) setA({ music, voice, key: `${musicId}|${voiceId}` });
    });
    return () => {
      gone = true;
    };
  }, [musicId, voiceId]);
  return a.key === `${musicId}|${voiceId}` ? a : {};
}

/** A still of each shot, for the storyboard. */
function useStills(ad: MotionAd | undefined, shots: MotionShot[], pictures: MotionPictures | null): string[] {
  const [stills, setStills] = useState<string[]>([]);
  const engine = useRef<MotionEngine | null>(null);
  useEffect(() => {
    if (!ad || !pictures || !shots.length) return;
    let gone = false;
    const timer = setTimeout(async () => {
      try {
        const size = frameSize(ad.format, "preview", 180);
        if (!engine.current) engine.current = await MotionEngine.create({ width: size.w, height: size.h, antialias: true, maxTexture: 900 });
        if (gone) return;
        const e = engine.current;
        e.setSize(size.w, size.h);
        e.setScene({ shots, brand: ad.brand, format: ad.format, pictures });
        const { starts } = timeline(shots);
        setStills(
          shots.map((s, i) => {
            e.render(starts[i] + Math.min(s.seconds - 0.05, 1.7));
            return e.canvas.toDataURL("image/jpeg", 0.82);
          })
        );
      } catch {
        // No WebGL: the storyboard still works without pictures.
      }
    }, 300);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [ad, shots, pictures]);
  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    []
  );
  return stills;
}

// ── Uploads (pictures resized here so they fit the upload limit) ──

async function svgBitmap(file: File, side: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth || 1;
    const h0 = img.naturalHeight || 1;
    const k = side / Math.max(w0, h0);
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));

async function preparePicture(file: File, kind: "logo" | "photo"): Promise<Blob> {
  const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const longest = kind === "logo" ? 2048 : 3840;
  let canvas: HTMLCanvasElement;
  if (svg) canvas = await svgBitmap(file, 2048);
  else {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) throw new Error(`${file.name} couldn't be opened. Use a JPEG, PNG or WebP picture.`);
    const long = Math.max(bmp.width, bmp.height);
    if (long <= longest && file.size <= UPLOAD_MAX && /^image\/(png|jpeg|webp)$/.test(file.type)) {
      bmp.close();
      return file;
    }
    const k = Math.min(1, longest / long);
    canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
  }
  const type = kind === "logo" ? "image/png" : "image/jpeg";
  for (const q of [0.92, 0.85, 0.75]) {
    const b = await toBlob(canvas, type, q);
    if (b && b.size <= UPLOAD_MAX) return b;
    if (kind === "logo" && b) {
      // A huge PNG logo: halve it.
      const half = document.createElement("canvas");
      half.width = Math.round(canvas.width / 2);
      half.height = Math.round(canvas.height / 2);
      half.getContext("2d")!.drawImage(canvas, 0, 0, half.width, half.height);
      canvas = half;
    }
  }
  throw new Error(`${file.name} is too big even after resizing.`);
}

function wav(mono: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + mono.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + mono.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm" };

/** Their track as is when it fits; otherwise the part the ad needs, as a small WAV. */
async function prepareMusic(file: File, seconds: number): Promise<Blob> {
  const type = file.type || AUDIO_EXT[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
  if (file.size <= UPLOAD_MAX && /^audio\//.test(type)) return file.type ? file : new Blob([file], { type });
  const rate = 32000;
  const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await file.arrayBuffer()).catch(() => null);
  if (!decoded) throw new Error(`${file.name} couldn't be read. Use an MP3, M4A or WAV file.`);
  const len = Math.min(decoded.length, Math.round(Math.min(60, Math.max(30, seconds + 2)) * rate));
  const mono = new Float32Array(len);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const d = decoded.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += d[i] / decoded.numberOfChannels;
  }
  return wav(mono, rate);
}

// ── The builder ──────────────────────────────────────────────

export function MotionAdBuilder({ leads, initialLeadId }: { leads: LeadLite[]; initialLeadId?: string }) {
  const toast = useToast();
  const [data, setData] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [leadId, setLeadId] = useState(initialLeadId && leads.some((l) => l.id === initialLeadId) ? initialLeadId : (leads[0]?.id ?? "other"));
  const [business, setBusiness] = useState("");
  const [website, setWebsite] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [cta, setCta] = useState("");
  const [notes, setNotes] = useState("");
  const [format, setFormat] = useState<MotionAd["format"]>("vertical");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [messages, setMessages] = useState<Record<string, string[]>>({});
  const editorRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState(0);
  const lead = leads.find((l) => l.id === leadId);

  // Picking or making an ad brings it into view (on a phone it's below the form).
  useEffect(() => {
    if (jump) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jump]);

  useEffect(() => {
    api<Listing>("/api/motion")
      .then((d) => {
        setData(d);
        setSelected((s) => s || (initialLeadId ? d.ads.find((a) => a.leadId === initialLeadId)?.id : d.ads[0]?.id) || "");
      })
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"));
  }, [toast, initialLeadId]);

  const replace = useCallback((ad: MotionAd, notes?: string[]) => {
    setData((d) => (d ? { ...d, ads: d.ads.some((a) => a.id === ad.id) ? d.ads.map((a) => (a.id === ad.id ? ad : a)) : [ad, ...d.ads] } : d));
    if (notes) setMessages((m) => ({ ...m, [ad.id]: notes }));
  }, []);

  async function create() {
    setBusy(true);
    const steps = [
      [0, "Reading their website for the logo, photos and colour…"],
      [9000, data?.claude ? "Claude is directing the storyboard…" : "Writing the storyboard…"],
      [40000, "Checking every shot…"],
    ] as const;
    const timers = steps.map(([ms, text]) => setTimeout(() => setPhase(text), ms));
    try {
      const r = await api<{ ad: MotionAd; notes: string[] }>("/api/motion", {
        method: "POST",
        json: { leadId: lead ? lead.id : undefined, business: lead ? undefined : business, website: lead ? undefined : website, goal, offer, audience, cta, notes, format },
      });
      replace(r.ad, r.notes);
      setSelected(r.ad.id);
      setJump((j) => j + 1);
      toast(`Storyboard ready: ${r.ad.shots.length} shots. Check it, then approve.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      timers.forEach(clearTimeout);
      setPhase("");
      setBusy(false);
    }
  }

  const ad = data?.ads.find((a) => a.id === selected);
  const canCreate = lead ? true : business.trim().length > 1;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="vbuilder">
        <section className="card card-pad stack" style={{ gap: 12 }}>
          <div className="row between">
            <h2 className="display" style={{ margin: 0, fontSize: 19 }}>
              <Wand2 size={17} style={{ display: "inline", verticalAlign: -2 }} /> Motion ad
            </h2>
            <span className="badge brand">
              <Sparkles size={12} /> {data?.claude ? "Directed by Claude" : "Template"}
            </span>
          </div>
          <div className="muted small">
            A motion-graphics ad made in code, for the business to run on Reels, TikTok, Shorts or YouTube. One shape in the centre morphs from shot to shot over a
            background that never stops moving, and the words slide up into place. No stock footage or AI video: it uses their real logo, photos and colours.
          </div>
          <label className="field">
            <span>Business</span>
            <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)} disabled={busy}>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.city ? ` · ${l.city}` : ""}
                </option>
              ))}
              <option value="other">Another business…</option>
            </select>
          </label>
          {!lead && (
            <div className="grid-2">
              <label className="field">
                <span>Name</span>
                <input className="input" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="Northwind Heating" />
              </label>
              <label className="field">
                <span>Website</span>
                <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="northwind.ca" inputMode="url" />
              </label>
            </div>
          )}
          <label className="field">
            <span>Goal</span>
            <select className="select" value={goal} onChange={(e) => setGoal(e.target.value)}>
              {GOALS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Offer</span>
              <input className="input" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Furnace tune-up $149" />
            </label>
            <label className="field">
              <span>Audience</span>
              <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Calgary homeowners" />
            </label>
          </div>
          <label className="field">
            <span>Call to action line</span>
            <input className="input" value={cta} onChange={(e) => setCta(e.target.value)} placeholder={lead?.phone || "Phone, website or booking line"} />
          </label>
          <label className="field">
            <span>True things to include</span>
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Family-run since 1998, 10-year parts warranty, same-day service" />
            <small>Prices, numbers and claims in the ad come only from here, the offer and their real data.</small>
          </label>
          <div className="field">
            <span>Format</span>
            <div className="seg">
              {(Object.keys(FORMATS) as MotionAd["format"][]).map((f) => (
                <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}>
                  {FORMATS[f].label}
                </button>
              ))}
            </div>
          </div>
          <button className="btn primary" onClick={() => void create()} disabled={busy || !canCreate}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Wand2 size={15} />} {busy ? phase || "Working…" : "Gather assets and write the storyboard"}
          </button>
          {busy && <div className="faint small">This takes up to a minute.</div>}
        </section>

        <section className="card card-pad stack" style={{ gap: 10 }} aria-label="How it works">
          <b>How it works</b>
          <ol className="msteps-help">
            <li>
              <b>Assets.</b> Their logo, photos and brand colour come from their website. Add your own high-resolution photos (1,500 px or more for 4K).
            </li>
            <li>
              <b>Storyboard.</b> {data?.claude ? "Claude, as art director," : "The template"} writes numbered shots. Edit the words, shapes, camera and timing, or ask
              for changes, then approve it.
            </li>
            <li>
              <b>Animation.</b> The approved storyboard is animated in Three.js on your device and rendered to a 1080p or 4K MP4, frame by frame.
            </li>
            <li>
              <b>Sound.</b> Whooshes, soft hits and pullbacks are synthesized in code on every morph, with music made in code or your own track, and an optional
              ElevenLabs voiceover the music ducks under.
            </li>
          </ol>
          <div className="faint small">
            Rules every ad follows: each shot morphs into the next (no cross dissolves), the action stays dead centre, the background keeps moving, and words slide up
            from behind a mask instead of fading or bouncing.
          </div>
          {!!data?.ads.length && (
            <>
              <b style={{ marginTop: 6 }}>Your motion ads</b>
              <div className="stack" style={{ gap: 6 }}>
                {data.ads.slice(0, 12).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`vchoice ${a.id === selected ? "on" : ""}`}
                    onClick={() => {
                      setSelected(a.id);
                      setJump((j) => j + 1);
                    }}
                    style={{ textAlign: "left" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{a.business}</b>{" "}
                      <span className="faint small">
                        · {FORMATS[a.format].label} · {a.shots.length} shots · {timeline(a.shots).total.toFixed(0)}s
                      </span>
                      <span className="muted small" style={{ display: "block" }}>
                        {a.status === "approved" ? "Approved" : "Storyboard"} · {timeAgo(a.updatedAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <div ref={editorRef} style={{ scrollMarginTop: 72 }} />
      {ad && data && (
        <MotionEditor
          key={ad.id}
          ad={ad}
          claude={data.claude}
          elevenlabs={data.elevenlabs}
          notes={messages[ad.id] ?? []}
          onChange={replace}
          onDelete={() => {
            setData((d) => (d ? { ...d, ads: d.ads.filter((a) => a.id !== ad.id) } : d));
            setSelected("");
          }}
        />
      )}
      {!leads.length && !data?.ads.length && (
        <div className="faint small">
          Tip: businesses in your <Link href="/pipeline">pipeline</Link> fill in their website, phone and Google rating automatically.
        </div>
      )}
    </div>
  );
}

// ── One motion ad: assets, storyboard, animation and sound ───

function MotionEditor({ ad, claude, elevenlabs, notes, onChange, onDelete }: { ad: MotionAd; claude: boolean; elevenlabs: boolean; notes: string[]; onChange: (ad: MotionAd, notes?: string[]) => void; onDelete: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(ad.status === "approved" ? 3 : 2);
  const [draft, setDraft] = useState<MotionShot[]>(ad.shots);
  const [concept, setConcept] = useState(ad.concept);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [colors, setColors] = useState({ primary: ad.brand.primary, accent: ad.brand.accent });
  const colorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pictures = usePictures(ad);
  const audio = useAudio(ad);
  const stills = useStills(ad, draft, pictures);
  const dirty = JSON.stringify(draft) !== JSON.stringify(ad.shots) || concept !== ad.concept;
  const total = timeline(draft).total;

  useEffect(() => setDraft(ad.shots), [ad.shots]);
  useEffect(() => setConcept(ad.concept), [ad.concept]);
  useEffect(() => {
    if (!elevenlabs) return;
    api<{ voices: Voice[]; defaultVoiceId: string }>("/api/elevenlabs/voices")
      .then((r) => {
        setVoices(r.voices);
        setVoiceId((v) => v || r.defaultVoiceId);
      })
      .catch(() => undefined);
  }, [elevenlabs]);

  async function run<T extends { ad: MotionAd; notes?: string[] }>(label: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
    setBusy(label);
    try {
      const r = await fn();
      onChange(r.ad, r.notes);
      if (ok) toast(ok);
      return r;
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      return undefined;
    } finally {
      setBusy("");
    }
  }

  const patch = (json: Record<string, unknown>, label = "save", ok?: string) => run(label, () => api<{ ad: MotionAd; notes: string[] }>(`/api/motion/${ad.id}`, { method: "PATCH", json }), ok);
  const action = (json: Record<string, unknown>, label: string, ok?: string) => run(label, () => api<{ ad: MotionAd; notes: string[] }>(`/api/motion/${ad.id}`, { method: "POST", json }), ok);

  async function upload(kind: "logo" | "photo" | "music", files: FileList | null) {
    if (!files?.length) return;
    setBusy(`upload-${kind}`);
    try {
      for (const file of [...files].slice(0, kind === "photo" ? 8 : 1)) {
        const blob = kind === "music" ? await prepareMusic(file, total) : await preparePicture(file, kind);
        const r = await api<{ ad: MotionAd; notes: string[] }>(`/api/motion/${ad.id}/assets?kind=${kind}&name=${encodeURIComponent(file.name.slice(0, 80))}`, {
          method: "POST",
          body: blob,
          headers: { "content-type": blob.type || file.type },
        });
        onChange(r.ad, r.notes);
      }
      toast(kind === "music" ? "Track added. It replaces the music made in code." : kind === "logo" ? "Logo updated." : "Added.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy("");
    }
  }

  const removeAsset = (id: string) => run("remove", () => api<{ ad: MotionAd; notes: string[] }>(`/api/motion/${ad.id}/assets?asset=${id}`, { method: "DELETE" }));

  function setColor(key: "primary" | "accent", value: string) {
    setColors((c) => ({ ...c, [key]: value }));
    clearTimeout(colorTimer.current);
    colorTimer.current = setTimeout(() => void patch({ brand: { [key]: value } }, "colour"), 500);
  }

  const edit = (i: number, p: Partial<MotionShot>) => setDraft((d) => d.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  async function approve() {
    const r = await patch({ ...(dirty ? { shots: draft, concept } : {}), status: "approved" }, "approve", "Storyboard approved. Here's the animation.");
    if (r) setStep(3);
  }

  async function unapprove() {
    const r = await patch({ status: "storyboard" }, "unapprove");
    if (r) setStep(2);
  }

  async function remove() {
    if (!confirm(`Delete the motion ad for ${ad.business}? Its uploaded photos and track go too.`)) return;
    try {
      await api(`/api/motion/${ad.id}`, { method: "DELETE" });
      onDelete();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!ad.assets.logo) out.push("No logo yet. Upload one (a PNG with a transparent background, or an SVG) or shots use their brand colour.");
    if (!ad.assets.photos.length) out.push("No photos yet. Upload a few of their work, team or products; shots fall back to colour without them.");
    ad.assets.photos.forEach((p, i) => {
      if (sharpness(p) === "low") out.push(`Photo ${i + 1} is ${p.w}×${p.h} and will look soft. Use one at least ${SHARP_4K.toLocaleString()} px on its short side for 4K.`);
    });
    return out;
  }, [ad.assets]);

  const voiceLines = draft.filter((s) => s.voice?.trim()).length;
  const sound = ad.sound;

  return (
    <section className="card card-pad stack" style={{ gap: 14 }} aria-label={`Motion ad for ${ad.business}`}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="stack" style={{ gap: 2 }}>
          <b style={{ fontSize: 16 }}>{ad.business}</b>
          <span className="faint small">
            {FORMATS[ad.format].label} · {draft.length} shots · {total.toFixed(1)}s · {ad.writtenBy === "claude" ? "Directed by Claude" : "Template"} · {ad.status === "approved" ? "Approved" : "Storyboard"}
          </span>
        </div>
        <button className="btn sm ghost" onClick={() => void remove()} aria-label="Delete motion ad">
          <Trash size={13} />
        </button>
      </div>

      <nav className="mstepper" aria-label="Steps">
        <button type="button" aria-current={step === 1 ? "step" : undefined} onClick={() => setStep(1)}>
          <span>1</span> Assets
        </button>
        <button type="button" aria-current={step === 2 ? "step" : undefined} onClick={() => setStep(2)}>
          <span>{ad.status === "approved" ? <Check size={12} /> : 2}</span> Storyboard
        </button>
        <button type="button" aria-current={step === 3 ? "step" : undefined} onClick={() => setStep(3)} disabled={ad.status !== "approved"} title={ad.status !== "approved" ? "Approve the storyboard first" : undefined}>
          <span>3</span> Animate, sound &amp; render
        </button>
      </nav>

      {notes.length > 0 && (
        <div className="tip warn">
          <span className="small">{notes.join(" ")}</span>
        </div>
      )}

      {step === 1 && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Logo</b>
            <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
              {ad.assets.logo ? (
                <figure className="masset logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset(ad.assets.logo.id)} alt={`${ad.business} logo`} />
                  <figcaption>
                    <SharpBadge img={ad.assets.logo} logo /> {ad.assets.logo.from === "website" ? "from their website" : "uploaded"}
                  </figcaption>
                  <button type="button" className="masset-x" onClick={() => void removeAsset(ad.assets.logo!.id)} aria-label="Remove logo">
                    <X size={12} />
                  </button>
                </figure>
              ) : (
                <span className="faint small">None yet</span>
              )}
              <label className="btn sm">
                {busy === "upload-logo" ? <LoaderCircle size={14} className="spin" /> : <ImagePlus size={14} />} {ad.assets.logo ? "Replace logo" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => void upload("logo", e.target.files)} />
              </label>
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Photos ({ad.assets.photos.length}/8) · shots use them by number</b>
            <div className="massets">
              {ad.assets.photos.map((p, i) => (
                <figure key={p.id} className="masset">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset(p.id)} alt={`Photo ${i + 1}`} />
                  <figcaption>
                    <b>{i + 1}</b> <SharpBadge img={p} />
                  </figcaption>
                  <button type="button" className="masset-x" onClick={() => void removeAsset(p.id)} aria-label={`Remove photo ${i + 1}`}>
                    <X size={12} />
                  </button>
                </figure>
              ))}
              <label className="masset add">
                {busy === "upload-photo" ? <LoaderCircle size={18} className="spin" /> : <ImagePlus size={18} />}
                <span className="small">Add photos</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void upload("photo", e.target.files)} />
              </label>
            </div>
          </div>
          <div className="row wrap" style={{ gap: 14 }}>
            <label className="mcolor">
              <input type="color" value={colors.primary} onChange={(e) => setColor("primary", e.target.value)} aria-label="Brand colour" />
              <span className="small">Brand colour</span>
            </label>
            <label className="mcolor">
              <input type="color" value={colors.accent} onChange={(e) => setColor("accent", e.target.value)} aria-label="Accent colour" />
              <span className="small">Accent</span>
            </label>
          </div>
          {warnings.length > 0 && (
            <ul className="vfacts">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div>
            <button className="btn sm primary" onClick={() => setStep(2)}>
              Next: the storyboard
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mboard">
          <div className="stack" style={{ gap: 12, minWidth: 0 }}>
            <label className="field">
              <span>Concept</span>
              <textarea className="textarea" rows={2} value={concept} onChange={(e) => setConcept(e.target.value)} />
            </label>
            <ol className="mshots">
              {draft.map((s, i) => (
                <ShotCard
                  key={i}
                  shot={s}
                  index={i}
                  count={draft.length}
                  still={stills[i]}
                  photos={ad.assets.photos.length}
                  hasLogo={Boolean(ad.assets.logo)}
                  onEdit={(p) => edit(i, p)}
                  onMove={(dir) => move(i, dir)}
                  onDuplicate={() => setDraft((d) => [...d.slice(0, i + 1), { ...s }, ...d.slice(i + 1)])}
                  onRemove={() => setDraft((d) => d.filter((_, k) => k !== i))}
                />
              ))}
            </ol>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => setDraft((d) => [...d, { note: "The shape morphs into a pill.", seconds: 2.4, shape: "pill", fill: "accent", size: 0.5, headline: "New shot", camera: "still", accent: "none", sfx: ["whoosh", "hit"] }])}>
                <Plus size={14} /> Add a shot
              </button>
              {dirty && (
                <>
                  <button className="btn sm" onClick={() => void patch({ shots: draft, concept }, "save", "Saved.")} disabled={Boolean(busy)}>
                    {busy === "save" ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Save changes
                  </button>
                  <button className="btn sm ghost" onClick={() => (setDraft(ad.shots), setConcept(ad.concept))}>
                    Undo changes
                  </button>
                </>
              )}
            </div>
            <div className="msunken stack" style={{ gap: 8 }}>
              <b className="small">Ask {claude ? "Claude" : "for"} a change</b>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder={claude ? "Make shot 3 about the warranty, and end on the phone number" : "Needs ANTHROPIC_API_KEY; edit the shots by hand instead"}
                  disabled={!claude || Boolean(busy)}
                  onKeyDown={(e) => e.key === "Enter" && ask.trim() && void action({ action: "revise", ask }, "revise", "Storyboard changed.").then((r) => r && setAsk(""))}
                />
                <button className="btn sm" onClick={() => void action({ action: "revise", ask }, "revise", "Storyboard changed.").then((r) => r && setAsk(""))} disabled={!claude || !ask.trim() || Boolean(busy)}>
                  {busy === "revise" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Ask
                </button>
              </div>
              {dirty && claude && <span className="faint small">Save your changes first, or Claude works from the saved storyboard.</span>}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn primary" onClick={() => void approve()} disabled={Boolean(busy) || !draft.length}>
                {busy === "approve" ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Approve storyboard
              </button>
              <button
                className="btn sm ghost"
                onClick={() => confirm("Write the storyboard again from the brief and assets? Your edits will be replaced.") && void action({ action: "rewrite" }, "rewrite", "New storyboard written.")}
                disabled={Boolean(busy)}
              >
                {busy === "rewrite" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Start the storyboard again
              </button>
            </div>
          </div>
          <div className="mboard-preview">
            <MotionPlayer ad={ad} shots={draft} pictures={pictures} audio={audio} />
            <span className="faint small">Preview of the storyboard as it stands, edits included. Approve it to render the video.</span>
          </div>
        </div>
      )}

      {step === 3 && ad.status === "approved" && (
        <div className="mboard">
          <div className="stack" style={{ gap: 14, minWidth: 0 }}>
            <div className="stack" style={{ gap: 8 }}>
              <b className="small">Sound design</b>
              <label className="vopt">
                <input type="checkbox" className="check" checked={sound.sfx} onChange={(e) => void patch({ sound: { sfx: e.target.checked } }, "sound")} />
                <span>Effects made in code: a whoosh on every morph, soft hits as words land, pullbacks, a riser in and a ding out</span>
              </label>
              <label className="field">
                <span>Music</span>
                <select className="select" value={sound.bed} onChange={(e) => void patch({ sound: { bed: e.target.value } }, "sound")}>
                  <option value="pulse">Made in code: pulse (pad, bass, soft beat)</option>
                  <option value="pad">Made in code: pad only</option>
                  {ad.assets.music && <option value="track">Your track: {ad.assets.music.name}</option>}
                  <option value="none">No music</option>
                </select>
              </label>
              {sound.bed !== "none" && (
                <label className="field">
                  <span>Music volume</span>
                  <input type="range" min={0} max={1} step={0.05} defaultValue={sound.music} onChange={(e) => void patch({ sound: { music: Number(e.target.value) } }, "sound")} />
                </label>
              )}
              <div className="row wrap" style={{ gap: 6, alignItems: "center" }}>
                <label className="btn sm">
                  {busy === "upload-music" ? <LoaderCircle size={14} className="spin" /> : <Music size={14} />} {ad.assets.music ? "Replace track" : "Use your own track"}
                  <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" hidden onChange={(e) => void upload("music", e.target.files)} />
                </label>
                {ad.assets.music && (
                  <button className="btn sm ghost" onClick={() => void removeAsset(ad.assets.music!.id)}>
                    <X size={13} /> Remove track
                  </button>
                )}
              </div>
              <span className="faint small">
                Royalty-free music: Pixabay Music and the YouTube Audio Library are free. Long tracks are trimmed to the ad here before uploading.
              </span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <b className="small">Voiceover</b>
              {!elevenlabs ? (
                <span className="faint small">Add ELEVENLABS_API_KEY for narration.</span>
              ) : !voiceLines ? (
                <span className="faint small">No shot has a voiceover line. Add lines in the storyboard (Edit storyboard) to narrate it.</span>
              ) : (
                <>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <select className="select" style={{ maxWidth: 260 }} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="Voice">
                      {!voices.length && <option value="">Default voice</option>}
                      {voices.map((v) => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <button className="btn sm" onClick={() => void action({ action: "voice", voiceId }, "voice", "Narration recorded.")} disabled={Boolean(busy)}>
                      {busy === "voice" ? <LoaderCircle size={14} className="spin" /> : <Mic size={14} />} {ad.voiceover ? "Record again" : `Record ${voiceLines} line${voiceLines === 1 ? "" : "s"}`}
                    </button>
                    {ad.voiceover && (
                      <button className="btn sm ghost" onClick={() => void action({ action: "unvoice" }, "unvoice")}>
                        <X size={13} /> Remove
                      </button>
                    )}
                  </div>
                  {ad.voiceover && (
                    <label className="vopt">
                      <input type="checkbox" className="check" checked={sound.voice} onChange={(e) => void patch({ sound: { voice: e.target.checked } }, "sound")} />
                      <span>Use the narration (the music dips under each line)</span>
                    </label>
                  )}
                  <span className="faint small">One take for the whole ad, cut into each shot&apos;s line; shots stretch if a line needs longer.</span>
                </>
              )}
            </div>
            <div>
              <button className="btn sm ghost" onClick={() => void unapprove()} disabled={Boolean(busy)}>
                <Pencil size={13} /> Edit storyboard
              </button>
            </div>
          </div>
          <div className="mboard-preview">
            <MotionPlayer ad={ad} shots={ad.shots} pictures={pictures} audio={audio} allowRender />
          </div>
        </div>
      )}
      {step === 3 && ad.status !== "approved" && <div className="faint small">Approve the storyboard first.</div>}
    </section>
  );
}

function SharpBadge({ img, logo }: { img: { w?: number; h?: number }; logo?: boolean }) {
  const s = logo ? logoSharpness(img) : sharpness(img);
  if (s === "unknown") return null;
  return (
    <span className={`badge ${s === "4k" ? "good" : s === "hd" ? "warm" : "hot"}`} title={img.w && img.h ? `${img.w}×${img.h}` : undefined}>
      {s === "4k" ? "4K ready" : s === "hd" ? "HD" : "Low-res"}
    </span>
  );
}

function ShotCard(props: {
  shot: MotionShot;
  index: number;
  count: number;
  still?: string;
  photos: number;
  hasLogo: boolean;
  onEdit: (p: Partial<MotionShot>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { shot: s, index: i, count } = props;
  return (
    <li className="mshot">
      <div className="mshot-thumb">
        {props.still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.still} alt={`Shot ${i + 1}`} />
        ) : (
          <span className="faint small">…</span>
        )}
        <span className="mshot-n">{i + 1}</span>
      </div>
      <div className="mshot-meta">
        <span className="faint small">
          {s.seconds.toFixed(1)}s · {SHAPE_LABEL[s.shape]} · {s.fill === "photo" ? `Photo ${(s.photo ?? 0) + 1}` : FILL_LABEL[s.fill]} · {CAMERA_LABEL[s.camera]}
          {s.accent !== "none" ? ` · ${ACCENT_LABEL[s.accent]}` : ""}
        </span>
        <span className="row" style={{ gap: 0 }}>
          <button type="button" className="btn sm ghost icon" onClick={() => props.onMove(-1)} disabled={i === 0} aria-label="Move up">
            <ArrowUp size={13} />
          </button>
          <button type="button" className="btn sm ghost icon" onClick={() => props.onMove(1)} disabled={i === count - 1} aria-label="Move down">
            <ArrowDown size={13} />
          </button>
          <button type="button" className="btn sm ghost icon" onClick={props.onDuplicate} aria-label="Duplicate shot">
            <Copy size={13} />
          </button>
          <button type="button" className="btn sm ghost icon" onClick={props.onRemove} disabled={count <= 1} aria-label="Delete shot">
            <Trash size={13} />
          </button>
        </span>
      </div>
      <div className="mshot-body stack" style={{ gap: 6 }}>
        <input className="input mshot-head" value={s.headline} onChange={(e) => props.onEdit({ headline: e.target.value })} aria-label={`Shot ${i + 1} headline`} placeholder="Headline (6 words at most)" />
        <input className="input" value={s.sub ?? ""} onChange={(e) => props.onEdit({ sub: e.target.value || undefined })} aria-label={`Shot ${i + 1} line under the headline`} placeholder="Line under it (optional)" />
        <input className="input" value={s.voice ?? ""} onChange={(e) => props.onEdit({ voice: e.target.value || undefined })} aria-label={`Shot ${i + 1} voiceover`} placeholder="Voiceover line (optional)" />
        <div className="muted small mshot-note">{s.note}</div>
        <details>
          <summary className="small">Shape, camera, timing and sound</summary>
          <div className="mshot-grid">
            <label className="field">
              <span>Shape</span>
              <select className="select" value={s.shape} onChange={(e) => props.onEdit({ shape: e.target.value as MotionShot["shape"] })}>
                {SHAPES.map((x) => (
                  <option key={x} value={x}>
                    {SHAPE_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Fill</span>
              <select
                className="select"
                value={s.fill === "photo" ? `photo:${s.photo ?? 0}` : s.fill}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("photo:")) props.onEdit({ fill: "photo", photo: Number(v.slice(6)) });
                  else props.onEdit({ fill: v as MotionShot["fill"], photo: undefined });
                }}
              >
                {FILLS.filter((f) => f !== "photo" && (f !== "logo" || props.hasLogo)).map((f) => (
                  <option key={f} value={f}>
                    {FILL_LABEL[f]}
                  </option>
                ))}
                {Array.from({ length: props.photos }, (_, k) => (
                  <option key={k} value={`photo:${k}`}>
                    Photo {k + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Size</span>
              <input type="range" min={0.2} max={1} step={0.02} value={s.size} onChange={(e) => props.onEdit({ size: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Seconds</span>
              <input className="input" type="number" min={1.4} max={5} step={0.1} value={s.seconds} onChange={(e) => props.onEdit({ seconds: Number(e.target.value) || 2.4 })} />
            </label>
            <label className="field">
              <span>Camera</span>
              <select className="select" value={s.camera} onChange={(e) => props.onEdit({ camera: e.target.value as MotionShot["camera"] })}>
                {CAMERAS.map((x) => (
                  <option key={x} value={x}>
                    {CAMERA_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Accent</span>
              <select className="select" value={s.accent} onChange={(e) => props.onEdit({ accent: e.target.value as MotionShot["accent"] })}>
                {ACCENTS.map((x) => (
                  <option key={x} value={x}>
                    {ACCENT_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Stat (optional)</span>
              <input className="input" value={s.stat?.value ?? ""} onChange={(e) => props.onEdit({ stat: e.target.value ? { value: e.target.value, label: s.stat?.label ?? "" } : undefined })} placeholder="4.6★" />
            </label>
            <label className="field">
              <span>Stat label</span>
              <input className="input" value={s.stat?.label ?? ""} onChange={(e) => s.stat && props.onEdit({ stat: { value: s.stat.value, label: e.target.value } })} placeholder="Google rating" disabled={!s.stat} />
            </label>
          </div>
          <div className="row wrap" style={{ gap: 10, marginTop: 6 }}>
            {SFX.map((x) => (
              <label key={x} className="vopt">
                <input
                  type="checkbox"
                  className="check"
                  checked={s.sfx.includes(x)}
                  onChange={(e) => props.onEdit({ sfx: e.target.checked ? [...s.sfx, x] : s.sfx.filter((y) => y !== x) })}
                />
                <span className="small">{x}</span>
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 6 }}>
            <span>Direction</span>
            <textarea className="textarea" rows={2} value={s.note} onChange={(e) => props.onEdit({ note: e.target.value })} />
          </label>
        </details>
      </div>
    </li>
  );
}
