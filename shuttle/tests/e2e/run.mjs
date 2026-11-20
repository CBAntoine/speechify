// End-to-end check in headless Chromium with fake camera, microphone and
// screen. Records a take, edits it, exports it, verifies the file with
// ffprobe, then simulates a crashed tab and recovers the take.
//
//   npm run build && npm run e2e
//
// Needs Playwright's Chromium and ffmpeg/ffprobe on PATH.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PORT = 5317;
const BASE = `http://localhost:${PORT}/`;
const shots = process.env.SHOTS !== '0';

const log = (...a) => console.log('·', ...a);
let failures = 0;
function check(cond, msg) {
  if (cond) log('ok', msg);
  else {
    failures++;
    console.log('✗ FAIL', msg);
  }
}

// Speech-like audio: 2.2 s of modulated noise, 1.4 s of silence, repeated.
const wav = join(out, 'speech.wav');
if (!existsSync(wav)) {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=36:c=pink:a=0.35:r=48000',
    '-af', "volume=eval=frame:volume='if(lt(mod(t\\,3.6)\\,2.2)\\,0.6+0.4*sin(2*PI*4*t)\\,0)'",
    '-ac', '1', '-c:a', 'pcm_s16le', wav,
  ]);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    '--auto-accept-this-tab-capture',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const errors = [];
async function newPage(ctx, colorScheme = 'dark') {
  const page = await ctx.newPage();
  await page.emulateMedia({ colorScheme });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/speech|recognition|favicon|net::ERR/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return page;
}
const shot = async (page, name) => shots && page.screenshot({ path: join(out, `${name}.png`) });
let current = null;

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['camera', 'microphone'] });
  const page = await newPage(ctx);
  current = page;

  // ---------------------------------------------------------------- library
  await page.goto(BASE);
  await page.getByRole('heading', { name: /Record it once/ }).waitFor();
  await shot(page, '01-library-empty');
  check(true, 'empty library renders');

  // ---------------------------------------------------------------- record
  await page.getByRole('button', { name: 'Record your first video' }).click();
  await page.locator('.bubble video').waitFor({ timeout: 10000 }).catch(() => undefined);
  // The fake shared screen plays a steady tone; leave it out so pauses stay silent.
  await page.getByRole('switch', { name: /Computer audio/ }).uncheck({ force: true });
  await page.getByRole('button', { name: 'Choose what to share' }).first().click();
  await page.locator('.stage-video').waitFor();
  await page.waitForTimeout(800);
  await shot(page, '02-recorder-ready');
  check(await page.locator('.bubble').count() === 1, 'camera bubble is shown over the screen preview');

  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.locator('.countdown').waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  await shot(page, '03-countdown');
  await page.locator('.tally').waitFor({ timeout: 6000 });
  await page.waitForTimeout(2500);
  const pip = await page.evaluate(() => {
    const w = window.documentPictureInPicture?.window;
    return w ? { timer: w.document.querySelector('.pip-timer')?.textContent ?? null, buttons: w.document.querySelectorAll('button').length } : null;
  });
  log('floating controls', JSON.stringify(pip));
  check(!pip || (pip.timer && pip.buttons >= 3), 'floating controls window shows the timer and buttons when the browser supports it');
  await page.keyboard.press('m');
  await page.waitForTimeout(2000);
  await shot(page, '04-recording');
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(1200);
  check((await page.locator('.tally').textContent())?.includes('Paused'), 'pause shows the paused tally');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForTimeout(5500);
  await page.getByRole('button', { name: 'Finish' }).click();

  // ---------------------------------------------------------------- editor
  await page.waitForURL(/#\/r\//, { timeout: 20000 });
  await page.locator('.title-input').waitFor();
  const recId = decodeURIComponent(page.url().split('#/r/')[1]);
  log('recording id', recId);
  await page.getByRole('button', { name: /Remove \d+ pauses?|No long pauses/ }).waitFor({ timeout: 20000 });
  const meta = await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('shuttle');
        req.onsuccess = () => {
          const g = req.result.transaction('recordings').objectStore('recordings').get(id);
          g.onsuccess = () => resolve({ duration: g.result.duration, markers: g.result.markers.length, mode: g.result.mode, w: g.result.width, h: g.result.height, size: g.result.size });
          g.onerror = () => reject(g.error);
        };
      }),
    recId,
  );
  log('saved recording', JSON.stringify(meta));
  check(meta.duration > 8 && meta.duration < 13, `duration excludes the pause (${meta.duration.toFixed(2)} s)`);
  check(meta.markers === 1, 'chapter marker from the M key was saved');
  check(meta.mode === 'screen-cam', 'screen and camera recorded as separate tracks');

  // Give it a transcript, as live captions would, then reload.
  await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open('shuttle');
        req.onsuccess = () => {
          const tx = req.result.transaction('recordings', 'readwrite');
          const s = tx.objectStore('recordings');
          const g = s.get(id);
          g.onsuccess = () => {
            const r = g.result;
            const lines = [
              'Here is the dashboard we shipped on Monday.',
              'The new filter bar sits at the top of the page.',
              'Um, wait, let me start that again.',
              'Pick a date range and the chart updates instantly.',
            ];
            r.transcript = lines.map((text, i) => ({ id: `t${i}`, start: i * 3.6 + 0.3, end: i * 3.6 + 2.4, text }));
            r.transcriptRefined = false;
            s.put(r);
          };
          tx.oncomplete = () => resolve();
        };
      }),
    recId,
  );
  await page.reload();
  await page.locator('.phrase').first().waitFor();
  check((await page.locator('.phrase').count()) === 4, 'transcript phrases are listed');

  // Strike the false start.
  const phrase = page.locator('.phrase').nth(2);
  await phrase.hover();
  await phrase.locator('.phrase-cut').click();
  check(await phrase.evaluate((el) => el.classList.contains('is-cut')), 'striking a phrase removes it');

  // Remove pauses.
  const pausesBtn = page.getByRole('button', { name: /Remove \d+ pauses?/ });
  const hasPauses = (await pausesBtn.count()) > 0;
  check(hasPauses, 'pauses were detected in the audio');
  if (hasPauses) {
    log(await pausesBtn.textContent());
    await pausesBtn.click();
    await page.getByRole('button', { name: /Restore \d+ pauses?/ }).waitFor();
  }

  // Drag a range on the timeline and zoom into it, then aim at the top-left.
  const tl = page.locator('.timeline canvas');
  const box = await tl.boundingBox();
  await page.mouse.move(box.x + box.width * 0.15, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zoom', exact: true }).click();
  const stage = page.locator('.stage');
  const sb = await stage.boundingBox();
  await page.mouse.click(sb.x + sb.width * 0.25, sb.y + sb.height * 0.3);
  await page.waitForTimeout(300);

  // Move the camera bubble to the top-left from the Camera tab.
  await page.getByRole('tab', { name: 'Camera' }).click();
  await page.getByRole('button', { name: 'Top left' }).click();
  await page.waitForTimeout(400);
  await shot(page, '05-editor');

  // AI notes, against a stand-in for the Anthropic API.
  let aiRequest = null;
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    aiRequest = { headers: await req.allHeaders(), body: JSON.parse(req.postData() || '{}') };
    const notes = JSON.stringify({
      title: 'Dashboard filters walkthrough',
      summary: 'A quick tour of the dashboard shipped on Monday.\n\nThe new filter bar sits at the top of the page.',
      chapters: [{ start_seconds: 0.3, title: 'The new dashboard' }, { start_seconds: 3.9, title: 'Filter bar' }],
      action_items: ['Share the dashboard with the team'],
    });
    const ev = (name, data) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const body =
      ev('message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } }) +
      ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: notes.slice(0, 60) } }) +
      ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: notes.slice(60) } }) +
      ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 90 } }) +
      ev('message_stop', { type: 'message_stop' });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#anthropic-key').fill('sk-ant-test-key');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'AI notes' }).click();
  await page.getByRole('button', { name: 'Write title, summary and chapters' }).click();
  await page.locator('#summary').waitFor({ timeout: 15000 });
  check((await page.locator('.title-input').inputValue()) === 'Dashboard filters walkthrough', 'AI notes set the title');
  check(aiRequest?.body.model === 'claude-opus-5-5' && aiRequest?.body.fallbacks === 'default' && aiRequest?.body.output_config?.format?.type === 'json_schema', 'AI request asks for structured notes with refusal fallback');
  check((aiRequest?.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01') && aiRequest?.headers['authorization'] === 'Bearer sk-ant-test-key', 'AI request carries the beta header and the saved key');
  check(!JSON.stringify(aiRequest?.body).includes('start that again'), 'phrases struck from the video are left out of the AI request');
  await page.getByRole('tab', { name: /Chapters/ }).click();
  check((await page.locator('.chapter-list li').count()) === 2, 'AI chapters replace the markers');
  await page.unroute('https://api.anthropic.com/**');

  // Play a little to check the preview loop.
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  const finalLen = await page.locator('.timeline-foot strong').textContent();
  log('final length', finalLen);

  // ---------------------------------------------------------------- export
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.locator('dialog[open]').waitFor();
  await page.getByRole('switch', { name: /Burn in captions/ }).check({ force: true });
  await shot(page, '06-export');
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Export video' }).click();
  await page.getByText(/^Ready:/).waitFor({ timeout: 120000 });
  log(`export took ${((Date.now() - t0) / 1000).toFixed(1)} s:`, await page.locator('.notice-ok').textContent());
  await shot(page, '07-export-done');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download video' }).click()]);
  const videoPath = join(out, dl.suggestedFilename());
  await dl.saveAs(videoPath);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', videoPath]).toString());
  log('ffprobe', JSON.stringify(probe));
  const dur = Number(probe.format.duration);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  check(!!v && !!a, `export has video (${v?.codec_name}) and audio (${a?.codec_name})`);
  check(dur > 2 && dur < meta.duration - 1, `export is shorter than the take after cuts (${dur.toFixed(2)} s vs ${meta.duration.toFixed(2)} s)`);
  // Decode the whole file to catch corrupt frames.
  execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', videoPath, '-f', 'null', '-']);
  check(true, 'ffmpeg decodes the export without errors');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(1.5, dur / 2)), '-i', videoPath, '-frames:v', '1', join(out, 'export-frame.png')]);

  const [pageDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download player page' }).click()]);
  const pagePath = join(out, pageDl.suggestedFilename());
  await pageDl.saveAs(pagePath);
  const [vtt] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Captions .vtt' }).click()]);
  const vttPath = join(out, vtt.suggestedFilename());
  await vtt.saveAs(vttPath);
  check(execFileSync('head', ['-c', '6', vttPath]).toString() === 'WEBVTT', 'captions download as WebVTT');
  await page.getByRole('button', { name: 'Close' }).click();

  // Player page plays on its own.
  const pp = await newPage(ctx);
  await pp.goto(`file://${pagePath}`);
  await pp.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, { timeout: 15000 });
  const ppInfo = await pp.evaluate(() => ({ d: document.querySelector('video').duration, rows: document.querySelectorAll('#tx .row').length, ch: document.querySelectorAll('#chapters .row').length }));
  log('player page', JSON.stringify(ppInfo));
  check(ppInfo.d > 1 && ppInfo.rows >= 2, 'player page loads the video and the transcript');
  await shot(pp, '08-player-page');
  await pp.close();

  // ---------------------------------------------------------------- library card
  await page.getByRole('button', { name: 'Back to recordings' }).click();
  await page.locator('.card-rec').first().waitFor();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.locator('.card-rec img').first().waitFor({ timeout: 10000 }).catch(() => undefined);
  await shot(page, '09-library');
  check((await page.locator('.card-rec').count()) === 1, 'library lists the recording');

  // ---------------------------------------------------------------- discard
  await page.getByRole('button', { name: 'New recording' }).click();
  await page.getByRole('button', { name: 'Choose what to share' }).first().click();
  await page.locator('.stage-video').waitFor();
  await page.getByRole('switch', { name: '3-second countdown' }).uncheck({ force: true });
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.locator('.tally').waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: 'Discard this take' }).click();
  await page.getByRole('button', { name: 'Choose what to share' }).first().waitFor();
  await page.locator('.bubble video').waitFor({ timeout: 8000 });
  check(true, 'discarding a take returns to setup with the camera back on');
  const afterDiscard = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('shuttle');
        req.onsuccess = () => {
          const tx = req.result.transaction(['recordings', 'sessions']);
          const a = tx.objectStore('recordings').count();
          const b = tx.objectStore('sessions').count();
          tx.oncomplete = () => resolve([a.result, b.result]);
        };
      }),
  );
  check(afterDiscard[0] === 1 && afterDiscard[1] === 0, 'a discarded take leaves nothing behind');

  // ---------------------------------------------------------------- crash recovery
  await page.getByRole('button', { name: 'Choose what to share' }).first().click();
  await page.locator('.stage-video').waitFor();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.locator('.tally').waitFor();
  await page.waitForTimeout(4500);
  await page.close(); // the tab dies mid-recording

  const page2 = await newPage(ctx);
  current = page2;
  await page2.goto(BASE);
  await page2.getByRole('button', { name: 'Recover it' }).waitFor({ timeout: 10000 });
  await shot(page2, '10-recovery');
  await page2.getByRole('button', { name: 'Recover it' }).click();
  await page2.waitForURL(/#\/r\//, { timeout: 20000 });
  await page2.getByText(/recovered after an interruption/).waitFor();
  const recovered = await page2.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('shuttle');
        req.onsuccess = () => {
          const g = req.result.transaction('recordings').objectStore('recordings').getAll();
          g.onsuccess = () => resolve(g.result.filter((r) => r.recovered).map((r) => r.duration));
        };
      }),
  );
  check(recovered.length === 1 && recovered[0] > 2, `crashed take recovered (${recovered[0]?.toFixed(2)} s)`);

  // ---------------------------------------------------------------- light theme + phone width
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] });
  const ph = await newPage(phone, 'light');
  await ph.goto(BASE);
  await ph.getByRole('heading', { name: /Record it once/ }).waitFor();
  await shot(ph, '11-phone-light');
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal scroll at phone width');
  await phone.close();

  writeFileSync(join(out, 'errors.txt'), errors.join('\n'));
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
} catch (err) {
  failures++;
  console.log('✗ FAIL', err);
  if (current && !current.isClosed()) await current.screenshot({ path: join(out, 'zz-failure.png') }).catch(() => undefined);
  console.log(errors.join('\n'));
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
