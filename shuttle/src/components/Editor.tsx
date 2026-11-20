import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Analysis, CameraLayout, Edits, Marker, Recording, Segment } from '../lib/types.ts';
import { getAnalysis, getMedia, getRecording, patchRecording, putAnalysis } from '../lib/db.ts';
import { computeEnvelope, ENVELOPE_RATE, makeThumbnail } from '../lib/media.ts';
import {
  clamp,
  cropFor,
  detectSilences,
  findSegmentAt,
  isSegmentCut,
  keptSegments,
  nextKept,
  outputDuration,
  refineSegments,
  sourceToOutputSnapped,
  transcriptCutId,
  uid,
  zoomAt,
  type Range,
} from '../lib/timeline.ts';
import { bubbleRect, captionFontPx } from '../lib/layout.ts';
import { captionCues, clock } from '../lib/captions.ts';
import { span, timecode } from '../lib/format.ts';
import { Button, Icon, Notice, Segmented, Spinner } from './ui.tsx';
import { navigate, useSettings } from './App.tsx';
import { Brand } from './Brand.tsx';
import { Timeline, type RegionRef } from './Timeline.tsx';
import { ChaptersPanel, LayoutPanel, NotesPanel, TranscriptPanel } from './EditorPanels.tsx';
import { ExportDialog } from './ExportDialog.tsx';

type Tab = 'transcript' | 'chapters' | 'layout' | 'notes';

function fixInfiniteDuration(v: HTMLVideoElement) {
  // MediaRecorder files carry no duration; seeking far ahead makes the browser find it.
  if (Number.isFinite(v.duration)) return;
  const restore = () => {
    if (!Number.isFinite(v.duration)) return;
    v.removeEventListener('durationchange', restore);
    v.currentTime = 0;
  };
  v.addEventListener('durationchange', restore);
  try {
    v.currentTime = 1e101;
  } catch {
    v.removeEventListener('durationchange', restore);
  }
}

function thumbKey(r: Recording) {
  return JSON.stringify([r.edits.camera, r.edits.trimStart, r.edits.zooms.length]);
}

export function Editor({ id }: { id: string }) {
  const { settings, openSettings } = useSettings();
  const [rec, setRecState] = useState<Recording | null>(null);
  const recRef = useRef<Recording | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [urls, setUrls] = useState<{ main: string; cam?: string } | null>(null);
  const media = useRef<{ main?: Blob; cam?: Blob }>({});
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [selected, setSelected] = useState<RegionRef | null>(null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [showCaptions, setShowCaptions] = useState(true);
  const [previewEdits, setPreviewEdits] = useState(true);
  const [minPause, setMinPause] = useState(0.8);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setHistoryTick] = useState(0);

  const mainRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoomLayerRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef(0);
  const pendingSave = useRef(false);
  const history = useRef<{ past: Edits[]; future: Edits[] }>({ past: [], future: [] });
  const initialThumb = useRef('');
  const aiAbort = useRef<AbortController | null>(null);

  // ------------------------------------------------------------ persistence

  const flush = useCallback(async () => {
    const r = recRef.current;
    if (!r || !pendingSave.current) return;
    pendingSave.current = false;
    try {
      await patchRecording(r.id, {
        title: r.title,
        edits: r.edits,
        transcript: r.transcript,
        transcriptRefined: r.transcriptRefined,
        markers: r.markers,
        summary: r.summary,
        updatedAt: Date.now(),
      });
      setSaveState(pendingSave.current ? 'saving' : 'saved');
    } catch {
      setSaveState('error');
    }
  }, []);

  const update = useCallback(
    (next: Recording, save = true) => {
      recRef.current = next;
      setRecState(next);
      if (save) {
        pendingSave.current = true;
        setSaveState('saving');
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void flush(), 450);
      }
    },
    [flush],
  );

  // ------------------------------------------------------------ load

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const made: string[] = [];
    (async () => {
      const r = await getRecording(id);
      if (!r) throw new Error('This recording no longer exists in this browser.');
      const main = await getMedia(id, 'main');
      const cam = r.mode === 'screen-cam' ? await getMedia(id, 'cam') : undefined;
      if (!main) throw new Error('The video file for this recording is missing from browser storage.');
      if (cancelled) return;
      media.current = { main, cam };
      const mainUrl = URL.createObjectURL(main);
      made.push(mainUrl);
      let camUrl: string | undefined;
      if (cam) {
        camUrl = URL.createObjectURL(cam);
        made.push(camUrl);
      }
      setUrls({ main: mainUrl, cam: camUrl });
      recRef.current = r;
      setRecState(r);
      initialThumb.current = thumbKey(r);

      let a = await getAnalysis(id);
      if (!a && r.hasAudio) {
        setAnalyzing(0);
        const env = await computeEnvelope(main, (p) => !cancelled && setAnalyzing(p), ac.signal).catch(() => null);
        if (env) {
          a = { id, envelope: env, rate: ENVELOPE_RATE };
          await putAnalysis(a).catch(() => undefined);
        }
        if (!cancelled) setAnalyzing(null);
      }
      if (cancelled || !a) return;
      setAnalysis(a);
      const cur = recRef.current!;
      if (!cur.transcriptRefined && cur.transcript.length) {
        update({ ...cur, transcript: refineSegments(cur.transcript, a.envelope, a.rate), transcriptRefined: true });
      }
    })().catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
      ac.abort();
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [id, update]);

  // Save on the way out, and refresh the library thumbnail if the look changed.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      void flush();
      aiAbort.current?.abort();
      const r = recRef.current;
      if (r && media.current.main && thumbKey(r) !== initialThumb.current) {
        makeThumbnail(r, media.current.main, media.current.cam)
          .then((thumb) => thumb && patchRecording(r.id, { thumbnail: thumb }))
          .catch(() => undefined);
      }
    },
    [flush],
  );

  // ------------------------------------------------------------ edits + history

  const commitEdits = useCallback(
    (next: Edits, pushHistory = true) => {
      const cur = recRef.current;
      if (!cur) return;
      if (pushHistory) {
        history.current.past.push(cur.edits);
        if (history.current.past.length > 200) history.current.past.shift();
        history.current.future = [];
        setHistoryTick((n) => n + 1);
      }
      update({ ...cur, edits: next });
    },
    [update],
  );

  const beginChange = useCallback(() => {
    const cur = recRef.current;
    if (!cur) return;
    history.current.past.push(cur.edits);
    history.current.future = [];
    setHistoryTick((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const cur = recRef.current;
    const prev = history.current.past.pop();
    if (!cur || !prev) return;
    history.current.future.push(cur.edits);
    setHistoryTick((n) => n + 1);
    update({ ...cur, edits: prev });
  }, [update]);

  const redo = useCallback(() => {
    const cur = recRef.current;
    const next = history.current.future.pop();
    if (!cur || !next) return;
    history.current.past.push(cur.edits);
    setHistoryTick((n) => n + 1);
    update({ ...cur, edits: next });
  }, [update]);

  // ------------------------------------------------------------ derived

  const duration = rec?.duration ?? 0;
  const segs = useMemo(() => (rec ? keptSegments(rec.duration, rec.edits) : []), [rec]);
  const outDur = outputDuration(segs);
  const cues = useMemo(() => (rec ? captionCues(rec.transcript) : []), [rec]);
  const silences = useMemo(
    () => (analysis ? detectSilences(analysis.envelope, analysis.rate, { minSilence: minPause, padding: 0.18 }) : []),
    [analysis, minPause],
  );
  const silenceCuts = rec?.edits.cuts.filter((c) => c.kind === 'silence') ?? [];
  const pauseSavings = useMemo(() => {
    if (!rec) return 0;
    const without = keptSegments(rec.duration, { ...rec.edits, cuts: rec.edits.cuts.filter((c) => c.kind !== 'silence') });
    const withSil = keptSegments(rec.duration, {
      ...rec.edits,
      cuts: [...rec.edits.cuts.filter((c) => c.kind !== 'silence'), ...silences.map(([a, b]) => ({ id: '', start: a, end: b, kind: 'silence' as const }))],
    });
    return outputDuration(without) - outputDuration(withSil);
  }, [rec, silences]);

  const getTime = useCallback(() => {
    const v = mainRef.current;
    const t = v ? v.currentTime : 0;
    return Number.isFinite(t) ? clamp(t, 0, recRef.current?.duration ?? t) : 0;
  }, []);

  // ------------------------------------------------------------ playback loop

  const selectedZoomLive = selected?.kind === 'zoom' ? rec?.edits.zooms.find((z) => z.id === selected.id) : undefined;
  const live = useRef({ segs, cues, previewEdits, showCaptions, edits: rec?.edits, focus: selectedZoomLive });
  live.current = { segs, cues, previewEdits, showCaptions, edits: rec?.edits, focus: selectedZoomLive };

  useEffect(() => {
    let raf = 0;
    let lastCaption = '';
    let lastTransform = '';
    const tick = () => {
      const v = mainRef.current;
      const L = live.current;
      if (v && L.edits && Number.isFinite(v.duration)) {
        let t = v.currentTime;
        if (!v.paused && L.previewEdits) {
          const nk = nextKept(t, L.segs);
          if (nk === null) {
            v.pause();
          } else if (nk - t > 0.03) {
            v.currentTime = nk;
            t = nk;
          }
        }
        // zoom
        const crop = L.previewEdits ? cropFor(zoomAt(t, L.edits.zooms)) : { x: 0, y: 0, w: 1, h: 1 };
        const transform = crop.w < 0.999 ? `scale(${1 / crop.w}) translate(${-crop.x * 100}%, ${-crop.y * 100}%)` : '';
        if (transform !== lastTransform && zoomLayerRef.current) {
          zoomLayerRef.current.style.transform = transform;
          lastTransform = transform;
        }
        // aim marker for the selected zoom, placed in the view as it looks now
        const fm = focusRef.current;
        if (fm && L.focus) {
          fm.style.left = `${((L.focus.x - crop.x) / crop.w) * 100}%`;
          fm.style.top = `${((L.focus.y - crop.y) / crop.h) * 100}%`;
        }
        // camera follows the screen
        const c = camRef.current;
        if (c && Number.isFinite(c.duration)) {
          if (Math.abs(c.currentTime - t) > (v.paused ? 0.04 : 0.2)) c.currentTime = t;
          if (v.paused && !c.paused) c.pause();
          if (!v.paused && c.paused) c.play().catch(() => undefined);
          if (c.playbackRate !== v.playbackRate) c.playbackRate = v.playbackRate;
        }
        // captions
        const idx = L.showCaptions ? findSegmentAt(L.cues, t) : -1;
        const text = idx >= 0 ? L.cues[idx].text : '';
        if (text !== lastCaption && captionRef.current) {
          captionRef.current.textContent = text;
          captionRef.current.hidden = !text;
          lastCaption = text;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Caption size follows the stage height.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => el.style.setProperty('--caption-size', `${captionFontPx(el.clientHeight)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [urls]);

  const seek = useCallback((t: number) => {
    const v = mainRef.current;
    if (!v) return;
    v.currentTime = clamp(t, 0, recRef.current?.duration ?? t);
    if (camRef.current) camRef.current.currentTime = v.currentTime;
  }, []);

  const togglePlay = useCallback(() => {
    const v = mainRef.current;
    if (!v) return;
    if (v.paused) {
      // Starting inside removed material jumps to the next kept moment.
      const nk = live.current.previewEdits ? nextKept(v.currentTime, live.current.segs) : v.currentTime;
      if (nk === null) v.currentTime = live.current.segs[0]?.[0] ?? 0;
      else if (nk !== v.currentTime) v.currentTime = nk;
      v.play().catch(() => undefined);
    } else v.pause();
  }, []);

  // ------------------------------------------------------------ actions

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 2200);
  };

  const cutSelection = useCallback(() => {
    const cur = recRef.current;
    if (!cur || !selection) return;
    const [a, b] = selection;
    if (b - a < 0.05) return;
    commitEdits({ ...cur.edits, cuts: [...cur.edits.cuts, { id: uid('cut'), start: a, end: b, kind: 'manual' }] });
    setSelection(null);
  }, [selection, commitEdits]);

  const keepOnly = useCallback(() => {
    const cur = recRef.current;
    if (!cur || !selection) return;
    commitEdits({ ...cur.edits, trimStart: selection[0], trimEnd: selection[1] >= cur.duration - 0.01 ? null : selection[1] });
    setSelection(null);
  }, [selection, commitEdits]);

  const zoomSelection = useCallback(() => {
    const cur = recRef.current;
    if (!cur) return;
    const t = getTime();
    const [a, b] = selection ?? [t, Math.min(cur.duration, t + 4)];
    if (b - a < 0.5) return;
    const z = { id: uid('zoom'), start: a, end: b, scale: 1.8, x: 0.5, y: 0.5 };
    const zooms = [...cur.edits.zooms.filter((zz) => zz.end <= a || zz.start >= b), z].sort((p, q) => p.start - q.start);
    commitEdits({ ...cur.edits, zooms });
    setSelection(null);
    setSelected({ kind: 'zoom', id: z.id });
    flash('Click the video to aim the zoom');
  }, [selection, commitEdits, getTime]);

  const deleteSelected = useCallback(() => {
    const cur = recRef.current;
    if (!cur || !selected) return;
    if (selected.kind === 'cut') commitEdits({ ...cur.edits, cuts: cur.edits.cuts.filter((c) => c.id !== selected.id) });
    else commitEdits({ ...cur.edits, zooms: cur.edits.zooms.filter((z) => z.id !== selected.id) });
    setSelected(null);
  }, [selected, commitEdits]);

  const addChapter = useCallback(() => {
    const cur = recRef.current;
    if (!cur) return;
    const t = getTime();
    const m: Marker = { id: uid('m'), t, title: `Chapter ${cur.markers.length + 1}` };
    update({ ...cur, markers: [...cur.markers, m].sort((a, b) => a.t - b.t) });
    setTab('chapters');
  }, [getTime, update]);

  const removePauses = () => {
    const cur = recRef.current;
    if (!cur) return;
    commitEdits({
      ...cur.edits,
      cuts: [...cur.edits.cuts.filter((c) => c.kind !== 'silence'), ...silences.map(([a, b]) => ({ id: uid('sil'), start: a, end: b, kind: 'silence' as const }))],
    });
    flash(`Removed ${silences.length} pause${silences.length === 1 ? '' : 's'}`);
  };

  const restorePauses = () => {
    const cur = recRef.current;
    if (!cur) return;
    commitEdits({ ...cur.edits, cuts: cur.edits.cuts.filter((c) => c.kind !== 'silence') });
  };

  const toggleSegmentCut = (seg: Segment) => {
    const cur = recRef.current;
    if (!cur) return;
    const cid = transcriptCutId(seg.id);
    if (cur.edits.cuts.some((c) => c.id === cid)) {
      commitEdits({ ...cur.edits, cuts: cur.edits.cuts.filter((c) => c.id !== cid) });
      return;
    }
    // Take the pause after the phrase with it, keeping a natural beat before the next one.
    const sorted = [...cur.transcript].sort((a, b) => a.start - b.start);
    const next = sorted.find((s) => s.start > seg.start + 0.01);
    const end = Math.min(cur.duration, next ? Math.max(seg.end, Math.min(next.start - 0.12, seg.end + 1)) : seg.end + 0.3);
    commitEdits({ ...cur.edits, cuts: [...cur.edits.cuts, { id: cid, start: Math.max(0, seg.start - 0.05), end, kind: 'transcript' }] });
  };

  const editSegmentText = (seg: Segment, text: string) => {
    const cur = recRef.current;
    if (!cur || text === seg.text) return;
    update({ ...cur, transcript: cur.transcript.map((s) => (s.id === seg.id ? { ...s, text } : s)) });
  };

  const setCamera = (c: CameraLayout, commit = true) => {
    const cur = recRef.current;
    if (!cur) return;
    commitEdits({ ...cur.edits, camera: c }, commit);
  };

  const generateNotes = async () => {
    const cur = recRef.current;
    if (!cur) return;
    const ac = new AbortController();
    aiAbort.current = ac;
    setAiBusy(true);
    setAiError(null);
    try {
      const kept = cur.transcript.filter((s) => !isSegmentCut(s, segs, cur.edits.cuts));
      const { writeNotes } = await import('../lib/ai.ts');
      const notes = await writeNotes(settings.anthropicKey, kept, ac.signal);
      const latest = recRef.current!;
      const markers: Marker[] = notes.chapters
        .filter((c) => Number.isFinite(c.start_seconds) && c.start_seconds >= 0 && c.start_seconds < latest.duration)
        .map((c) => ({ id: uid('m'), t: c.start_seconds, title: c.title.trim() }));
      update({
        ...latest,
        title: notes.title.trim() || latest.title,
        markers: markers.length ? markers : latest.markers,
        summary: { text: notes.summary.trim(), actionItems: notes.action_items.map((a) => a.trim()).filter(Boolean), generatedAt: Date.now() },
      });
      flash('Title, summary and chapters updated');
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiBusy(false);
      aiAbort.current = null;
    }
  };

  // ------------------------------------------------------------ keyboard

  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (exportOpen) return;
    const el = e.target as HTMLElement;
    if (el?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    // A focused button or tab handles Space and Enter itself.
    if ((e.key === ' ' || e.key === 'Enter') && el?.closest('button, a, [role="tab"]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'j':
        seek(getTime() - 5);
        break;
      case 'l':
        seek(getTime() + 5);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seek(getTime() - (e.shiftKey ? 5 : 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        seek(getTime() + (e.shiftKey ? 5 : 1));
        break;
      case 'm':
      case 'M':
        addChapter();
        break;
      case 'c':
      case 'C':
        cutSelection();
        break;
      case 'z':
      case 'Z':
        zoomSelection();
        break;
      case 'Delete':
      case 'Backspace':
        if (selection) cutSelection();
        else deleteSelected();
        break;
      case 'Escape':
        setSelection(null);
        setSelected(null);
        break;
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // ------------------------------------------------------------ stage interactions

  const selectedZoom = selected?.kind === 'zoom' ? rec?.edits.zooms.find((z) => z.id === selected.id) : undefined;
  const selectedCut = selected?.kind === 'cut' ? rec?.edits.cuts.find((c) => c.id === selected.id) : undefined;

  const onStageClick = (e: RMouseEvent<HTMLDivElement>) => {
    const cur = recRef.current;
    const stage = stageRef.current;
    if (!cur || !stage) return;
    if (selectedZoom) {
      const r = stage.getBoundingClientRect();
      const u = clamp((e.clientX - r.left) / r.width, 0, 1);
      const v = clamp((e.clientY - r.top) / r.height, 0, 1);
      // The preview may already be zoomed in; map the click back onto the full frame.
      const crop = previewEdits ? cropFor(zoomAt(getTime(), cur.edits.zooms)) : { x: 0, y: 0, w: 1, h: 1 };
      const x = crop.x + u * crop.w;
      const y = crop.y + v * crop.h;
      commitEdits({ ...cur.edits, zooms: cur.edits.zooms.map((z) => (z.id === selectedZoom.id ? { ...z, x, y } : z)) });
      const mid = (selectedZoom.start + selectedZoom.end) / 2;
      if (getTime() < selectedZoom.start || getTime() > selectedZoom.end) seek(mid);
      return;
    }
    togglePlay();
  };

  const onBubbleDown = (e: RPointerEvent<HTMLDivElement>) => {
    const cur = recRef.current;
    const stage = stageRef.current;
    if (!cur || !stage) return;
    e.stopPropagation();
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    let began = false;
    const move = (ev: PointerEvent) => {
      const c = recRef.current;
      if (!c) return;
      if (!began) {
        beginChange();
        began = true;
      }
      const x = clamp((ev.clientX - r.left) / r.width, 0, 1);
      const y = clamp((ev.clientY - r.top) / r.height, 0, 1);
      commitEdits({ ...c.edits, camera: { ...c.edits.camera, x, y } }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------ render

  if (loadError) {
    return (
      <div className="page">
        <header className="topbar">
          <div className="topbar-left">
            <Button variant="ghost" icon="back" aria-label="Back" onClick={() => navigate('#/')} />
            <Brand />
          </div>
        </header>
        <main className="library">
          <Notice tone="error">{loadError}</Notice>
          <Button variant="quiet" onClick={() => navigate('#/')}>
            Back to recordings
          </Button>
        </main>
      </div>
    );
  }

  if (!rec || !urls) {
    return (
      <div className="page page-center">
        <Spinner label="Opening recording…" />
      </div>
    );
  }

  const aspect = rec.width && rec.height ? rec.width / rec.height : 16 / 9;
  const showBubble = rec.mode === 'screen-cam' && !!urls.cam && rec.edits.camera.visible;
  const W = 1000;
  const H = W / aspect;
  const br = bubbleRect(rec.edits.camera, W, H);
  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;

  return (
    <div className="page page-editor">
      <header className="topbar">
        <div className="topbar-left">
          <Button variant="ghost" icon="back" aria-label="Back to recordings" title="Back to recordings" onClick={() => navigate('#/')} />
          <Brand compact />
          <input
            className="title-input"
            id="title"
            aria-label="Title"
            value={rec.title}
            onChange={(e) => update({ ...rec, title: e.target.value })}
            onBlur={(e) => !e.target.value.trim() && update({ ...rec, title: 'Untitled recording' })}
          />
          <span className={`save-state is-${saveState}`} aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}
          </span>
        </div>
        <div className="topbar-actions">
          <Button variant="ghost" icon="settings" aria-label="Settings" title="Settings" onClick={openSettings} />
          <Button variant="primary" icon="download" onClick={() => setExportOpen(true)}>
            Export
          </Button>
        </div>
      </header>

      <main className="editor">
        <section className="editor-main">
          {rec.recovered && (
            <Notice tone="info">This recording was recovered after an interruption. The last second or two may be missing.</Notice>
          )}
          <div className="stage-wrap">
            <div
              className={`stage ${selectedZoom ? 'is-aiming' : ''}`}
              ref={stageRef}
              style={{ aspectRatio: String(aspect), width: `min(100%, calc(var(--stage-max-h) * ${aspect}))` }}
              onClick={onStageClick}
            >
              <div className="zoom-layer" ref={zoomLayerRef}>
                <video
                  ref={mainRef}
                  className={`stage-video ${rec.mode === 'cam' && rec.edits.camera.mirror ? 'mirrored' : ''}`}
                  src={urls.main}
                  playsInline
                  preload="auto"
                  onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />
              </div>
              {urls.cam && (
                <div
                  className={`bubble bubble-${rec.edits.camera.shape} is-draggable`}
                  hidden={!showBubble}
                  style={{
                    left: `${(br.x / W) * 100}%`,
                    top: `${(br.y / H) * 100}%`,
                    width: `${(br.w / W) * 100}%`,
                    height: `${(br.h / H) * 100}%`,
                    borderRadius: rec.edits.camera.shape === 'circle' ? '50%' : `${(br.radius / br.h) * 100}% / ${(br.radius / br.h) * 100}%`,
                  }}
                  onPointerDown={onBubbleDown}
                  onClick={(e) => e.stopPropagation()}
                  title="Drag to move the camera"
                >
                  <video
                    ref={camRef}
                    className={rec.edits.camera.mirror ? 'mirrored' : ''}
                    src={urls.cam}
                    muted
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => fixInfiniteDuration(e.currentTarget)}
                  />
                </div>
              )}
              <div className="stage-caption" ref={captionRef} hidden />
              {selectedZoom && <div className="zoom-focus" ref={focusRef} style={{ left: `${selectedZoom.x * 100}%`, top: `${selectedZoom.y * 100}%` }} aria-hidden="true" />}
              {!playing && (
                <div className="stage-play" aria-hidden="true">
                  <Icon name="play" size={34} />
                </div>
              )}
            </div>
          </div>

          <div className="transport">
            <Button variant="quiet" icon={playing ? 'pause' : 'play'} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)" onClick={togglePlay} />
            <TimeReadout getTime={getTime} segs={segs} total={outDur} />
            <div className="transport-spacer" />
            <select id="rate" aria-label="Playback speed" value={rate} onChange={(e) => {
              const r = Number(e.target.value);
              setRate(r);
              if (mainRef.current) mainRef.current.playbackRate = r;
            }}>
              {[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
            <Button
              variant={showCaptions ? 'quiet' : 'ghost'}
              icon="captions"
              aria-pressed={showCaptions}
              aria-label="Show captions"
              title="Show captions"
              disabled={!rec.transcript.length}
              onClick={() => setShowCaptions((v) => !v)}
            />
            <Button
              variant={previewEdits ? 'quiet' : 'ghost'}
              icon={previewEdits ? 'eye' : 'eyeOff'}
              aria-pressed={previewEdits}
              title={previewEdits ? 'Playing the edited video. Click to play everything that was recorded.' : 'Playing everything. Click to preview the edit.'}
              onClick={() => setPreviewEdits((v) => !v)}
            >
              {previewEdits ? 'Edited' : 'Original'}
            </Button>
            <Button
              variant="ghost"
              icon="fullscreen"
              aria-label="Full screen"
              title="Full screen"
              onClick={() => stageRef.current?.requestFullscreen?.().catch(() => undefined)}
            />
          </div>

          <div className="edit-bar">
            <div className="edit-group">
              <Button variant="ghost" icon="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
              <Button variant="ghost" icon="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
            </div>
            {selection ? (
              <div className="edit-group edit-selection">
                <span className="mono small">
                  {timecode(selection[0])} – {timecode(selection[1])} · {(selection[1] - selection[0]).toFixed(1)} s
                </span>
                <Button size="sm" variant="quiet" icon="scissors" onClick={cutSelection} title="Cut (C)">
                  Cut
                </Button>
                <Button size="sm" variant="quiet" icon="zoom" onClick={zoomSelection} title="Zoom (Z)">
                  Zoom
                </Button>
                <Button size="sm" variant="ghost" onClick={keepOnly} title="Trim to the selection">
                  Keep only this
                </Button>
                <Button size="sm" variant="ghost" icon="x" aria-label="Clear selection" onClick={() => setSelection(null)} />
              </div>
            ) : selectedZoom ? (
              <div className="edit-group edit-selection">
                <span className="small">Zoom</span>
                <input
                  type="range"
                  min={1.2}
                  max={3}
                  step={0.1}
                  value={selectedZoom.scale}
                  aria-label="Zoom amount"
                  onPointerDown={beginChange}
                  onChange={(e) =>
                    commitEdits(
                      { ...rec.edits, zooms: rec.edits.zooms.map((z) => (z.id === selectedZoom.id ? { ...z, scale: Number(e.target.value) } : z)) },
                      false,
                    )
                  }
                />
                <span className="mono small">{selectedZoom.scale.toFixed(1)}×</span>
                <span className="muted small">Click the video to aim it.</span>
                <Button size="sm" variant="ghost" icon="trash" onClick={deleteSelected}>
                  Remove
                </Button>
              </div>
            ) : selectedCut ? (
              <div className="edit-group edit-selection">
                <span className="small">
                  {selectedCut.kind === 'silence' ? 'Pause' : selectedCut.kind === 'transcript' ? 'Removed phrase' : 'Cut'} · {(selectedCut.end - selectedCut.start).toFixed(1)} s
                </span>
                <Button size="sm" variant="quiet" icon="restart" onClick={deleteSelected}>
                  Restore
                </Button>
              </div>
            ) : (
              <div className="edit-group">
                <span className="muted small">Drag across the timeline to cut or zoom. Drag the white handles to trim.</span>
              </div>
            )}
            <div className="edit-group edit-pauses">
              {analysis && (
                <>
                  <Segmented
                    id="pause-len"
                    label="Shortest pause to remove"
                    value={minPause}
                    onChange={setMinPause}
                    options={[
                      { value: 0.5, label: '0.5 s', title: 'Remove pauses longer than half a second' },
                      { value: 0.8, label: '0.8 s', title: 'Remove pauses longer than 0.8 seconds' },
                      { value: 1.5, label: '1.5 s', title: 'Only remove long pauses' },
                    ]}
                  />
                  {silenceCuts.length ? (
                    <Button size="sm" variant="ghost" icon="restart" onClick={restorePauses}>
                      Restore {silenceCuts.length} pause{silenceCuts.length === 1 ? '' : 's'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="quiet" icon="wave" disabled={!silences.length} onClick={removePauses} title="Cut the silent stretches">
                      {silences.length ? `Remove ${silences.length} pause${silences.length === 1 ? '' : 's'} (−${span(pauseSavings)})` : 'No long pauses'}
                    </Button>
                  )}
                </>
              )}
              <Button size="sm" variant="ghost" icon="flag" onClick={addChapter} title="Add a chapter at the playhead (M)">
                Chapter
              </Button>
            </div>
          </div>

          <Timeline
            duration={duration}
            envelope={analysis?.envelope ?? null}
            rate={analysis?.rate ?? ENVELOPE_RATE}
            analyzing={analyzing}
            edits={rec.edits}
            markers={rec.markers}
            selection={selection}
            selected={selected}
            getTime={getTime}
            onSeek={seek}
            onSelection={setSelection}
            onSelectRegion={setSelected}
            onBeginChange={beginChange}
            onEdits={(e) => commitEdits(e, false)}
          />
          <div className="timeline-foot small">
            <span>
              Final length <strong className="mono">{clock(outDur)}</strong>
              {outDur < duration - 0.05 && <span className="muted"> · {span(duration - outDur)} removed</span>}
            </span>
            {toast && <span className="toast" role="status">{toast}</span>}
          </div>
        </section>

        <aside className="editor-side">
          <div className="tabs" role="tablist" aria-label="Editor panels">
            {(
              [
                ['transcript', 'Transcript'],
                ['chapters', `Chapters${rec.markers.length ? ` · ${rec.markers.length}` : ''}`],
                ['layout', rec.mode === 'screen-cam' ? 'Camera' : 'Video'],
                ['notes', 'AI notes'],
              ] as Array<[Tab, string]>
            ).map(([k, label]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel">
            {tab === 'transcript' && (
              <TranscriptPanel rec={rec} segs={segs} getTime={getTime} onSeek={seek} onToggleCut={toggleSegmentCut} onEditText={editSegmentText} />
            )}
            {tab === 'chapters' && (
              <ChaptersPanel
                rec={rec}
                segs={segs}
                onSeek={seek}
                onAdd={addChapter}
                onChange={(m) => update({ ...rec, markers: rec.markers.map((x) => (x.id === m.id ? m : x)) })}
                onRemove={(m) => update({ ...rec, markers: rec.markers.filter((x) => x.id !== m.id) })}
              />
            )}
            {tab === 'layout' && <LayoutPanel rec={rec} onChange={setCamera} onBegin={beginChange} />}
            {tab === 'notes' && (
              <NotesPanel
                rec={rec}
                hasKey={!!settings.anthropicKey}
                busy={aiBusy}
                error={aiError}
                onGenerate={generateNotes}
                onCancel={() => aiAbort.current?.abort()}
                onOpenSettings={openSettings}
                onSummaryChange={(text) => rec.summary && update({ ...rec, summary: { ...rec.summary, text } })}
              />
            )}
          </div>
        </aside>
      </main>

      {exportOpen && media.current.main && (
        <ExportDialog rec={rec} media={{ main: media.current.main, cam: media.current.cam }} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}

function TimeReadout({ getTime, segs, total }: { getTime: () => number; segs: Range[]; total: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const t = sourceToOutputSnapped(getTime(), segsRef.current);
      const s = clock(t);
      if (s !== last && ref.current) {
        ref.current.textContent = s;
        last = s;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime]);
  return (
    <span className="time-readout mono">
      <span ref={ref}>0:00</span> / {clock(total)}
    </span>
  );
}
