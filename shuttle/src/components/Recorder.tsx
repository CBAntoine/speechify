import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CameraLayout, Mode, Segment } from '../lib/types.ts';
import { openCamera, openMic, openScreen, RecordingEngine, stopStream, type EngineState, type ScreenCapture } from '../lib/recorder.ts';
import { speechSupported, type TranscriberStatus } from '../lib/transcriber.ts';
import { openPip, pipSupported } from '../lib/pip.ts';
import { saveTake } from '../lib/takes.ts';
import { LANGUAGES, QUALITY_HEIGHT, type Quality } from '../lib/settings.ts';
import { bubbleRect } from '../lib/layout.ts';
import { clamp } from '../lib/timeline.ts';
import { timer } from '../lib/format.ts';
import { Button, ConfirmButton, Field, Icon, LevelMeter, Notice, Segmented, Spinner, Toggle } from './ui.tsx';
import { navigate, useSettings } from './App.tsx';
import { Brand } from './Brand.tsx';
import { PipControls } from './PipControls.tsx';
import { isNativeApp } from '../lib/native.ts';
import { Teleprompter } from './Teleprompter.tsx';

type Phase = 'setup' | 'countdown' | 'recording' | 'saving';

function useVideo(stream: MediaStream | null | undefined) {
  return useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== (stream ?? null)) {
        el.srcObject = stream ?? null;
        if (stream) el.play().catch(() => undefined);
      }
    },
    [stream],
  );
}

const readAspect = (set: (n: number) => void) => (e: SyntheticEvent<HTMLVideoElement>) => {
  const v = e.currentTarget;
  if (v.videoWidth && v.videoHeight) set(v.videoWidth / v.videoHeight);
};

function deviceLabel(d: MediaDeviceInfo, i: number, kind: string) {
  return d.label || `${kind} ${i + 1}`;
}

/** `cameraOnly`: the Android app's selfie recorder (phone browsers cannot capture the screen). */
export function Recorder({ cameraOnly = false }: { cameraOnly?: boolean }) {
  const { settings, update, openSettings } = useSettings();
  const [phase, setPhase] = useState<Phase>('setup');
  const [cam, setCam] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<ScreenCapture | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState('');
  const [captionStatus, setCaptionStatus] = useState<{ s: TranscriberStatus; d?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [markers, setMarkers] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const [reopen, setReopen] = useState(0);
  const [pipOpen, setPipOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(!!settings.notes);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [screenAspect, setScreenAspect] = useState<number | null>(null);
  const [camAspect, setCamAspect] = useState<number | null>(null);

  const engineRef = useRef<RecordingEngine | null>(null);
  const handedOff = useRef(false);
  const streamsRef = useRef<{ cam: MediaStream | null; mic: MediaStream | null; screen: MediaStream | null }>({ cam: null, mic: null, screen: null });
  const pipRef = useRef<{ win: Window; root: Root } | null>(null);
  const countdownTimer = useRef(0);
  const startedAt = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const mode: Mode = cameraOnly ? 'cam' : settings.mode;
  const needsCam = mode !== 'screen' && settings.cameraId !== 'none';
  const needsScreen = mode !== 'cam';
  const camHeight = mode === 'cam' ? Math.min(1080, QUALITY_HEIGHT[settings.quality]) : 720;

  streamsRef.current = { cam, mic, screen: screen?.stream ?? null };

  // ---------------------------------------------------------- devices

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setCams(list.filter((d) => d.kind === 'videoinput'));
      setMics(list.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* enumerate unavailable */
    }
  }, []);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (phase !== 'setup') return;
    if (!needsCam) {
      setCam((prev) => (stopStream(prev), null));
      return;
    }
    let cancelled = false;
    openCamera(settings.cameraId, camHeight)
      .then((s) => {
        if (cancelled) return stopStream(s);
        setCamError(null);
        setCam((prev) => (stopStream(prev), s));
        void refreshDevices();
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        setCam((prev) => (stopStream(prev), null));
        setCamError(
          err.name === 'NotAllowedError'
            ? 'Camera access is blocked. Allow it from the address bar, or record without the camera.'
            : err.name === 'NotFoundError' || err.name === 'OverconstrainedError'
              ? 'No camera found.'
              : `The camera could not start (${err.message}). Another app may be using it.`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [needsCam, settings.cameraId, camHeight, phase, reopen, refreshDevices]);

  useEffect(() => {
    if (phase !== 'setup') return;
    if (settings.micId === 'none') {
      setMic((prev) => (stopStream(prev), null));
      return;
    }
    let cancelled = false;
    openMic(settings.micId, settings.noiseSuppression)
      .then((s) => {
        if (cancelled) return stopStream(s);
        setMicError(null);
        setMic((prev) => (stopStream(prev), s));
        void refreshDevices();
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        setMic((prev) => (stopStream(prev), null));
        setMicError(
          err.name === 'NotAllowedError'
            ? 'Microphone access is blocked. Allow it from the address bar to record your voice.'
            : 'No microphone found.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [settings.micId, settings.noiseSuppression, phase, reopen, refreshDevices]);

  // Stop every preview when leaving the page without recording.
  useEffect(
    () => () => {
      window.clearInterval(countdownTimer.current);
      if (!handedOff.current) {
        stopStream(streamsRef.current.cam);
        stopStream(streamsRef.current.mic);
        stopStream(streamsRef.current.screen);
      }
      const engine = engineRef.current;
      if (engine && (engine.state === 'recording' || engine.state === 'paused')) void engine.cancel();
      closePip();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A mic level reader for the meter in setup (the engine has its own once recording).
  const setupLevel = useMemo(() => {
    const track = mic?.getAudioTracks()[0];
    if (!track) return () => 0;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const read = () => {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    };
    (read as unknown as { ctx: AudioContext }).ctx = ctx;
    return read;
  }, [mic]);
  useEffect(() => () => void (setupLevel as unknown as { ctx?: AudioContext }).ctx?.close().catch(() => undefined), [setupLevel]);

  // ---------------------------------------------------------- screen

  const chooseScreen = async () => {
    setError(null);
    try {
      const cap = await openScreen(settings.quality, settings.fps, settings.systemAudio);
      if (!cap) return;
      setScreen((prev) => (stopStream(prev?.stream), cap));
      cap.stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (!engineRef.current) setScreen((prev) => (prev?.stream === cap.stream ? null : prev));
      });
    } catch (err) {
      setError(`Screen sharing failed: ${(err as Error).message}`);
    }
  };

  // ---------------------------------------------------------- floating controls

  function closePip() {
    const p = pipRef.current;
    pipRef.current = null;
    if (p) {
      p.root.unmount();
      try {
        p.win.close();
      } catch {
        /* already closed */
      }
    }
    setPipOpen(false);
  }

  const popOut = async () => {
    if (pipRef.current || !pipSupported()) return;
    try {
      const win = await openPip(380, settings.notes.trim() ? 300 : 132);
      if (!win) return;
      const host = win.document.createElement('div');
      win.document.body.appendChild(host);
      const root = createRoot(host);
      pipRef.current = { win, root };
      win.addEventListener('pagehide', () => {
        if (pipRef.current?.win === win) {
          root.unmount();
          pipRef.current = null;
          setPipOpen(false);
        }
      });
      win.document.addEventListener('keydown', onKey);
      setPipOpen(true);
    } catch {
      /* the browser refused the window; controls stay in the tab */
    }
  };

  // ---------------------------------------------------------- recording

  const cameraLayout: CameraLayout = {
    visible: true,
    shape: settings.bubbleShape,
    size: settings.bubbleSize,
    x: dragPos?.x ?? settings.bubbleX,
    y: dragPos?.y ?? settings.bubbleY,
    mirror: settings.mirror,
  };

  const beginEngine = async () => {
    const engine = new RecordingEngine(
      {
        mode,
        screen: screen?.stream,
        camera: needsCam ? cam ?? undefined : undefined,
        mic: mic ?? undefined,
        fps: settings.fps,
        lang: settings.lang,
        captions: settings.captions && speechSupported(),
        camera_layout: cameraLayout,
      },
      {
        onState: setEngineState,
        onTranscript: (segs, int) => {
          setSegments([...segs]);
          setInterim(int);
        },
        onCaptionStatus: (s, d) => setCaptionStatus({ s, d }),
        onSourceEnded: () => void finish(),
        onStorageWarning: setWarning,
      },
    );
    engineRef.current = engine;
    handedOff.current = true;
    try {
      await engine.start();
      startedAt.current = Date.now();
      setPhase('recording');
    } catch (err) {
      engineRef.current = null;
      handedOff.current = false;
      setPhase('setup');
      closePip();
      setError((err as Error).message);
    }
  };

  const start = async () => {
    setError(null);
    if (needsScreen && !screen) return chooseScreen();
    if (mode === 'cam' && !cam) {
      setError('Camera-only mode needs a camera.');
      return;
    }
    if (settings.floatingControls) await popOut();
    if (!settings.countdown) return beginEngine();
    setCount(3);
    setPhase('countdown');
    let n = 3;
    countdownTimer.current = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(countdownTimer.current);
        void beginEngine();
      } else setCount(n);
    }, 1000);
  };

  const cancelCountdown = () => {
    window.clearInterval(countdownTimer.current);
    closePip();
    setPhase('setup');
  };

  const finish = async () => {
    const engine = engineRef.current;
    if (!engine || engine.state === 'stopping' || engine.state === 'stopped') return;
    setPhase('saving');
    closePip();
    try {
      const result = await engine.stop();
      const rec = await saveTake(result, { mode, fps: settings.fps, lang: settings.lang, camera: cameraLayout, startedAt: startedAt.current || Date.now() });
      navigate(`#/r/${rec.id}`);
    } catch (err) {
      setError(`Saving failed: ${(err as Error).message}. The take is backed up; reopen Shuttle to recover it.`);
      setPhase('setup');
    }
  };

  const discard = async () => {
    const engine = engineRef.current;
    engineRef.current = null;
    closePip();
    if (engine) await engine.cancel();
    handedOff.current = false;
    setScreen(null);
    setCam(null);
    setMic(null);
    setSegments([]);
    setInterim('');
    setMarkers(0);
    setElapsed(0);
    setEngineState('idle');
    setPhase('setup');
    setReopen((n) => n + 1);
  };

  const togglePause = () => {
    const e = engineRef.current;
    if (!e) return;
    if (e.state === 'recording') e.pause();
    else if (e.state === 'paused') e.resume();
  };

  const addMarker = () => {
    const e = engineRef.current;
    if (!e || (e.state !== 'recording' && e.state !== 'paused')) return;
    e.addMarker();
    setMarkers(e.markerList.length);
  };

  // Keyboard: P pauses, M drops a chapter marker (when Shuttle or its floating window has focus).
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (phase === 'countdown' && e.key === 'Escape') cancelCountdown();
    if (phase !== 'recording') return;
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === 'm' || e.key === 'M') addMarker();
  };
  const onKey = useCallback((e: KeyboardEvent) => keyHandler.current(e), []);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  // Timer and "can't hear you" check.
  useEffect(() => {
    if (phase !== 'recording') return;
    let quietSince = performance.now();
    const id = window.setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      setElapsed(e.elapsed());
      if (e.state === 'recording' && mic) {
        if (e.level() > 0.006) quietSince = performance.now();
        setQuiet(performance.now() - quietSince > 6000);
      } else quietSince = performance.now();
    }, 200);
    return () => window.clearInterval(id);
  }, [phase, mic]);

  const engineLevel = useCallback(() => engineRef.current?.level() ?? 0, []);

  // Render the floating window on every change.
  useEffect(() => {
    const p = pipRef.current;
    if (!p) return;
    p.root.render(
      <PipControls
        phase={phase}
        count={count}
        state={engineState}
        elapsed={elapsed}
        markers={markers}
        quiet={quiet}
        notes={settings.notes}
        interim={interim || segments[segments.length - 1]?.text || ''}
        readLevel={engineLevel}
        onPause={togglePause}
        onStop={() => void finish()}
        onMarker={addMarker}
        onCancelCountdown={cancelCountdown}
      />,
    );
  });

  // ---------------------------------------------------------- bubble drag

  const onBubbleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'setup') return;
    const stage = stageRef.current;
    if (!stage) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = stage.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      let y = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
      // Gentle snap to the corners.
      const snaps = [0.12, 0.88];
      for (const s of snaps) {
        if (Math.abs(x - s) < 0.04) x = s;
        if (Math.abs(y - s) < 0.05) y = s;
      }
      dragRef.current = { x, y };
      setDragPos({ x, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = dragRef.current;
      if (p) update({ bubbleX: p.x, bubbleY: p.y });
      dragRef.current = null;
      setDragPos(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------------------------------------------------------- render

  const screenRef = useVideo(screen?.stream);
  const camRef = useVideo(cam);
  const camMiniRef = useVideo(cam);
  // Shape the stage from the frames themselves; track settings can report the
  // requested size rather than the delivered one.
  const aspect = (mode === 'cam' ? camAspect : screenAspect) ?? 16 / 9;
  const stageW = 1000;
  const stageH = stageW / aspect;
  const br = bubbleRect(cameraLayout, stageW, stageH);
  const sysAudio = !!screen?.stream.getAudioTracks().length;
  const recording = phase === 'recording';
  const busy = phase !== 'setup';
  const capSupported = speechSupported();

  const primaryLabel = needsScreen && !screen ? 'Choose what to share' : 'Start recording';

  return (
    <div className="page page-recorder">
      <header className="topbar">
        <div className="topbar-left">
          <Button variant="ghost" icon="back" aria-label="Back" title="Back" disabled={recording || phase === 'saving'} onClick={() => navigate(cameraOnly && isNativeApp() ? '#/record' : '#/')} />
          <Brand />
        </div>
        <div className="topbar-actions">
          {recording && pipSupported() && !pipOpen && (
            <Button variant="ghost" icon="pip" onClick={popOut} title="Show controls in a window that stays on top">
              Pop out controls
            </Button>
          )}
          <Button variant="ghost" icon="settings" aria-label="Settings" title="Settings" onClick={openSettings} disabled={busy} />
        </div>
      </header>

      <main className="studio">
        <section className="studio-stage">
          {error && (
            <Notice tone="error" onClose={() => setError(null)}>
              {error}
            </Notice>
          )}
          {warning && (
            <Notice tone="warn" onClose={() => setWarning(null)}>
              {warning}
            </Notice>
          )}

          {!recording && phase !== 'saving' && (
            <div className="stage" ref={stageRef} style={{ aspectRatio: String(aspect) }}>
              {mode === 'cam' ? (
                cam ? (
                  <video ref={camRef} className="stage-video mirrored" muted playsInline onLoadedMetadata={readAspect(setCamAspect)} onResize={readAspect(setCamAspect)} />
                ) : (
                  <StageEmpty icon="camera" text={camError ?? 'Waiting for the camera…'} />
                )
              ) : screen ? (
                <video ref={screenRef} className="stage-video" muted playsInline onLoadedMetadata={readAspect(setScreenAspect)} onResize={readAspect(setScreenAspect)} />
              ) : (
                <StageEmpty
                  icon="monitor"
                  text="Pick a screen, window or tab. You will see it here before anything is recorded."
                  action={
                    <Button variant="primary" icon="monitor" onClick={chooseScreen}>
                      Choose what to share
                    </Button>
                  }
                />
              )}
              {mode === 'screen-cam' && cam && (
                <div
                  className={`bubble bubble-${cameraLayout.shape} ${phase === 'setup' ? 'is-draggable' : ''}`}
                  style={{
                    left: `${(br.x / stageW) * 100}%`,
                    top: `${(br.y / stageH) * 100}%`,
                    width: `${(br.w / stageW) * 100}%`,
                    height: `${(br.h / stageH) * 100}%`,
                    borderRadius: cameraLayout.shape === 'circle' ? '50%' : `${(br.radius / br.h) * 100}% / ${(br.radius / br.h) * 100}%`,
                  }}
                  onPointerDown={onBubbleDown}
                  title="Drag to place your camera"
                >
                  <video ref={camMiniRef} className={settings.mirror ? 'mirrored' : ''} muted playsInline />
                </div>
              )}
              {phase === 'countdown' && <Countdown count={count} onCancel={cancelCountdown} />}
            </div>
          )}

          {recording && (
            <div className="live">
              <div className="live-head">
                <span className={`tally ${engineState === 'paused' ? 'is-paused' : ''}`}>
                  <span className="tally-dot" />
                  {engineState === 'paused' ? 'Paused' : 'Rec'}
                </span>
                <span className="live-timer mono" aria-live="off">
                  {timer(elapsed)}
                </span>
                {mic && <LevelMeter read={engineLevel} active={engineState === 'recording'} />}
                {cam && mode !== 'cam' && (
                  <div className={`live-cam bubble-${settings.bubbleShape}`}>
                    <video ref={camMiniRef} className={settings.mirror ? 'mirrored' : ''} muted playsInline />
                  </div>
                )}
              </div>
              {quiet && (
                <Notice tone="warn">
                  Shuttle can't hear your microphone. Check that it isn't muted, or pick another one after you stop.
                </Notice>
              )}
              <div className="live-controls">
                <Button variant="quiet" size="lg" icon={engineState === 'paused' ? 'play' : 'pause'} onClick={togglePause}>
                  {engineState === 'paused' ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="quiet" size="lg" icon="flag" onClick={addMarker} title="Add a chapter marker (M)">
                  Chapter{markers ? ` · ${markers}` : ''}
                </Button>
                <Button variant="record" size="lg" icon="stop" onClick={() => void finish()}>
                  Finish
                </Button>
                <ConfirmButton size="lg" label="Discard" confirmLabel="Discard this take" onConfirm={() => void discard()} />
              </div>
              <p className="live-hint">
                Switch to what you're presenting; recording continues in the background.
                {pipSupported() ? ' The floating controls stay on top of every window.' : ''} Keys: <kbd>P</kbd> pause, <kbd>M</kbd> chapter.
              </p>
              <div className="live-transcript" aria-live="polite">
                <div className="panel-label">
                  <Icon name="captions" size={15} /> Live transcript
                  {captionStatus?.s === 'offline' && <span className="muted"> · waiting for network</span>}
                </div>
                {captionStatus && (captionStatus.s === 'blocked' || captionStatus.s === 'unavailable') ? (
                  <p className="muted">{captionStatus.d ?? 'Captions are not available in this browser.'}</p>
                ) : !settings.captions || !capSupported ? (
                  <p className="muted">Live captions are off for this take.</p>
                ) : segments.length === 0 && !interim ? (
                  <p className="muted">Start talking; your words appear here.</p>
                ) : (
                  <p>
                    {segments.slice(-4).map((s) => (
                      <span key={s.id}>{s.text} </span>
                    ))}
                    <span className="interim">{interim}</span>
                  </p>
                )}
              </div>
              {settings.notes.trim() && (
                <div className="live-notes">
                  <div className="panel-label">
                    <Icon name="notes" size={15} /> Your notes
                  </div>
                  <Teleprompter text={settings.notes} running={engineState === 'recording'} />
                </div>
              )}
            </div>
          )}

          {phase === 'saving' && (
            <div className="saving">
              <Spinner label="Saving your recording…" />
            </div>
          )}
        </section>

        <aside className={`studio-rig ${busy ? 'is-busy' : ''}`} aria-label="Recording setup">
{!cameraOnly && (
          <Field label="Record" htmlFor="mode">
            <Segmented<Mode>
              id="mode"
              label="What to record"
              value={mode}
              onChange={(v) => update({ mode: v })}
              options={[
                { value: 'screen-cam', label: <><Icon name="monitor" size={15} /> + <Icon name="camera" size={15} /></>, title: 'Screen and camera' },
                { value: 'screen', label: <><Icon name="monitor" size={15} /> Screen</>, title: 'Screen only' },
                { value: 'cam', label: <><Icon name="camera" size={15} /> Camera</>, title: 'Camera only' },
              ]}
            />
          </Field>
          )}

          {needsScreen && screen && (
            <div className="source-row">
              <Icon name="monitor" size={16} />
              <span className="source-name" title={screen.label}>
                {screen.surface === 'browser' ? `Tab: ${screen.label || 'shared tab'}` : screen.surface === 'window' ? `Window: ${screen.label || 'shared window'}` : 'Entire screen'}
              </span>
              <Button size="sm" variant="ghost" onClick={chooseScreen} disabled={busy}>
                Change
              </Button>
            </div>
          )}

          {mode !== 'screen' && (
            <Field label="Camera" htmlFor="camera" hint={camError ?? undefined}>
              <select id="camera" value={settings.cameraId} disabled={busy} onChange={(e) => update({ cameraId: e.target.value })}>
                <option value="">Default camera</option>
                {cams.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {deviceLabel(d, i, 'Camera')}
                  </option>
                ))}
                {mode === 'screen-cam' && <option value="none">No camera</option>}
              </select>
            </Field>
          )}

          <Field label="Microphone" htmlFor="mic" hint={micError ?? undefined}>
            <select id="mic" value={settings.micId} disabled={busy} onChange={(e) => update({ micId: e.target.value })}>
              <option value="">Default microphone</option>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {deviceLabel(d, i, 'Microphone')}
                </option>
              ))}
              <option value="none">No microphone</option>
            </select>
            {mic && phase === 'setup' && <LevelMeter read={setupLevel} />}
          </Field>

          {needsScreen && (
            <Toggle
              id="sys-audio"
              checked={settings.systemAudio}
              onChange={(v) => update({ systemAudio: v })}
              disabled={busy || !!screen}
              label="Computer audio"
              hint={screen ? (sysAudio ? 'Included with this share.' : 'Not shared. Tick “Share audio” in the picker to include it.') : 'Tab audio in Chrome; full system audio on Windows and ChromeOS.'}
            />
          )}

          {mode === 'screen-cam' && cam && (
            <Field label="Camera bubble" htmlFor="bubble-shape" hint="Drag the bubble on the preview. You can change all of this after recording.">
              <Segmented
                id="bubble-shape"
                label="Bubble shape"
                value={settings.bubbleShape}
                onChange={(v) => update({ bubbleShape: v })}
                options={[
                  { value: 'circle', label: 'Circle' },
                  { value: 'rounded', label: 'Square' },
                  { value: 'wide', label: 'Wide' },
                ]}
              />
              <input
                id="bubble-size"
                aria-label="Bubble size"
                type="range"
                min={0.16}
                max={0.5}
                step={0.01}
                value={settings.bubbleSize}
                onChange={(e) => update({ bubbleSize: Number(e.target.value) })}
              />
            </Field>
          )}

          <div className="rig-row">
            <Field label="Quality" htmlFor="quality">
              <select id="quality" value={settings.quality} disabled={busy || !!screen} onChange={(e) => update({ quality: e.target.value as Quality })}>
                <option value="720">720p</option>
                <option value="1080">1080p</option>
                <option value="1440">1440p</option>
                <option value="2160">4K</option>
              </select>
            </Field>
            <Field label="Frame rate" htmlFor="fps">
              <select id="fps" value={settings.fps} disabled={busy || !!screen} onChange={(e) => update({ fps: Number(e.target.value) as 30 | 60 })}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </Field>
          </div>

          <Toggle
            id="captions"
            checked={settings.captions && capSupported}
            disabled={busy || !capSupported}
            onChange={(v) => update({ captions: v })}
            label="Live transcript"
            hint={
              capSupported
                ? 'Powers captions, chapters and editing by text. Uses the browser’s speech service; Chrome sends the audio to Google to transcribe it.'
                : isNativeApp()
                  ? 'Not available in the Android app yet. Record in Chrome on a computer for live transcripts.'
                  : 'Not available in this browser. Chrome, Edge and Safari support it.'
            }
          />
          {settings.captions && capSupported && (
            <Field label="Spoken language" htmlFor="lang">
              <select id="lang" value={settings.lang} disabled={busy} onChange={(e) => update({ lang: e.target.value })}>
                {!LANGUAGES.some(([code]) => code === settings.lang) && <option value={settings.lang}>{settings.lang}</option>}
                {LANGUAGES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Toggle id="countdown" checked={settings.countdown} disabled={busy} onChange={(v) => update({ countdown: v })} label="3-second countdown" />
          {pipSupported() && (
            <Toggle
              id="floating"
              checked={settings.floatingControls}
              disabled={busy}
              onChange={(v) => update({ floatingControls: v })}
              label="Floating controls"
              hint="A small window with the timer, pause and finish that stays above other apps."
            />
          )}

          <div className="notes-block">
            <button type="button" className="disclosure" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
              <Icon name="notes" size={15} /> Speaker notes {settings.notes.trim() ? '· added' : ''}
            </button>
            {notesOpen && (
              <textarea
                id="notes"
                rows={5}
                disabled={recording}
                placeholder="Talking points or a script. Only you see them, in the floating controls; they are never recorded."
                value={settings.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            )}
          </div>

          <div className="rig-action">
            {phase === 'setup' && (
              <Button variant="record" size="lg" icon={needsScreen && !screen ? 'monitor' : 'record'} onClick={start} disabled={mode === 'cam' && !cam}>
                {primaryLabel}
              </Button>
            )}
            {phase === 'countdown' && (
              <Button variant="quiet" size="lg" onClick={cancelCountdown}>
                Cancel countdown
              </Button>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function StageEmpty({ icon, text, action }: { icon: 'monitor' | 'camera'; text: string; action?: ReactNode }) {
  return (
    <div className="stage-empty">
      <Icon name={icon} size={30} />
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Countdown({ count, onCancel }: { count: number; onCancel?: () => void }) {
  return (
    <div className="countdown" role="timer" aria-live="assertive">
      <div className="leader" key={count}>
        <span>{count}</span>
      </div>
      {onCancel && (
        <button type="button" className="countdown-cancel" onClick={onCancel}>
          Esc to cancel
        </button>
      )}
    </div>
  );
}
