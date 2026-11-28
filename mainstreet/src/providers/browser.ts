// One shared headless Chromium for the crew: mockup screenshots, the video's
// graphics and anything else that needs a real browser. Launched on first
// use, closed after two idle minutes (or by closeBrowser()).
//
// Which browser: CHROMIUM_PATH (any Chromium/Chrome binary) → the Chromium
// Playwright downloads (`npx playwright install chromium`) → the system's
// Google Chrome.

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";

const IDLE_MS = 120_000;
const NEGATIVE_CACHE_MS = 60_000;

interface Shared {
  browser: Browser;
  how: string;
}

let shared: Shared | null = null;
let launching: Promise<Shared> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let active = 0;
let lastFailure: { at: number; error: string } | null = null;

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n").find((l) => l.trim())?.trim() ?? msg;
}

async function launch(): Promise<Shared> {
  const { chromium } = await import("playwright");
  const base: LaunchOptions = {
    headless: true,
    args: ["--disable-dev-shm-usage", "--font-render-hinting=none", "--hide-scrollbars", "--mute-audio"],
  };
  const attempts: { how: string; opts: LaunchOptions }[] = [];
  if (process.env.CHROMIUM_PATH) attempts.push({ how: `CHROMIUM_PATH (${process.env.CHROMIUM_PATH})`, opts: { ...base, executablePath: process.env.CHROMIUM_PATH } });
  attempts.push({ how: "Playwright Chromium", opts: base });
  attempts.push({ how: "Google Chrome", opts: { ...base, channel: "chrome" } });
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const browser = await chromium.launch(a.opts);
      return { browser, how: a.how };
    } catch (err) {
      errors.push(`${a.how}: ${firstLine(err)}`);
    }
  }
  throw new Error(
    `Couldn't start a headless browser. In the mainstreet folder run \`npx playwright install chromium\` (or install Google Chrome, or set CHROMIUM_PATH to a Chromium binary). Tried: ${errors.join(" | ")}`
  );
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (active > 0) {
      scheduleIdleClose();
      return;
    }
    void closeBrowser();
  }, IDLE_MS);
  idleTimer.unref?.();
}

async function sharedBrowser(): Promise<Shared> {
  if (shared?.browser.isConnected()) {
    scheduleIdleClose();
    return shared;
  }
  shared = null;
  launching ??= launch()
    .then((s) => {
      s.browser.on("disconnected", () => {
        if (shared?.browser === s.browser) shared = null;
      });
      shared = s;
      lastFailure = null;
      return s;
    })
    .finally(() => {
      launching = null;
    });
  const s = await launching;
  scheduleIdleClose();
  return s;
}

/** The shared browser. Prefer withPage(), which also keeps it from closing mid-use. */
export async function getBrowser(): Promise<Browser> {
  return (await sharedBrowser()).browser;
}

/** Whether a browser can start, and which one. A failure is remembered for a minute. */
export async function browserAvailable(): Promise<{ ok: boolean; how?: string; error?: string }> {
  if (shared?.browser.isConnected()) return { ok: true, how: shared.how };
  if (lastFailure && Date.now() - lastFailure.at < NEGATIVE_CACHE_MS) return { ok: false, error: lastFailure.error };
  try {
    const s = await sharedBrowser();
    return { ok: true, how: s.how };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    lastFailure = { at: Date.now(), error };
    return { ok: false, error };
  }
}

export interface PageOptions {
  width: number;
  height: number;
  /** deviceScaleFactor (default 1). */
  scale?: number;
}

/** Run fn with a fresh page (own context) on the shared browser; always cleaned up. */
export async function withPage<T>(opts: PageOptions, fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  active++;
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: Math.round(opts.width), height: Math.round(opts.height) },
      deviceScaleFactor: opts.scale ?? 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context?.close().catch(() => {});
    active--;
    scheduleIdleClose();
  }
}

/** Wait for web fonts and images, but never longer than timeoutMs. */
export async function settle(page: Page, timeoutMs = 8000): Promise<void> {
  await page
    .evaluate(async (ms: number) => {
      const imgs = Array.from(document.images);
      for (const img of imgs) if (img.loading === "lazy") img.loading = "eager";
      const pending = imgs
        .filter((img) => !img.complete)
        .map((img) => new Promise<void>((done) => {
          img.addEventListener("load", () => done(), { once: true });
          img.addEventListener("error", () => done(), { once: true });
        }));
      await Promise.race([Promise.all([document.fonts.ready, ...pending]), new Promise((r) => setTimeout(r, ms))]);
    }, timeoutMs)
    .catch(() => {});
}

function toUrl(fileOrUrl: string): string {
  if (/^(https?|file|data):/i.test(fileOrUrl)) return fileOrUrl;
  return pathToFileURL(path.resolve(fileOrUrl)).href;
}

export interface ScreenshotOptions {
  width: number;
  height: number;
  scale?: number;
  fullPage?: boolean;
  type?: "png" | "jpeg";
  quality?: number;
  /** CSS selectors to hide before the shot, e.g. [".ms-preview-bar"]. */
  hide?: string[];
  /** Page load timeout (default 30 s). */
  timeoutMs?: number;
  /** With fullPage: the tallest image to capture, in device pixels (default 15,000). Longer pages are clipped to their top. */
  maxDevicePx?: number;
}

/** Screenshot a local HTML file (absolute or relative path) or an http(s) URL. */
export async function screenshotFile(fileOrUrl: string, opts: ScreenshotOptions): Promise<Buffer> {
  const url = toUrl(fileOrUrl);
  return withPage({ width: opts.width, height: opts.height, scale: opts.scale }, async (page) => {
    await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs ?? 30_000 });
    if (opts.hide?.length) await page.addStyleTag({ content: `${opts.hide.join(",")}{display:none !important}` });
    if (opts.fullPage) {
      // Walk down the page so lazy images and scroll-triggered reveals fire, then back to the top.
      await page
        .evaluate(async () => {
          const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
          const total = document.documentElement.scrollHeight;
          for (let y = 0; y < total; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 40));
          }
          window.scrollTo(0, 0);
        })
        .catch(() => {});
    }
    await settle(page);
    const type = opts.type ?? "png";
    // Chromium can't capture images taller than ~16k device pixels (it crashes
    // the GPU process), so very long pages are clipped to their top part.
    let clip: { x: number; y: number; width: number; height: number } | undefined;
    if (opts.fullPage) {
      const total = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
      const cap = Math.floor((opts.maxDevicePx ?? 15_000) / (opts.scale ?? 1));
      if (total > cap) clip = { x: 0, y: 0, width: opts.width, height: cap };
    }
    return await page.screenshot({
      type,
      fullPage: Boolean(opts.fullPage),
      ...(clip ? { clip } : {}),
      animations: "disabled",
      ...(type === "jpeg" ? { quality: opts.quality ?? 82 } : {}),
    });
  });
}

/** Render an HTML snippet or document to a PNG (transparent background when asked). */
export async function renderHtmlToPng(html: string, opts: { width: number; height: number; transparent?: boolean }): Promise<Buffer> {
  return withPage({ width: opts.width, height: opts.height }, async (page) => {
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await settle(page);
    return await page.screenshot({
      type: "png",
      omitBackground: Boolean(opts.transparent),
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
      animations: "disabled",
    });
  });
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const s = shared;
  shared = null;
  if (launching) {
    const pending = await launching.catch(() => null);
    if (pending && pending !== s) await pending.browser.close().catch(() => {});
    shared = null;
  }
  if (s) await s.browser.close().catch(() => {});
}
