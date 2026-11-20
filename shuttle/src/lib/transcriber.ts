// Live captions from the browser's speech recognition (Chrome, Edge, Safari).
// Phrases are stamped with the recording clock, which leaves out paused time,
// so they line up with the recorded file. Boundaries are refined against the
// audio after recording (timeline.refineSegments).

import type { Segment } from './types.ts';
import { uid } from './timeline.ts';

interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [i: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
type SRConstructor = new () => SpeechRecognitionLike;

function ctor(): SRConstructor | null {
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => typeof window !== 'undefined' && ctor() !== null;

/** Recognition reports a phrase about this long after it was spoken. */
const START_LATENCY = 0.7;
const END_LATENCY = 0.35;

export type TranscriberStatus = 'idle' | 'listening' | 'paused' | 'unavailable' | 'blocked' | 'offline';

export interface TranscriberEvents {
  onUpdate: (segments: Segment[], interim: string) => void;
  onStatus: (status: TranscriberStatus, detail?: string) => void;
}

export class Transcriber {
  private rec: SpeechRecognitionLike | null = null;
  private running = false;
  private paused = false;
  private generation = 0;
  private pendingStart = new Map<string, number>();
  private restartTimer = 0;
  private failures = 0;
  readonly segments: Segment[] = [];
  private interim = '';
  private lang: string;
  private clock: () => number;
  private events: TranscriberEvents;
  private track?: MediaStreamTrack;

  constructor(lang: string, clock: () => number, events: TranscriberEvents) {
    this.lang = lang;
    this.clock = clock;
    this.events = events;
  }

  start(track?: MediaStreamTrack): void {
    if (!speechSupported()) {
      this.events.onStatus('unavailable');
      return;
    }
    this.track = track;
    this.running = true;
    this.paused = false;
    this.launch();
  }

  pause(): void {
    if (!this.running) return;
    this.paused = true;
    this.flushInterim();
    this.teardown();
    this.events.onStatus('paused');
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.launch();
  }

  stop(): Segment[] {
    this.running = false;
    this.flushInterim();
    this.teardown();
    this.events.onStatus('idle');
    return this.segments;
  }

  private teardown() {
    clearTimeout(this.restartTimer);
    const r = this.rec;
    this.rec = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        /* already stopped */
      }
    }
  }

  private launch() {
    const C = ctor();
    if (!C) return;
    this.teardown();
    const gen = ++this.generation;
    const r = new C();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => this.handleResult(gen, e);
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.running = false;
        this.events.onStatus('blocked', 'The browser refused speech recognition, so this recording has no live transcript.');
      } else if (e.error === 'network') {
        this.events.onStatus('offline', 'Captions need a network connection in this browser. Recording continues.');
      } else if (e.error === 'language-not-supported') {
        this.running = false;
        this.events.onStatus('unavailable', `Captions are not available for ${this.lang} in this browser.`);
      }
    };
    r.onend = () => {
      if (!this.running || this.paused || gen !== this.generation) return;
      // Recognition ends on its own after long silences; start it again.
      this.flushInterim();
      this.failures++;
      const delay = Math.min(4000, 150 * this.failures);
      this.restartTimer = window.setTimeout(() => this.running && !this.paused && this.launch(), delay);
    };
    this.rec = r;
    try {
      // Newer Chrome can listen to a chosen microphone track; older builds only
      // take the default microphone and throw on the argument.
      if (this.track) r.start(this.track);
      else r.start();
    } catch {
      try {
        r.start();
      } catch (err) {
        this.events.onStatus('unavailable', String(err));
        return;
      }
    }
    this.events.onStatus('listening');
  }

  private handleResult(gen: number, e: SREvent) {
    if (gen !== this.generation) return;
    this.failures = 0;
    const now = this.clock();
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0]?.transcript ?? '';
      const key = `${gen}:${i}`;
      if (!this.pendingStart.has(key)) {
        const words = text.trim().split(/\s+/).length;
        this.pendingStart.set(key, now - Math.max(START_LATENCY, res.isFinal ? words * 0.32 : START_LATENCY));
      }
      if (res.isFinal) {
        this.push(this.pendingStart.get(key)!, now - END_LATENCY, text);
        this.pendingStart.delete(key);
      } else interim += text;
    }
    this.interim = interim.trim();
    this.events.onUpdate(this.segments, this.interim);
  }

  private flushInterim() {
    if (!this.interim) return;
    const starts = [...this.pendingStart.values()];
    const start = starts.length ? Math.min(...starts) : this.clock() - 1;
    this.push(start, this.clock(), this.interim);
    this.pendingStart.clear();
    this.interim = '';
    this.events.onUpdate(this.segments, '');
  }

  private push(start: number, end: number, raw: string) {
    const text = raw.trim();
    if (!text) return;
    const prev = this.segments[this.segments.length - 1];
    const s = Math.max(0, prev ? Math.max(start, prev.end) : start);
    const finalText = text.charAt(0).toUpperCase() + text.slice(1);
    this.segments.push({ id: uid('s'), start: s, end: Math.max(end, s + 0.3), text: finalText });
  }
}
