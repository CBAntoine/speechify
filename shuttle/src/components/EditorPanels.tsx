import { useEffect, useMemo, useRef, useState } from 'react';
import type { CameraLayout, Marker, Recording, Segment } from '../lib/types.ts';
import { findSegmentAt, isSegmentCut, transcriptCutId, type Range } from '../lib/timeline.ts';
import { chaptersText, chaptersToOutput, clock } from '../lib/captions.ts';
import { speechSupported } from '../lib/transcriber.ts';
import { Button, Field, Icon, Notice, Segmented, Spinner, Toggle } from './ui.tsx';

// ------------------------------------------------------------------ transcript

export function TranscriptPanel({
  rec,
  segs,
  getTime,
  onSeek,
  onToggleCut,
  onEditText,
}: {
  rec: Recording;
  segs: Range[];
  getTime: () => number;
  onSeek: (t: number) => void;
  onToggleCut: (seg: Segment) => void;
  onEditText: (seg: Segment, text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const sorted = useMemo(() => [...rec.transcript].sort((a, b) => a.start - b.start), [rec.transcript]);
  const follow = useRef(true);
  const followTimer = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = -2;
    const tick = () => {
      const t = getTime();
      let idx = findSegmentAt(sorted, t);
      if (idx < 0) {
        // between phrases: highlight the one that just ended
        for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].start <= t) {
          idx = i;
          break;
        }
      }
      if (idx !== last) {
        last = idx;
        setActive(idx);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sorted, getTime]);

  useEffect(() => {
    if (!follow.current || query || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  if (!rec.transcript.length) {
    return (
      <div className="panel-empty">
        <Icon name="captions" size={22} />
        <p>
          {speechSupported()
            ? 'No words were transcribed in this recording. Turn on “Live transcript” before your next take to edit by text, get captions and chapters.'
            : 'Live transcripts need Chrome, Edge or Safari. Record in one of those to edit by text.'}
        </p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const removedCount = sorted.filter((s) => isSegmentCut(s, segs, rec.edits.cuts)).length;

  const seekWord = (seg: Segment, wordIdx: number, words: string[]) => {
    const total = words.reduce((n, w) => n + w.length + 1, 0);
    const before = words.slice(0, wordIdx).reduce((n, w) => n + w.length + 1, 0);
    onSeek(seg.start + ((seg.end - seg.start) * before) / Math.max(1, total));
  };

  return (
    <div className="transcript">
      <div className="search">
        <Icon name="search" size={16} />
        <input id="transcript-search" type="search" placeholder="Search the transcript" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <p className="panel-hint">
        Click a word to jump there. <Icon name="scissors" size={13} /> removes a phrase from the video; click it again to bring it back. Double-click text to fix a word.
        {removedCount > 0 && <strong> {removedCount} removed.</strong>}
      </p>
      <ol
        className="phrases"
        ref={listRef}
        onWheel={() => {
          // Reading ahead: stop following the playhead for a few seconds.
          follow.current = false;
          window.clearTimeout(followTimer.current);
          followTimer.current = window.setTimeout(() => (follow.current = true), 4000);
        }}
      >
        {sorted.map((s, i) => {
          if (q && !s.text.toLowerCase().includes(q)) return null;
          const cut = isSegmentCut(s, segs, rec.edits.cuts);
          const own = rec.edits.cuts.some((c) => c.id === transcriptCutId(s.id));
          const words = s.text.split(/\s+/).filter(Boolean);
          return (
            <li key={s.id} data-i={i} className={`phrase ${i === active ? 'is-active' : ''} ${cut ? 'is-cut' : ''}`}>
              <button type="button" className="phrase-time mono" onClick={() => onSeek(s.start)} aria-label={`Play from ${clock(s.start)}`}>
                {clock(s.start)}
              </button>
              {editing === s.id ? (
                <textarea
                  className="phrase-edit"
                  autoFocus
                  defaultValue={s.text}
                  rows={Math.max(2, Math.ceil(s.text.length / 38))}
                  onBlur={(e) => {
                    onEditText(s, e.target.value.trim() || s.text);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      (e.target as HTMLTextAreaElement).blur();
                    } else if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <p className="phrase-text" onDoubleClick={() => setEditing(s.id)}>
                  {words.map((w, wi) => {
                    const hit = q && w.toLowerCase().includes(q);
                    return (
                      <span key={wi} className={`word ${hit ? 'is-hit' : ''}`} onClick={() => seekWord(s, wi, words)}>
                        {w}{' '}
                      </span>
                    );
                  })}
                </p>
              )}
              <button
                type="button"
                className={`phrase-cut ${own ? 'is-on' : ''}`}
                onClick={() => onToggleCut(s)}
                disabled={cut && !own}
                title={own ? 'Bring this phrase back' : cut ? 'Removed by a cut on the timeline' : 'Remove this phrase from the video'}
                aria-label={own ? 'Restore phrase' : 'Remove phrase'}
              >
                <Icon name={own ? 'restart' : 'scissors'} size={15} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ chapters

export function ChaptersPanel({
  rec,
  segs,
  onSeek,
  onAdd,
  onChange,
  onRemove,
}: {
  rec: Recording;
  segs: Range[];
  onSeek: (t: number) => void;
  onAdd: () => void;
  onChange: (m: Marker) => void;
  onRemove: (m: Marker) => void;
}) {
  const [copied, setCopied] = useState(false);
  const sorted = [...rec.markers].sort((a, b) => a.t - b.t);
  const out = chaptersToOutput(rec.markers, segs);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chaptersText(out));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused */
    }
  };
  return (
    <div className="chapters">
      <div className="panel-actions">
        <Button icon="flag" variant="quiet" onClick={onAdd}>
          Add at playhead
        </Button>
        {out.length > 0 && (
          <Button icon={copied ? 'check' : 'link'} variant="ghost" onClick={copy} title="Copy as video-description timestamps">
            {copied ? 'Copied' : 'Copy timestamps'}
          </Button>
        )}
      </div>
      {sorted.length === 0 ? (
        <p className="panel-hint">
          Chapters let viewers jump to the part they need. Press <kbd>M</kbd> while recording or while editing to add one at the playhead.
        </p>
      ) : (
        <ol className="chapter-list">
          {sorted.map((m) => (
            <li key={m.id}>
              <button type="button" className="phrase-time mono" onClick={() => onSeek(m.t)}>
                {clock(m.t)}
              </button>
              <input
                aria-label="Chapter title"
                value={m.title}
                onChange={(e) => onChange({ ...m, title: e.target.value })}
                placeholder="Chapter title"
              />
              <Button icon="x" variant="ghost" size="sm" aria-label="Remove chapter" onClick={() => onRemove(m)} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ camera layout

const CORNERS: Array<{ label: string; x: number; y: number }> = [
  { label: 'Top left', x: 0.1, y: 0.15 },
  { label: 'Top right', x: 0.9, y: 0.15 },
  { label: 'Bottom left', x: 0.1, y: 0.85 },
  { label: 'Bottom right', x: 0.9, y: 0.85 },
];

export function LayoutPanel({ rec, onChange, onBegin }: { rec: Recording; onChange: (c: CameraLayout, commit?: boolean) => void; onBegin: () => void }) {
  const cam = rec.edits.camera;
  if (rec.mode !== 'screen-cam' || !rec.hasCamera) {
    return (
      <div className="layout-panel">
        {rec.mode === 'cam' ? (
          <Toggle id="mirror-main" checked={cam.mirror} onChange={(v) => onChange({ ...cam, mirror: v })} label="Mirror the video" hint="Flip left and right, like a selfie view." />
        ) : rec.hasCamera ? (
          <p className="panel-hint">The camera bubble was recorded as part of the screen, so it moves with the picture.</p>
        ) : (
          <p className="panel-hint">This recording has no camera track.</p>
        )}
      </div>
    );
  }
  return (
    <div className="layout-panel">
      <p className="panel-hint">The camera was recorded separately, so you can place it anywhere. Drag the bubble on the video, or pick a corner.</p>
      <Toggle id="cam-visible" checked={cam.visible} onChange={(v) => onChange({ ...cam, visible: v })} label="Show camera" />
      <Field label="Shape" htmlFor="cam-shape">
        <Segmented
          id="cam-shape"
          label="Bubble shape"
          value={cam.shape}
          onChange={(v) => onChange({ ...cam, shape: v })}
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'rounded', label: 'Square' },
            { value: 'wide', label: 'Wide' },
          ]}
        />
      </Field>
      <Field label="Size" htmlFor="cam-size">
        <input
          id="cam-size"
          type="range"
          min={0.14}
          max={0.6}
          step={0.01}
          value={cam.size}
          onPointerDown={onBegin}
          onKeyDown={onBegin}
          onChange={(e) => onChange({ ...cam, size: Number(e.target.value) }, false)}
        />
      </Field>
      <Field label="Position" htmlFor="corner-0">
        <div className="corner-grid">
          {CORNERS.map((c, i) => (
            <button
              key={c.label}
              id={`corner-${i}`}
              type="button"
              className={`corner ${Math.abs(cam.x - c.x) < 0.06 && Math.abs(cam.y - c.y) < 0.08 ? 'is-on' : ''}`}
              onClick={() => onChange({ ...cam, x: c.x, y: c.y })}
              aria-label={c.label}
              title={c.label}
            >
              <span style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }} />
            </button>
          ))}
        </div>
      </Field>
      <Toggle id="cam-mirror" checked={cam.mirror} onChange={(v) => onChange({ ...cam, mirror: v })} label="Mirror camera" />
    </div>
  );
}

// ------------------------------------------------------------------ AI notes

export function NotesPanel({
  rec,
  hasKey,
  busy,
  error,
  onGenerate,
  onCancel,
  onOpenSettings,
  onSummaryChange,
}: {
  rec: Recording;
  hasKey: boolean;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
  onSummaryChange: (text: string) => void;
}) {
  const hasTranscript = rec.transcript.some((s) => s.text.trim());
  return (
    <div className="notes-panel">
      <p className="panel-hint">
        Claude reads the transcript and writes a title, a summary, chapters and action items. Only the text is sent, with your own API key; the video stays here.
      </p>
      {!hasKey ? (
        <Button icon="settings" variant="quiet" onClick={onOpenSettings}>
          Add an Anthropic API key
        </Button>
      ) : busy ? (
        <div className="panel-actions">
          <Spinner label="Writing notes…" />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button icon="sparkles" variant="primary" onClick={onGenerate} disabled={!hasTranscript}>
          {rec.summary ? 'Write the notes again' : 'Write title, summary and chapters'}
        </Button>
      )}
      {!hasTranscript && <p className="muted small">This recording has no transcript to work from.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {rec.summary && (
        <>
          <Field label="Summary" htmlFor="summary">
            <textarea id="summary" rows={8} value={rec.summary.text} onChange={(e) => onSummaryChange(e.target.value)} />
          </Field>
          {rec.summary.actionItems.length > 0 && (
            <div className="field">
              <div className="field-label">Action items</div>
              <ul className="actions-list">
                {rec.summary.actionItems.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

