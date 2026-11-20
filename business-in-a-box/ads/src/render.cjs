// Renders the five Doorkeep launch statics (1080x1350) and a contact sheet.
// Run from anywhere: node business-in-a-box/ads/src/render.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const here = __dirname;
const out = path.resolve(here, '..');
const ads = [
  ['ad1', '01-the-receipt'],
  ['ad2', '02-keep-the-fee'],
  ['ad3', '03-the-big-number'],
  ['ad4', '04-same-ticket'],
  ['ad5', '05-seven-days'],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(here, 'ads.html'));
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => ['Anton', 'Inter', 'JetBrains Mono']
    .filter(f => !document.fonts.check(`40px "${f}"`)));
  if (missing.length) throw new Error('Fonts not loaded: ' + missing.join(', '));
  for (const [id, name] of ads) {
    await page.locator('#' + id).screenshot({ path: path.join(out, name + '.png') });
    console.log('wrote', name + '.png');
  }

  // Contact sheet: all five side by side at one third size.
  const imgs = ads.map(([, n]) => `<img src="file://${path.join(out, n + '.png')}">`).join('');
  const sheet = path.join(here, 'contact-sheet.html');
  fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0b090e;display:flex;gap:24px;padding:24px;width:max-content}
    img{width:360px;height:450px;display:block;border-radius:6px}</style>${imgs}`);
  const p2 = await browser.newPage({ viewport: { width: 5 * 360 + 6 * 24, height: 450 + 48 }, deviceScaleFactor: 1 });
  await p2.goto('file://' + sheet);
  await p2.screenshot({ path: path.join(out, 'contact-sheet.png') });
  fs.unlinkSync(sheet);
  console.log('wrote contact-sheet.png');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
