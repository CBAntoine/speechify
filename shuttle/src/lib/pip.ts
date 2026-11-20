// Floating always-on-top controls through the Document Picture-in-Picture API
// (Chrome and Edge 116+). The window stays above every app while you record.

interface DocumentPiP {
  requestWindow(opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  window: Window | null;
}

export function pipApi(): DocumentPiP | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture ?? null;
}

export const pipSupported = () => typeof window !== 'undefined' && pipApi() !== null;

/** Opens the floating window and copies the app's styles into it. Needs a click. */
export async function openPip(width: number, height: number): Promise<Window | null> {
  const api = pipApi();
  if (!api) return null;
  const win = await api.requestWindow({ width, height, disallowReturnToOpener: false });
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join('\n');
      const style = win.document.createElement('style');
      style.textContent = css;
      win.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = win.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        win.document.head.appendChild(link);
      }
    }
  }
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme) win.document.documentElement.setAttribute('data-theme', theme);
  win.document.body.classList.add('pip-body');
  win.document.title = 'Shuttle controls';
  return win;
}
