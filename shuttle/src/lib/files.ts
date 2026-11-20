// Getting files out of Shuttle. In a browser: a download. In the Android app,
// downloads do nothing, so files go to the share sheet or the phone's gallery.

import { downloadBlob } from './format.ts';
import { isNativeApp, Native, writeNativeFile } from './native.ts';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  html: 'text/html',
  vtt: 'text/vtt',
  srt: 'application/x-subrip',
  md: 'text/markdown',
};

function mimeFor(blob: Blob, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? (blob.type || 'application/octet-stream');
}

/** Download in a browser; open the share sheet in the app. */
export async function deliverFile(blob: Blob, filename: string): Promise<void> {
  if (!isNativeApp()) {
    downloadBlob(blob, filename);
    return;
  }
  const path = await writeNativeFile(blob, filename);
  await Native.shareFile({ path, mime: mimeFor(blob, filename), title: filename });
}

/** App only: saves a video to Movies/Shuttle, where the gallery shows it. */
export async function saveToPhone(blob: Blob, filename: string, onProgress?: (p: number) => void): Promise<string> {
  const path = await writeNativeFile(blob, filename, onProgress);
  const r = await Native.saveToGallery({ path, mime: mimeFor(blob, filename) });
  return r.folder;
}
