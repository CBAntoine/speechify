import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings.ts';
import { Library } from './Library.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { Spinner } from './ui.tsx';

// The recorder and editor pull in the media toolkit; load them on demand.
const Recorder = lazy(() => import('./Recorder.tsx').then((m) => ({ default: m.Recorder })));
const Editor = lazy(() => import('./Editor.tsx').then((m) => ({ default: m.Editor })));

type Route = { name: 'library' } | { name: 'record' } | { name: 'edit'; id: string };

function parseHash(): Route {
  const h = window.location.hash;
  if (h.startsWith('#/r/')) return { name: 'edit', id: decodeURIComponent(h.slice(4)) };
  if (h === '#/record') return { name: 'record' };
  return { name: 'library' };
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
        {route.name === 'record' && <Recorder />}
        {route.name === 'edit' && <Editor key={route.id} id={route.id} />}
      </Suspense>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </Ctx.Provider>
  );
}
