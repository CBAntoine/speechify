import { useEffect, useMemo, useRef, useState } from 'react';
import type { Recording } from '../lib/types.ts';
import { exportVideo, type ExportResult } from '../lib/exporter.ts';
import { buildPlayerPage } from '../lib/playerPage.ts';
import { captionCues, chaptersToOutput, cuesToOutput, toSRT, toVTT, transcriptMarkdown, transcriptToOutput } from '../lib/captions.ts';
import { keptSegments, outputDuration } from '../lib/timeline.ts';
import { outputSize } from '../lib/layout.ts';
import { bytes, extFor, slug, span, timer } from '../lib/format.ts';
import { deliverFile, saveToPhone } from '../lib/files.ts';
import { isNativeApp } from '../lib/native.ts';
import { Button, Field, Notice, Progress, Segmented, Toggle } from './ui.tsx';
import { useSettings } from './App.tsx';

export function ExportDialog({ rec, media, onClose }: { rec: Recording; media: { main: Blob; cam?: Blob }; onClose: () => void }) {
  const { settings, update } = useSettings();
  const [format, setFormat] = useState<'mp4' | 'webm'>(settings.exportFormat);
  const [height, setHeight] = useState<number | null>(
    settings.exportHeight && settings.exportHeight < Math.min(rec.width, rec.height) ? settings.exportHeight : null,
  );
  const [burn, setBurn] = useState(rec.edits.captionsBurnIn);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const native = isNativeApp();
  const abort = useRef<AbortController | null>(null);
  const started = useRef(0);
  const [eta, setEta] = useState<string>('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  const segs = useMemo(() => keptSegments(rec.duration, rec.edits), [rec]);
  const outDur = outputDuration(segs);
  const cues = useMemo(() => cuesToOutput(captionCues(rec.transcript), segs), [rec.transcript, segs]);
  const chapters = useMemo(() => chaptersToOutput(rec.markers, segs), [rec.markers, segs]);
  const lines = useMemo(() => transcriptToOutput(rec.transcript, segs), [rec.transcript, segs]);
  const base = slug(rec.title);
  const shortSide = Math.min(rec.width, rec.height);
  const heights = [2160, 1440, 1080, 720].filter((h) => h < shortSide);
  const out = outputSize(rec.width, rec.height, height);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    return () => abort.current?.abort();
  }, []);

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    started.current = performance.now();
    update({ exportFormat: format, exportHeight: height });
    const ac = new AbortController();
    abort.current = ac;
    try {
      const r = await exportVideo(
        { ...rec, edits: { ...rec.edits, captionsBurnIn: burn } },
        media,
        { format, height, burnCaptions: burn && rec.transcript.length > 0 },
        (p) => {
          setProgress(p);
          const elapsed = (performance.now() - started.current) / 1000;
          if (p > 0.03) setEta(`${timer((elapsed / p) * (1 - p))} left`);
        },
        ac.signal,
      );
      setResult(r);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message || String(err));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const filename = (ext: string) => `${base}.${ext}`;

  // Downloads in a browser; the share sheet in the Android app.
  const give = async (blob: Blob, name: string) => {
    setShareNote(null);
    try {
      await deliverFile(blob, name);
    } catch (err) {
      setShareNote(`Could not hand over ${name}: ${(err as Error).message}`);
    }
  };

  const share = async () => {
    if (!result) return;
    if (native) return give(result.blob, filename(result.ext));
    const file = new File([result.blob], filename(result.ext), { type: result.blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: rec.title });
      } else setShareNote('This browser cannot share files directly. Download it and attach it instead.');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setShareNote('Sharing was blocked. Download the file instead.');
    }
  };

  const saveVideo = async () => {
    if (!result) return;
    setShareNote(null);
    setSaving(0);
    try {
      const folder = await saveToPhone(result.blob, filename(result.ext), setSaving);
      setShareNote(`Saved to ${folder}. It shows up in your gallery.`);
    } catch (err) {
      setShareNote(`Saving failed: ${(err as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  const makePage = async () => {
    if (!result) return;
    setPageBusy(true);
    try {
      const page = await buildPlayerPage({
        title: rec.title,
        createdAt: rec.createdAt,
        duration: outDur,
        video: result.blob,
        summary: rec.summary?.text,
        actionItems: rec.summary?.actionItems,
        chapters,
        transcript: lines,
        cues,
        cta: ctaUrl.trim() ? { label: ctaLabel.trim() || 'Learn more', url: ctaUrl.trim() } : undefined,
      });
      await give(page, filename('html'));
    } catch (err) {
      setError(`Could not build the player page: ${(err as Error).message}`);
    } finally {
      setPageBusy(false);
    }
  };

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  return (
    <dialog ref={dialogRef} className="dialog" onCancel={(e) => (e.preventDefault(), close())} aria-labelledby="export-title">
      <div className="dialog-head">
        <h2 id="export-title">Export</h2>
        <Button icon="x" variant="ghost" aria-label="Close" onClick={close} />
      </div>

      <div className="dialog-body">
        <section className="export-video">
          <div className="export-summary">
            <span className="mono">{timer(outDur)}</span>
            {outDur < rec.duration - 0.05 && <span className="muted"> · {span(rec.duration - outDur)} shorter than the recording</span>}
            <span className="muted"> · {out.width}×{out.height}</span>
          </div>
          <div className="rig-row">
            <Field label="Format" htmlFor="ex-format">
              <Segmented
                id="ex-format"
                label="Format"
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'mp4', label: 'MP4', title: 'Plays everywhere' },
                  { value: 'webm', label: 'WebM' },
                ]}
              />
            </Field>
            <Field label="Size" htmlFor="ex-size">
              <select id="ex-size" value={height ?? ''} onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Original ({shortSide}p)</option>
                {heights.map((h) => (
                  <option key={h} value={h}>
                    {h === 2160 ? '4K' : `${h}p`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Toggle
            id="ex-burn"
            checked={burn && rec.transcript.length > 0}
            disabled={!rec.transcript.length}
            onChange={setBurn}
            label="Burn in captions"
            hint={rec.transcript.length ? 'Captions become part of the picture, for players that hide subtitle files.' : 'This recording has no transcript.'}
          />
          {progress !== null ? (
            <div className="export-progress">
              <Progress value={progress} label="Export progress" />
              <div className="export-progress-row">
                <span className="mono">{Math.round(progress * 100)}%</span>
                <span className="muted">{eta}</span>
                <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : result ? (
            <div className="export-done">
              <Notice tone="ok">
                Ready: {filename(result.ext)} · {bytes(result.blob.size)}
                {result.note ? ` · ${result.note}` : ''}
              </Notice>
              <div className="panel-actions">
                {native ? (
                  <Button variant="primary" icon="download" onClick={saveVideo} disabled={saving !== null}>
                    {saving !== null ? `Saving… ${Math.round(saving * 100)}%` : 'Save to phone'}
                  </Button>
                ) : (
                  <Button variant="primary" icon="download" onClick={() => void give(result.blob, filename(result.ext))}>
                    Download video
                  </Button>
                )}
                {(native || 'share' in navigator) && (
                  <Button variant="quiet" icon="share" onClick={share}>
                    Share…
                  </Button>
                )}
                <Button variant="ghost" onClick={run}>
                  Export again
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="record" size="lg" icon="film" onClick={run}>
              Export video
            </Button>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </section>

        {shareNote && <p className="muted small" role="status">{shareNote}</p>}

        <section className="export-page">
          <h3>Player page</h3>
          <p className="muted small">
            One .html file with the video, chapters, a searchable transcript, captions{rec.summary ? ' and the summary' : ''}. Open it in any browser, attach it, or put it on any web host.
          </p>
          <div className="rig-row">
            <Field label="Button label (optional)" htmlFor="cta-label">
              <input id="cta-label" value={ctaLabel} placeholder="Book a demo" onChange={(e) => setCtaLabel(e.target.value)} />
            </Field>
            <Field label="Button link" htmlFor="cta-url">
              <input id="cta-url" type="url" value={ctaUrl} placeholder="https://" onChange={(e) => setCtaUrl(e.target.value)} />
            </Field>
          </div>
          <Button variant="quiet" icon="link" disabled={!result || pageBusy} onClick={makePage} title={!result ? 'Export the video first' : undefined}>
            {pageBusy ? 'Building…' : result ? (native ? 'Share player page' : 'Download player page') : 'Export the video first'}
          </Button>
          {result && result.blob.size > 150 * 1024 * 1024 && (
            <p className="muted small">This video is large ({bytes(result.blob.size)}); the page will be about a third bigger. A 720p export keeps it smaller.</p>
          )}
        </section>

        <section className="export-text">
          <h3>Text</h3>
          <div className="panel-actions">
            <Button size="sm" variant="ghost" icon="download" disabled={!cues.length} onClick={() => void give(new Blob([toVTT(cues)], { type: 'text/vtt' }), filename('vtt'))}>
              Captions .vtt
            </Button>
            <Button size="sm" variant="ghost" icon="download" disabled={!cues.length} onClick={() => void give(new Blob([toSRT(cues)], { type: 'application/x-subrip' }), filename('srt'))}>
              Captions .srt
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              disabled={!lines.length && !rec.summary}
              onClick={() =>
                void give(
                  new Blob(
                    [
                      transcriptMarkdown({
                        title: rec.title,
                        date: new Date(rec.createdAt),
                        duration: outDur,
                        summary: rec.summary?.text,
                        actionItems: rec.summary?.actionItems,
                        chapters,
                        lines,
                      }),
                    ],
                    { type: 'text/markdown' },
                  ),
                  filename('md'),
                )
              }
            >
              Notes and transcript .md
            </Button>
          </div>
          <h3>Original files</h3>
          <div className="panel-actions">
            <Button size="sm" variant="ghost" icon="download" onClick={() => void give(media.main, `${base}-${rec.mode === 'cam' ? 'camera' : 'screen'}.${extFor(media.main.type)}`)}>
              {rec.mode === 'cam' ? 'Camera' : 'Screen'} ({bytes(media.main.size)})
            </Button>
            {media.cam && (
              <Button size="sm" variant="ghost" icon="download" onClick={() => void give(media.cam!, `${base}-camera.${extFor(media.cam!.type)}`)}>
                Camera ({bytes(media.cam.size)})
              </Button>
            )}
          </div>
        </section>
      </div>
    </dialog>
  );
}
