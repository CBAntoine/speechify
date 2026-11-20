// The Android app's flow at phone size, in headless Chromium. The native
// recorder is replaced by src/lib/nativeFake.ts (switched on through
// localStorage), which records a real video, so import, editing, export and
// "save to phone" all run for real. Native Android code is not exercised here.
//
//   npm run build && node tests/e2e/phone.mjs

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PORT = 5319;
const BASE = `http://localhost:${PORT}/`;

const log = (...a) => console.log('·', ...a);
let failures = 0;
function check(cond, msg) {
  if (cond) log('ok', msg);
  else {
    failures++;
    console.log('✗ FAIL', msg);
  }
}

const readRecordings = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('shuttle');
        req.onsuccess = () => {
          const g = req.result.transaction('recordings').objectStore('recordings').getAll();
          g.onsuccess = () =>
            resolve(g.result.map((r) => ({ id: r.id, mode: r.mode, duration: r.duration, trimStart: r.edits.trimStart, markers: r.markers.length, w: r.width, h: r.height })));
        };
      }),
  );

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors = [];

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
    permissions: ['camera', 'microphone'],
  });
  await ctx.addInitScript(() => localStorage.setItem('shuttle.fakeNative', '1'));
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  const shot = (name) => page.screenshot({ path: join(out, `phone-${name}.png`) });
  const fakeLog = () => page.evaluate(() => window.__shuttleFakeNative?.log ?? []);

  await page.goto(BASE);
  await page.getByText(/records your phone’s screen/).waitFor();
  await shot('01-library');
  check(await page.getByText('Recordings stay on this phone.').isVisible(), 'library speaks about the phone');

  await page.getByRole('button', { name: 'Record your first video' }).click();
  await page.getByRole('heading', { name: 'Record your phone’s screen' }).waitFor();
  await shot('02-setup');
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(noScroll, 'phone recorder has no sideways scroll');

  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.locator('.phone-timer').waitFor();
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(1000);
  check((await page.locator('.tally').textContent())?.includes('Paused'), 'pause shows the paused tally');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: /^Chapter/ }).click();
  await page.waitForTimeout(1800);
  await shot('03-live');
  check((await fakeLog()).some((e) => e.op === 'minimize'), 'Shuttle steps aside when recording starts');
  await page.getByRole('button', { name: 'Finish' }).click();

  await page.waitForURL(/#\/r\/rec/, { timeout: 20000 });
  await page.locator('.title-input').waitFor();
  const recs = await readRecordings(page);
  log('imported', JSON.stringify(recs));
  const r = recs[0];
  check(recs.length === 1 && r.mode === 'screen', 'the phone take is in the library as a screen recording');
  check(r.duration > 2.5 && r.duration < 5.5, `duration leaves out the pause (${r.duration.toFixed(2)} s)`);
  check(r.trimStart > 0.5 && r.trimStart < 1.5, `the moment before Shuttle stepped aside is trimmed (${r.trimStart.toFixed(2)} s)`);
  check(r.markers === 1, 'the chapter marker came along');
  check((await page.evaluate(() => window.__shuttleFakeNative.listFinished())).recordings.length === 0, "the phone's copy is cleaned up after import");
  await page.waitForTimeout(800);
  await shot('04-editor');
  const editorFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(editorFits, 'editor has no sideways scroll at phone width');

  // Export, then save to the gallery and share.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('dialog[open]').waitFor();
  await page.getByRole('button', { name: 'Export video' }).click();
  await page.getByText(/^Ready:/).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Save to phone' }).click();
  await page.getByText(/Saved to Movies\/Shuttle/).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Share…' }).click();
  await page.getByRole('button', { name: 'Share player page' }).click();
  await page.waitForTimeout(1500);
  await shot('05-export');
  const fl = await fakeLog();
  log('phone file actions', JSON.stringify(fl.filter((e) => e.op !== 'minimize')));
  check(fl.some((e) => e.op === 'gallery' && e.mime === 'video/mp4' && e.size > 10000), 'the exported MP4 reaches the gallery');
  check(fl.some((e) => e.op === 'share' && e.mime === 'video/mp4' && e.size > 10000), 'the exported MP4 opens the share sheet');
  check(fl.some((e) => e.op === 'share' && e.mime === 'text/html' && e.size > 10000), 'the player page opens the share sheet');
  await page.getByRole('button', { name: 'Close' }).click();

  // A take stopped from the notification while Shuttle is in the background.
  await page.getByRole('button', { name: 'Back to recordings' }).click();
  await page.locator('.card-rec').first().waitFor();
  await page.evaluate(async () => {
    const f = window.__shuttleFakeNative;
    await f.startScreenRecording();
    await new Promise((r) => setTimeout(r, 2500));
    await f.stopFromNotification();
  });
  try {
    await page.waitForURL((u) => /#\/r\/rec/.test(u.hash) && !u.hash.includes(r.id), { timeout: 20000 });
  } catch (err) {
    log('DIAG url', page.url(), 'recordings', JSON.stringify(await readRecordings(page)), 'finished', JSON.stringify(await page.evaluate(() => window.__shuttleFakeNative.listFinished())));
    log('DIAG console', JSON.stringify(consoleLines.slice(-15)));
    throw err;
  }
  check((await readRecordings(page)).length === 2, 'a take stopped from the notification is imported and opened');

  await page.getByRole('button', { name: 'Back to recordings' }).click();
  await page.locator('.card-rec').nth(1).waitFor();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.locator('.card-rec img').nth(1).waitFor({ timeout: 10000 }).catch(() => undefined);
  await shot('06-library');

  // The in-app camera recorder (selfie video), reached from the phone recorder.
  await page.getByRole('button', { name: 'New recording' }).click();
  await page.getByRole('button', { name: 'Record yourself with the camera instead' }).click();
  await page.locator('.stage-video').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  await shot('07-camera');
  check((await page.getByRole('radiogroup', { name: 'What to record' }).count()) === 0, 'the camera recorder hides the screen modes in the app');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'camera recorder has no sideways scroll');

  writeFileSync(join(out, 'phone-errors.txt'), errors.join('\n'));
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
} catch (err) {
  failures++;
  console.log('✗ FAIL', err);
  console.log(errors.join('\n'));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall phone checks passed');
process.exit(failures ? 1 : 0);
