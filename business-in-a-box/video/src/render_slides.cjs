// Renders the 10 caption slides (1080x1920) used by build_videos.py.
// Run: node business-in-a-box/video/src/render_slides.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const here = __dirname;
const outDir = path.join(here, 'slides');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 2000 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(here, 'slides.html'));
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => ['Anton', 'Inter', 'JetBrains Mono'].filter(f => !document.fonts.check(`40px "${f}"`)));
  if (missing.length) throw new Error('Fonts not loaded: ' + missing.join(', '));
  // Fail loudly if any caption or stage overflows into the bottom safe zone (y > 1536).
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.slide')].flatMap(s => {
    const top = s.getBoundingClientRect().top;
    return [...s.querySelectorAll('.caption p, .stage > *, .fine')]
      .filter(e => e.getBoundingClientRect().bottom - top > 1536 || e.getBoundingClientRect().top - top < 270)
      .map(e => `${s.id}: ${e.className || e.tagName} spans ${Math.round(e.getBoundingClientRect().top - top)}-${Math.round(e.getBoundingClientRect().bottom - top)}`);
  }));
  if (overflow.length) console.warn('Safe-zone warnings:\n' + overflow.join('\n'));
  for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5']) {
    await page.locator('#' + id).screenshot({ path: path.join(outDir, id + '.png') });
  }
  console.log('wrote 10 slides to', outDir);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
