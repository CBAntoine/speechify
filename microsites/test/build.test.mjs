// Run with: npm run sites:test   (or: node --test microsites/test/*.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, readdir, rm, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAll, DEFAULT_SITES_DIR } from '../lib/build.mjs';

const PILOT = 'mississauga-backwater-valve';
const DOMAIN = 'backwatervalvemississauga.ca';
const NOW = Date.parse('2026-11-20T12:00:00Z');
// .test is a reserved top-level domain, so this address can't belong to anyone.
const OPERATOR = { name: 'Test Referrals Inc.', email: 'owner@referrals.test' };
const PARTNER = {
  company: 'Test Plumbing Ltd.',
  license: { holder: 'Jordan Reyes', label: 'Licensed plumber', credential: 'Certificate of Qualification', number: '123456789' },
};
// A 555 number outside the 0100-0199 fiction block passes validation but rings nobody.
const TEST_PHONE = '+19055551234';

async function workspace(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'microsites-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sitesDir = path.join(dir, 'sites');
  await cp(DEFAULT_SITES_DIR, sitesDir, { recursive: true });
  return { sitesDir, outDir: path.join(dir, 'dist') };
}

async function editConfig(sitesDir, slug, edit) {
  const file = path.join(sitesDir, slug, 'site.json');
  const config = JSON.parse(await readFile(file, 'utf8'));
  edit(config);
  await writeFile(file, JSON.stringify(config, null, 2));
}

async function readSite(dir) {
  const files = new Map();
  for (const rel of await readdir(dir, { recursive: true })) {
    if (/\.(html|txt|xml)$|_headers$/.test(rel)) files.set(rel, await readFile(path.join(dir, rel), 'utf8'));
  }
  return files;
}

const htmlPages = (files) => [...files].filter(([rel]) => rel.endsWith('.html'));
const telLinks = (html) => [...html.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]);

function assertBuilt({ results, failures }) {
  assert.equal(failures.length, 0, failures.map((f) => f.message).join('\n'));
  assert.equal(results.length, 1);
  return results[0];
}

function problemsOf({ failures }, slug = PILOT) {
  const failure = failures.find((f) => f.site === slug);
  assert.ok(failure, `expected ${slug} to fail`);
  return failure.problems.join('\n');
}

test('guide preview builds every page as noindex, with one h1 and the guide disclosure', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  const result = assertBuilt(await buildAll({ sitesDir, outDir, now: NOW }));
  assert.equal(result.mode, 'guide');
  assert.equal(result.production, false);

  const files = await readSite(result.outDir);
  assert.equal(htmlPages(files).length, 8);
  for (const [rel, html] of htmlPages(files)) {
    assert.match(html, /<html lang="en-CA">/, rel);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/, rel);
    assert.match(html, /class="preview-ribbon"/, rel);
    assert.match(html, /is an independent guide, not a plumbing company/, rel);
    assert.match(html, /Not affiliated with the City of Mississauga, the Region of Peel or any manufacturer/, rel);
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, `${rel} should have one h1`);
  }
  assert.equal(files.get('robots.txt'), 'User-agent: *\nDisallow: /\n');
  assert.match(files.get('_headers'), /X-Robots-Tag: noindex/);
});

test('guide mode never shows a call number, only the safety lines', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  const result = assertBuilt(await buildAll({ sitesDir, outDir, now: NOW }));
  const site = JSON.parse(await readFile(path.join(sitesDir, PILOT, 'site.json'), 'utf8'));

  for (const [rel, html] of htmlPages(await readSite(result.outDir))) {
    for (const number of telLinks(html)) assert.ok(site.safetyPhones.includes(number), `${rel}: unexpected tel:${number}`);
    assert.doesNotMatch(html, /class="(cta|callbar|header-call)"/, rel);
    assert.doesNotMatch(html, /555-0142/, rel);
  }
});

test('call-mode preview shows the number and the partner licence statement on every page', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  const result = assertBuilt(await buildAll({ sitesDir, outDir, now: NOW, forceLive: true }));
  assert.equal(result.mode, 'call');

  const files = await readSite(result.outDir);
  for (const [rel, html] of htmlPages(files)) {
    assert.match(html, /Work is performed by <strong>Sample Plumbing Co\.<\/strong> \(Licensed plumber: Pat Sample, Certificate of Qualification 000000000\)/, rel);
    assert.match(html, /Skilled Trades Ontario public register: <a href="https:\/\/skilledtradesontario\.ca\/public-register\/">/, rel);
    assert.ok(telLinks(html).includes('+19055550142'), `${rel} should link the tracking number`);
  }
  assert.match(files.get('index.html'), /"@type":"Service"/);
  assert.match(files.get('index.html'), /"containedInPlace":\{"@type":"AdministrativeArea","name":"Ontario"\}/);
  assert.match(files.get('index.html'), /Referral disclosure:/);
});

test('production build refuses to run without the operator details', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  const problems = problemsOf(await buildAll({ sitesDir, outDir, now: NOW, production: true }));
  assert.match(problems, /operator\.name is missing/);
  assert.match(problems, /operator\.email is missing/);
});

test('production guide build is indexable and lists its pages in the sitemap', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await editConfig(sitesDir, PILOT, (c) => (c.operator = OPERATOR));
  const result = assertBuilt(await buildAll({ sitesDir, outDir, now: NOW, production: true }));
  assert.equal(result.outDir, path.join(outDir, DOMAIN));

  const files = await readSite(result.outDir);
  for (const [rel, html] of htmlPages(files)) {
    assert.doesNotMatch(html, /class="preview-ribbon"/, rel);
    const robots = rel === '404.html' ? 'noindex, nofollow' : 'index, follow';
    assert.match(html, new RegExp(`<meta name="robots" content="${robots}">`), rel);
    assert.match(html, /© 2026 Test Referrals Inc\./, rel);
  }
  assert.match(files.get('robots.txt'), /Sitemap: https:\/\/backwatervalvemississauga\.ca\/sitemap\.xml/);
  assert.equal(files.get('sitemap.xml').match(/<loc>/g).length, 7);
  assert.doesNotMatch(files.get('sitemap.xml'), /404/);
  assert.doesNotMatch(files.get('_headers'), /X-Robots-Tag/);
});

test('production refuses a phone number until a licensed partner is set', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await editConfig(sitesDir, PILOT, (c) => {
    c.operator = OPERATOR;
    c.phone = TEST_PHONE;
  });
  assert.match(problemsOf(await buildAll({ sitesDir, outDir, now: NOW, production: true })), /phone is set but partner is empty/);
});

test('production call mode needs the licence number and a real tracking number', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await editConfig(sitesDir, PILOT, (c) => {
    c.operator = OPERATOR;
    c.partner = { company: PARTNER.company, license: { holder: PARTNER.license.holder } };
    c.phone = '+19055550142';
  });
  const problems = problemsOf(await buildAll({ sitesDir, outDir, now: NOW, production: true }));
  assert.match(problems, /partner\.license\.number is missing/);
  assert.match(problems, /reserved for fiction/);

  await editConfig(sitesDir, PILOT, (c) => {
    c.partner = PARTNER;
    c.phone = TEST_PHONE;
  });
  const result = assertBuilt(await buildAll({ sitesDir, outDir, now: NOW, production: true }));
  assert.equal(result.mode, 'call');
  const home = (await readSite(result.outDir)).get('index.html');
  assert.match(home, /Work is performed by <strong>Test Plumbing Ltd\.<\/strong> \(Licensed plumber: Jordan Reyes, Certificate of Qualification 123456789\)/);
  assert.match(home, /href="tel:\+19055551234"/);
  assert.match(home, /\(905\) 555-1234/);
});

test('--live cannot be combined with a production build', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await editConfig(sitesDir, PILOT, (c) => (c.operator = OPERATOR));
  const problems = problemsOf(await buildAll({ sitesDir, outDir, now: NOW, production: true, forceLive: true }));
  assert.match(problems, /--live is for previews only/);
});

test('microsites in the network never link to each other', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  const other = path.join(sitesDir, 'brampton-backwater-valve');
  await cp(path.join(sitesDir, PILOT), other, { recursive: true });
  await editConfig(sitesDir, 'brampton-backwater-valve', (c) => (c.domain = 'backwatervalvebrampton.ca'));
  await appendFile(path.join(other, 'pages', 'home.html'), '<p><a href="https://www.backwatervalvemississauga.ca/">Our Mississauga site</a></p>\n');

  const outcome = await buildAll({ sitesDir, outDir, now: NOW });
  assert.match(problemsOf(outcome, 'brampton-backwater-valve'), /another site in this network/);
  assert.ok(outcome.results.some((r) => r.slug === PILOT), 'the untouched site still builds');
});

test('two site folders cannot claim the same domain', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  // Folders are read in name order, so the later one is reported.
  await cp(path.join(sitesDir, PILOT), path.join(sitesDir, 'zz-copy'), { recursive: true });
  const outcome = await buildAll({ sitesDir, outDir, now: NOW });
  assert.match(problemsOf(outcome, 'zz-copy'), /also used by sites\/mississauga-backwater-valve/);
  assert.equal(outcome.results.length, 0, 'nothing is built while the network config is inconsistent');
});

test('broken internal links and anchors fail the build', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await appendFile(
    path.join(sitesDir, PILOT, 'pages', 'home.html'),
    '<p><a href="/no-such-page/">a</a> <a href="/basement-flooding-rebates">b</a> <a href="/#nowhere">c</a></p>\n',
  );
  const problems = problemsOf(await buildAll({ sitesDir, outDir, now: NOW }));
  assert.match(problems, /\/no-such-page\/ points to a page that doesn't exist/);
  assert.match(problems, /should end with a slash/);
  assert.match(problems, /\/#nowhere has no matching id/);
});

test('call-mode-only tokens outside an if:live block fail in guide mode', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await appendFile(path.join(sitesDir, PILOT, 'pages', 'home.html'), '<p>Call {{phone}}</p>\n');
  assert.match(problemsOf(await buildAll({ sitesDir, outDir, now: NOW })), /\{\{phone\}\} only works in call mode/);
});

test('facts older than a year warn in preview and block production', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await editConfig(sitesDir, PILOT, (c) => {
    c.operator = OPERATOR;
    c.lastReviewed = '2025-06-01';
  });
  const preview = assertBuilt(await buildAll({ sitesDir, outDir, now: NOW }));
  assert.ok(preview.warnings.some((w) => /over a year old/.test(w)));
  assert.match(problemsOf(await buildAll({ sitesDir, outDir, now: NOW, production: true })), /over a year old/);
});

test('safety numbers must be N11 codes or North American numbers', async (t) => {
  const { sitesDir, outDir } = await workspace(t);
  await editConfig(sitesDir, PILOT, (c) => c.safetyPhones.push('1-866-763-5427'));
  assert.match(problemsOf(await buildAll({ sitesDir, outDir, now: NOW })), /safetyPhones entry "1-866-763-5427"/);
});
