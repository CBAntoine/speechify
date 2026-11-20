import { useCallback, useEffect, useRef, useState } from 'react';
import { Native, type NativeState, type NativeStatus } from '../lib/native.ts';
import { timer } from '../lib/format.ts';
import { Button, Icon, Notice, Segmented, Spinner, Toggle } from './ui.tsx';
import { navigate, useSettings } from './App.tsx';
import { Brand } from './Brand.tsx';

type Phase = 'setup' | 'starting' | 'live' | 'stopping';

/** Android app: records the phone's whole screen with the native recorder. */
export function PhoneRecorder() {
  const { settings, update, openSettings } = useSettings();
  const [status, setStatus] = useState<NativeStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const base = useRef<{ elapsedMs: number; at: number; state: NativeState }>({ elapsedMs: 0, at: 0, state: 'idle' });

  const apply = useCallback((s: { state: NativeState; elapsedMs: number }) => {
    base.current = { elapsedMs: s.elapsedMs, at: performance.now(), state: s.state };
    setPhase((p) => (s.state === 'idle' ? (p === 'live' ? 'setup' : p) : p === 'stopping' ? p : 'live'));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await Native.getStatus();
      setStatus(s);
      apply(s);
    } catch (err) {
      setError(`The recorder is not responding: ${(err as Error).message}`);
    }
  }, [apply]);

  // Status on open, on return to the app, and while visible.
  useEffect(() => {
    void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onVisible);
    const poll = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), 2000);
    const sub = Native.addListener('stateChange', (s) => {
      apply(s);
      setStatus((prev) => (prev ? { ...prev, state: s.state, elapsedMs: s.elapsedMs, markers: s.markers } : prev));
    });
    const resumed = Native.addListener('appResumed', () => void refresh());
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onVisible);
      window.clearInterval(poll);
      void sub.then((h) => h.remove());
      void resumed.then((h) => h.remove());
    };
  }, [refresh, apply]);

  // Smooth timer between status updates.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => {
      const b = base.current;
      setClock(b.elapsedMs + (b.state === 'recording' ? performance.now() - b.at : 0));
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const start = async () => {
    setError(null);
    setNote(null);
    setPhase('starting');
    try {
      const r = await Native.startScreenRecording({ mic: settings.phoneMic, camera: settings.phoneCamera, quality: settings.phoneQuality });
      if (settings.phoneMic && !r.mic) setNote('Recording without sound: Shuttle was not allowed to use the microphone.');
      else if (settings.phoneCamera && !r.camera) setNote('Recording without the camera bubble: it needs camera access and permission to draw over other apps.');
      base.current = { elapsedMs: 0, at: performance.now(), state: 'recording' };
      setPhase('live');
      void refresh();
      if (settings.phoneHideOnStart) window.setTimeout(() => void Native.minimize().catch(() => undefined), 350);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      setPhase('setup');
      if (e.code !== 'DENIED') setError(e.message ?? String(err));
    }
  };

  const finish = async () => {
    setPhase('stopping');
    try {
      const r = await Native.stop();
      if (r.error && !r.recording) {
        setError(r.error);
        setPhase('setup');
        return;
      }
      const { importFinishedPhoneRecordings } = await import('../lib/takes.ts');
      let recs = await importFinishedPhoneRecordings(settings.lang);
      const id = r.recording?.id;
      if (id && !recs.some((x) => x.id === id)) recs = recs.concat(await importFinishedPhoneRecordings(settings.lang));
      const target = id ?? recs[recs.length - 1]?.id;
      if (target) navigate(`#/r/${target}`);
      else navigate('#/');
    } catch (err) {
      setError(`Could not save the recording: ${(err as Error).message}`);
      setPhase('setup');
    }
  };

  const allowOverlay = async () => {
    try {
      const { granted } = await Native.requestOverlayPermission();
      if (!granted) setNote('Without “Display over other apps”, the camera bubble cannot appear while you record.');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const live = phase === 'live';
  const state = base.current.state;
  const paused = live && state === 'paused';
  const needsOverlay = settings.phoneCamera && status && !status.canDrawOverlays;

  return (
    <div className="page page-phone">
      <header className="topbar">
        <div className="topbar-left">
          <Button variant="ghost" icon="back" aria-label="Back to recordings" disabled={live || phase === 'stopping'} onClick={() => navigate('#/')} />
          <Brand />
        </div>
        <div className="topbar-actions">
          <Button variant="ghost" icon="settings" aria-label="Settings" onClick={openSettings} disabled={live} />
        </div>
      </header>

      <main className="phone-rec">
        {error && (
          <Notice tone="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}
        {note && (
          <Notice tone="warn" onClose={() => setNote(null)}>
            {note}
          </Notice>
        )}

        {live || phase === 'stopping' ? (
          <section className="phone-live" aria-live="polite">
            <span className={`tally ${paused ? 'is-paused' : ''}`}>
              <span className="tally-dot" />
              {paused ? 'Paused' : 'Rec'}
            </span>
            <div className="phone-timer mono">{timer(clock / 1000)}</div>
            <p className="muted">
              Shuttle is recording your whole screen, in any app. Stop from the notification, or come back here.
            </p>
            {phase === 'stopping' ? (
              <Spinner label="Saving your recording…" />
            ) : (
              <div className="phone-controls">
                <Button variant="quiet" size="lg" icon={paused ? 'play' : 'pause'} onClick={() => void (paused ? Native.resume() : Native.pause()).then(refresh)}>
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="quiet" size="lg" icon="flag" onClick={() => void Native.addMarker().then(refresh)}>
                  Chapter{status?.markers ? ` · ${status.markers}` : ''}
                </Button>
                <Button variant="record" size="lg" icon="stop" onClick={() => void finish()}>
                  Finish
                </Button>
                <Button variant="ghost" icon="monitor" onClick={() => void Native.minimize()}>
                  Go to home screen
                </Button>
              </div>
            )}
          </section>
        ) : (
          <>
            <section className="phone-hero">
              <div className="phone-hero-mark" aria-hidden="true">
                <Icon name="record" size={30} />
              </div>
              <h1>Record your phone’s screen</h1>
              <p>
                Everything on screen, in any app, with your voice. Android asks once each time whether Shuttle may capture the
                screen. Stop from the notification when you are done.
              </p>
            </section>

            <section className="phone-options" aria-label="Recording options">
              <Toggle id="phone-mic" checked={settings.phoneMic} onChange={(v) => update({ phoneMic: v })} label="Microphone" hint="Record your voice with the screen." />
              <Toggle
                id="phone-camera"
                checked={settings.phoneCamera}
                onChange={(v) => update({ phoneCamera: v })}
                label="Camera bubble"
                hint="A round front-camera bubble floats over your apps and is recorded with the screen. Drag it anywhere."
              />
              {needsOverlay && (
                <div className="phone-permission">
                  <p className="small">The bubble needs permission to display over other apps.</p>
                  <Button size="sm" variant="quiet" onClick={allowOverlay}>
                    Allow
                  </Button>
                </div>
              )}
              <div className="field">
                <div className="field-label">Quality</div>
                <Segmented
                  id="phone-quality"
                  label="Quality"
                  value={settings.phoneQuality}
                  onChange={(v) => update({ phoneQuality: v })}
                  options={[
                    { value: '720', label: 'Standard · 720p' },
                    { value: '1080', label: 'High · 1080p' },
                  ]}
                />
              </div>
              <Toggle
                id="phone-hide"
                checked={settings.phoneHideOnStart}
                onChange={(v) => update({ phoneHideOnStart: v })}
                label="Go to the home screen when recording starts"
                hint="The moment before Shuttle steps aside is trimmed off automatically."
              />
            </section>

            <div className="phone-start">
              <Button variant="record" size="lg" icon="record" onClick={start} disabled={phase === 'starting'}>
                {phase === 'starting' ? 'Waiting for Android…' : 'Start recording'}
              </Button>
              <Button variant="ghost" icon="camera" onClick={() => navigate('#/record/camera')}>
                Record yourself with the camera instead
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
