import { useEffect, useMemo, useState } from 'react';
import type { Recording, RecoverySession } from '../lib/types.ts';
import { deleteRecording, deleteSession, getMedia, listRecordings, listSessions, patchRecording, storageEstimate } from '../lib/db.ts';
import { bytes, relativeDate, timer } from '../lib/format.ts';
import { keptSegments, outputDuration } from '../lib/timeline.ts';
import { Button, ConfirmButton, Icon, Notice, Spinner } from './ui.tsx';
import { navigate, useSettings } from './App.tsx';
import { Brand } from './Brand.tsx';
import { isNativeApp } from '../lib/native.ts';

function Thumb({ rec }: { rec: Recording }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rec.thumbnail) return;
    const u = URL.createObjectURL(rec.thumbnail);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [rec.thumbnail]);
  return url ? <img src={url} alt="" loading="lazy" /> : <div className="thumb-empty"><Icon name="film" size={28} /></div>;
}

export function Library() {
  const { openSettings } = useSettings();
  const [recs, setRecs] = useState<Recording[] | null>(null);
  const [sessions, setSessions] = useState<RecoverySession[]>([]);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [r, s, u] = await Promise.all([listRecordings(), listSessions(), storageEstimate()]);
      setRecs(r);
      setSessions(s);
      setUsage(u);
    } catch (err) {
      setRecs([]);
      setError(`Browser storage is not available here (${String(err)}). Recordings cannot be saved in this window.`);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Fill in thumbnails that never got made (for example when the app closed
  // right after a take was saved).
  const missingThumbs = (recs ?? []).filter((r) => !r.thumbnail).map((r) => r.id).join(',');
  useEffect(() => {
    if (!missingThumbs) return;
    let cancelled = false;
    (async () => {
      const { makeThumbnail } = await import('../lib/media.ts');
      for (const id of missingThumbs.split(',')) {
        if (cancelled) return;
        const r = (await listRecordings()).find((x) => x.id === id);
        const main = r && (await getMedia(id, 'main'));
        if (!r || !main) continue;
        const cam = r.mode === 'screen-cam' ? await getMedia(id, 'cam') : undefined;
        const thumb = await makeThumbnail(r, main, cam).catch(() => undefined);
        if (!thumb || cancelled) continue;
        await patchRecording(id, { thumbnail: thumb });
        setRecs((prev) => prev?.map((x) => (x.id === id ? { ...x, thumbnail: thumb } : x)) ?? prev);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missingThumbs]);

  const shown = useMemo(() => {
    if (!recs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return recs;
    return recs.filter((r) => r.title.toLowerCase().includes(q) || r.transcript.some((s) => s.text.toLowerCase().includes(q)));
  }, [recs, query]);

  const recover = async (s: RecoverySession) => {
    setBusy(s.id);
    try {
      const { recoverTake } = await import('../lib/takes.ts');
      const rec = await recoverTake(s);
      if (rec) navigate(`#/r/${rec.id}`);
      else await refresh();
    } catch (err) {
      setError(`Could not recover that recording: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <Button variant="ghost" icon="settings" aria-label="Settings" title="Settings" onClick={openSettings} />
          <Button variant="record" icon="record" aria-label="New recording" onClick={() => navigate('#/record')}>
            New recording
          </Button>
        </div>
      </header>

      <main className="library">
        {error && (
          <Notice tone="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}

        {sessions.map((s) => (
          <Notice key={s.id} tone="warn">
            <div className="recover">
              <div>
                <strong>A recording from {relativeDate(s.startedAt)} was interrupted.</strong>
                <span> About {timer(s.elapsed)} was backed up while you recorded.</span>
              </div>
              <div className="recover-actions">
                <Button variant="primary" size="sm" onClick={() => recover(s)} disabled={busy === s.id}>
                  {busy === s.id ? 'Recovering…' : 'Recover it'}
                </Button>
                <ConfirmButton
                  size="sm"
                  label="Discard"
                  confirmLabel="Discard for good"
                  onConfirm={async () => {
                    await deleteSession(s.id);
                    void refresh();
                  }}
                />
              </div>
            </div>
          </Notice>
        ))}

        {recs === null ? (
          <div className="library-loading">
            <Spinner label="Loading recordings" />
          </div>
        ) : recs.length === 0 ? (
          <EmptyLibrary />
        ) : (
          <>
            <div className="library-head">
              <h1>Recordings</h1>
              <div className="search">
                <Icon name="search" size={16} />
                <input
                  id="library-search"
                  type="search"
                  placeholder="Search titles and transcripts"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            {shown.length === 0 && <p className="muted">No recording mentions “{query}”.</p>}
            <ul className="grid-cards">
              {shown.map((r) => {
                const finalLen = outputDuration(keptSegments(r.duration, r.edits));
                return (
                  <li key={r.id} className="card-rec">
                    <a className="card-link" href={`#/r/${r.id}`} aria-label={`Open ${r.title}`}>
                      <div className="thumb">
                        <Thumb rec={r} />
                        <span className="badge-time">{timer(finalLen)}</span>
                        {r.recovered && <span className="badge-flag">Recovered</span>}
                      </div>
                      <div className="card-body">
                        <div className="card-title">{r.title}</div>
                        <div className="card-meta">
                          <span>{relativeDate(r.createdAt)}</span>
                          <span>·</span>
                          <span>{bytes(r.size)}</span>
                          {r.transcript.length > 0 && (
                            <>
                              <span>·</span>
                              <span>Transcript</span>
                            </>
                          )}
                        </div>
                      </div>
                    </a>
                    <div className="card-actions">
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        title="Delete recording"
                        confirmLabel="Delete"
                        onConfirm={async () => {
                          await deleteRecording(r.id);
                          void refresh();
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>

      <footer className="library-foot">
        <span>
          <Icon name="check" size={14} /> Recordings stay {isNativeApp() ? 'on this phone' : 'in this browser'}. Nothing is uploaded.
        </span>
        {usage && usage.quota > 0 && (
          <span className="mono">
            {bytes(usage.usage)} used of {bytes(usage.quota)} available
          </span>
        )}
      </footer>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <section className="empty">
      <div className="empty-leader" aria-hidden="true">
        <span>3</span>
      </div>
      <div className="empty-copy">
        <h1>Record it once. Send it in a minute.</h1>
        {isNativeApp() ? (
          <p>
            Shuttle records your phone’s screen, in any app, with your voice and an optional camera bubble. Trim it, cut the
            pauses, zoom in on what matters, and send it as an MP4 or a one-file player page. Everything stays on this phone.
          </p>
        ) : (
          <p>
            Shuttle records your screen and camera, writes a transcript while you talk, and lets you cut mistakes by
            striking out sentences. Pauses come out in one click. Everything happens in this browser.
          </p>
        )}
        <Button variant="record" size="lg" icon="record" onClick={() => navigate('#/record')}>
          Record your first video
        </Button>
        <ul className="empty-points">
          <li>
            <Icon name="camera" size={16} /> Move or resize the camera bubble after recording
          </li>
          <li>
            <Icon name="scissors" size={16} /> Edit by transcript, trim, cut and remove pauses
          </li>
          <li>
            <Icon name="zoom" size={16} /> Smooth zooms onto the part of the screen that matters
          </li>
          <li>
            <Icon name="link" size={16} /> Export MP4, captions, or a one-file player page with chapters
          </li>
        </ul>
      </div>
    </section>
  );
}
