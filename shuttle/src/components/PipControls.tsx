import type { EngineState } from '../lib/recorder.ts';
import { timer } from '../lib/format.ts';
import { Button, LevelMeter } from './ui.tsx';
import { Teleprompter } from './Teleprompter.tsx';

/** Contents of the always-on-top window (Document Picture-in-Picture). */
export function PipControls(p: {
  phase: 'setup' | 'countdown' | 'recording' | 'saving';
  count: number;
  state: EngineState;
  elapsed: number;
  markers: number;
  quiet: boolean;
  notes: string;
  interim: string;
  readLevel: () => number;
  onPause: () => void;
  onStop: () => void;
  onMarker: () => void;
  onCancelCountdown: () => void;
}) {
  if (p.phase === 'countdown') {
    return (
      <div className="pip pip-countdown">
        <div className="pip-count mono">{p.count}</div>
        <div className="pip-count-text">Recording starts in {p.count}…</div>
        <Button size="sm" variant="ghost" onClick={p.onCancelCountdown}>
          Cancel
        </Button>
      </div>
    );
  }
  if (p.phase !== 'recording') {
    return (
      <div className="pip">
        <div className="pip-count-text">{p.phase === 'saving' ? 'Saving…' : 'Ready'}</div>
      </div>
    );
  }
  const paused = p.state === 'paused';
  return (
    <div className="pip">
      <div className="pip-bar">
        <span className={`tally ${paused ? 'is-paused' : ''}`}>
          <span className="tally-dot" />
          {paused ? 'Paused' : 'Rec'}
        </span>
        <span className="pip-timer mono">{timer(p.elapsed)}</span>
        <LevelMeter read={p.readLevel} active={!paused} />
        <div className="pip-buttons">
          <Button variant="quiet" icon={paused ? 'play' : 'pause'} aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume (P)' : 'Pause (P)'} onClick={p.onPause} />
          <Button variant="quiet" icon="flag" aria-label="Add chapter" title={`Add chapter (M)${p.markers ? ` · ${p.markers} so far` : ''}`} onClick={p.onMarker} />
          <Button variant="record" icon="stop" onClick={p.onStop}>
            Finish
          </Button>
        </div>
      </div>
      {p.quiet && <div className="pip-warn">Your microphone seems silent.</div>}
      {p.notes.trim() ? (
        <Teleprompter text={p.notes} running={!paused} compact />
      ) : p.interim ? (
        <div className="pip-caption">{p.interim}</div>
      ) : null}
    </div>
  );
}
