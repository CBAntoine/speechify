import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings.ts';
import { isNativeApp, Native } from '../lib/native.ts';
import { Library } from './Library.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { Notice, Spinner } from './ui.tsx';

// The recorder and editor pull in the media toolkit; load them on demand.
const Recorder = lazy(() => import('./Recorder.tsx').then((m) => ({ default: m.Recorder })));
const PhoneRecorder = lazy(() => import('./PhoneRecorder.tsx').then((m) => ({ default: m.PhoneRecorder })));
const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })));

type Route = { name: 'library' } | { name: 'record' } | { name: 'record-camera' } | { name: 'edit'; id: string };

function parseHash(): Route {
  const h = window.location.hash;
  if (h.startsWith('#/r/')) return { name: 'edit', id: decodeURIComponent(h.slice(4)) };
  if (h === '#/record') return { name: 'record' };
  if (h === '#/record/camera') return { name: 'record-camera' };
  return { name: 'library' };
}

/**
 * Android app: brings finished phone recordings into the library. A take
 * stopped from the notification lands here when Shuttle is next in front, and
 * opens in the editor unless you are busy elsewhere.
 */
function usePhoneImports(lang: string, route: Route, onError: (m: string) => void) {
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    const run = async () => {
      try {
        const { importFinishedPhoneRecordings } = await import('../lib/takes.ts');
        const recs = await importFinishedPhoneRecordings(lang);
        const r = routeRef.current;
        if (alive && recs.length && (r.name === 'library' || r.name === 'record')) navigate(`#/r/${recs[recs.length - 1].id}`);
        else if (alive && r.name === 'library') {
          // Reopened while a take is still recording: show its controls.
          const st = await Native.getStatus();
          if (st.state !== 'idle') navigate('#/record');
        }
      } catch (err) {
        onError(`A phone recording could not be added to your library: ${(err as Error).message}`);
      }
    };
    void run();
    const onVisible = () => document.visibilityState === 'visible' && void run();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onVisible);
    const sub = Native.addListener('recordingFinished', (e) => {
      if (e.error && !e.recording) onError(e.error);
      else void run();
    });
    const resumed = Native.addListener('appResumed', () => void run());
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onVisible);
      void sub.then((h) => h.remove());
      void resumed.then((h) => h.remove());
    };
  }, [lang, onError]);
}

export function navigate(hash: string): void {
  if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else window.location.hash = hash;
}

interface SettingsCtx {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  openSettings: () => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function useSettings(): SettingsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSettings outside App');
  return c;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update, openSettings: () => setSettingsOpen(true) }), [settings, update]);
  const [appError, setAppError] = useState<string | null>(null);
  const onImportError = useCallback((m: string) => setAppError(m), []);
  usePhoneImports(settings.lang, route, onImportError);

  return (
    <Ctx.Provider value={value}>
      <Suspense
        fallback={
          <div className="page page-center">
            <Spinner label="Loading…" />
          </div>
        }
      >
        {route.name === 'library' && <Library />}
        {route.name === 'record' && (isNativeApp() ? <PhoneRecorder /> : <Recorder />)}
        {route.name === 'record-camera' && <Recorder cameraOnly />}
        {route.name === 'edit' && <Editor key={route.id} id={route.id} />}
      </Suspense>
      {appError && (
        <div className="app-toast">
          <Notice tone="error" onClose={() => setAppError(null)}>
            {appError}
          </Notice>
        </div>
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </Ctx.Provider>
  );
}
