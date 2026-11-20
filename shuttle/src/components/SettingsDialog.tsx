import { useEffect, useRef, useState } from 'react';
import { requestPersistence, storageEstimate } from '../lib/db.ts';
import { bytes } from '../lib/format.ts';
import { Button, Field, Segmented, Toggle } from './ui.tsx';
import { useSettings } from './App.tsx';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  const [key, setKey] = useState(settings.anthropicKey);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    void storageEstimate().then(setUsage);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const close = () => {
    if (key.trim() !== settings.anthropicKey) update({ anthropicKey: key.trim() });
    onClose();
  };

  return (
    <dialog ref={ref} className="dialog dialog-narrow" onCancel={(e) => (e.preventDefault(), close())} aria-labelledby="settings-title">
      <div className="dialog-head">
        <h2 id="settings-title">Settings</h2>
        <Button icon="x" variant="ghost" aria-label="Close" onClick={close} />
      </div>
      <div className="dialog-body">
        <Field label="Appearance" htmlFor="theme">
          <Segmented
            id="theme"
            label="Appearance"
            value={settings.theme}
            onChange={(v) => update({ theme: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </Field>

        <Toggle
          id="noise"
          checked={settings.noiseSuppression}
          onChange={(v) => update({ noiseSuppression: v })}
          label="Noise suppression"
          hint="Cleans up fans and keyboard noise on the microphone."
        />

        <Field
          label="Anthropic API key"
          htmlFor="anthropic-key"
          hint="Optional. Used only for “Write title, summary and chapters”. It is stored in this browser and sent only to api.anthropic.com, with the transcript text."
        >
          <div className="key-row">
            <input
              id="anthropic-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onBlur={() => update({ anthropicKey: key.trim() })}
            />
            {settings.anthropicKey && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setKey('');
                  update({ anthropicKey: '' });
                }}
              >
                Remove
              </Button>
            )}
          </div>
        </Field>

        <div className="field">
          <div className="field-label">Storage</div>
          <p className="small">
            {usage ? `${bytes(usage.usage)} used of ${bytes(usage.quota)} this browser allows.` : 'Usage unknown.'}{' '}
            {persisted ? 'Recordings are protected from automatic cleanup.' : 'The browser may clear recordings if the disk gets full.'}
          </p>
          {!persisted && (
            <Button size="sm" variant="quiet" onClick={async () => setPersisted(await requestPersistence())}>
              Keep recordings safe from cleanup
            </Button>
          )}
        </div>

        <div className="field">
          <div className="field-label">Keyboard</div>
          <table className="keys">
            <tbody>
              <tr><td><kbd>P</kbd></td><td>Pause or resume while recording</td></tr>
              <tr><td><kbd>M</kbd></td><td>Add a chapter (recording and editing)</td></tr>
              <tr><td><kbd>Space</kbd> / <kbd>K</kbd></td><td>Play or pause in the editor</td></tr>
              <tr><td><kbd>J</kbd> <kbd>L</kbd></td><td>Back or forward 5 seconds</td></tr>
              <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Back or forward 1 second</td></tr>
              <tr><td><kbd>C</kbd> / <kbd>Delete</kbd></td><td>Cut the selection, or delete the selected region</td></tr>
              <tr><td><kbd>Z</kbd></td><td>Zoom into the selection</td></tr>
              <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>Z</kbd></td><td>Undo (add <kbd>Shift</kbd> to redo)</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </dialog>
  );
}
