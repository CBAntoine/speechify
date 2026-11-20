// Preferences kept in localStorage. Every read and write tolerates storage
// being unavailable (private windows, blocked site data).

import type { BubbleShape, Mode } from './types.ts';

export type Quality = '720' | '1080' | '1440' | '2160';

export interface Settings {
  mode: Mode;
  cameraId: string;
  micId: string;
  systemAudio: boolean;
  quality: Quality;
  fps: 30 | 60;
  countdown: boolean;
  captions: boolean;
  lang: string;
  noiseSuppression: boolean;
  bubbleShape: BubbleShape;
  bubbleSize: number;
  bubbleX: number;
  bubbleY: number;
  mirror: boolean;
  notes: string;
  anthropicKey: string;
  exportFormat: 'mp4' | 'webm';
  exportHeight: number | null;
  theme: 'system' | 'dark' | 'light';
  floatingControls: boolean;
  /** Android app: phone screen recording options. */
  phoneMic: boolean;
  phoneCamera: boolean;
  phoneQuality: '720' | '1080';
  phoneHideOnStart: boolean;
}

export const DEFAULTS: Settings = {
  mode: 'screen-cam',
  cameraId: '',
  micId: '',
  systemAudio: true,
  quality: '1080',
  fps: 30,
  countdown: true,
  captions: true,
  lang: typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US',
  noiseSuppression: true,
  bubbleShape: 'circle',
  bubbleSize: 0.3,
  bubbleX: 0.86,
  bubbleY: 0.78,
  mirror: true,
  notes: '',
  anthropicKey: '',
  exportFormat: 'mp4',
  exportHeight: null,
  theme: 'system',
  floatingControls: true,
  phoneMic: true,
  phoneCamera: false,
  phoneQuality: '720',
  phoneHideOnStart: true,
};

const KEY = 'shuttle.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

export const QUALITY_HEIGHT: Record<Quality, number> = { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160 };

export const LANGUAGES: Array<[string, string]> = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'],
  ['pt-BR', 'Português (Brasil)'],
  ['nl-NL', 'Nederlands'],
  ['sv-SE', 'Svenska'],
  ['pl-PL', 'Polski'],
  ['tr-TR', 'Türkçe'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['zh-CN', '中文 (简体)'],
  ['hi-IN', 'हिन्दी'],
];
