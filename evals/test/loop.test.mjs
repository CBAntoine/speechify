// End-to-end tests of evals/loop.mjs, with a fake `claude` (no model calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOOP = path.join(HERE, '..', 'loop.mjs');
const FAKE = path.join(HERE, 'fake-claude.mjs');

const GENERATOR = `---
name: generator
description: Test generator.
tools: Read, Grep, Glob
model: inherit
---

You answer questions.

## Rules
- Be brief.
`;

const AGENT = (name, tools) => `---\nname: ${name}\ndescription: Test ${name}.\ntools: ${tools}\n---\n\nYou are the ${name}.\n`;

const KEY = `# Answer key

| ID | Question | Ideal answer | Must include | Held out |
| --- | --- | --- | --- | --- |
| key-question | Which key do I need? | Use FAKEKEY. | FAKEKEY | |
| key-held | What key unlocks it? | FAKEKEY. | FAKEKEY | yes |
| works | Does it work? | Yes, fine. | fine | |
`;

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-loop-'));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put('.claude/agents/generator.md', GENERATOR);
  put('.claude/agents/verifier.md', AGENT('verifier', 'Read, Grep, Glob'));
  put('.claude/agents/coach.md', AGENT('coach', 'Read, Grep, Glob, Edit, Write'));
  put('.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/evals/guard.mjs"' }] }] } }));
  put('evals/answer_key.md', KEY);
  // The loop protects its own scripts too, so the test project gets copies.
  for (const f of ['guard.mjs', 'lib.mjs', 'loop.mjs']) put(`evals/${f}`, fs.readFileSync(path.join(HERE, '..', f), 'utf8'));
  return root;
}

function loop(root, args, env = {}) {
  const r = spawnSync(process.execPath, [LOOP, ...args], {
    encoding: 'utf8',
    env: { ...process.env, EVALS_ROOT: root, EVALS_CLAUDE_BIN: FAKE, FAKE_CLAUDE_LOG: path.join(root, 'calls.jsonl'), ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (root, rel) => JSON.parse(read(root, rel));
const drafts = (root) => fs.readdirSync(path.join(root, 'evals', 'candidates')).filter((f) => f.endsWith('.json'));
const calls = (root) => read(root, 'calls.jsonl').trim().split('\n').map((l) => JSON.parse(l));

test('check passes on a complete set-up', () => {
  const root = project();
  const r = loop(root, ['check']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /3 cases, 2 the Coach sees, 1 held out/);
  assert.match(r.out, /the guard blocks and allows what it should/);
});

test('grade scores the live generator and saves the first version', () => {
  const root = project();
  const r = loop(root, ['grade']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /passes 1 of 3/);
  assert.equal(read(root, 'evals/versions/v001.md'), GENERATOR);
  assert.match(read(root, 'evals/versions/CHANGELOG.md'), /## v001 .*\n\nFirst version\./);
  const run = read(root, 'evals/runs/LATEST').trim();
  assert.match(read(root, `evals/runs/${run}/report.md`), /\| key-question \| Which key do I need\? \|  \| fail \|/);
});

test('propose drafts one change, tests it on held-out cases too, and recommends promoting it', () => {
  const root = project();
  const r = loop(root, ['propose']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Recommendation: PROMOTE/);
  const [metaFile] = drafts(root);
  const meta = json(root, `evals/candidates/${metaFile}`);
  assert.equal(meta.status, 'pending');
  assert.deepEqual(meta.result.fixed, ['key-question']);
  assert.equal(meta.result.heldOutFixed, 1);
  assert.equal(JSON.stringify(meta).includes('key-held'), false, 'draft metadata must not name held-out cases');
  assert.equal(read(root, '.claude/agents/generator.md'), GENERATOR, 'propose must not touch the live generator');

  const log = calls(root);
  const coach = log.find((c) => c.role === 'coach');
  assert.equal(coach.loopRole, 'coach');
  assert.match(coach.candidate, /^evals\/candidates\/c-.*\.md$/);
  assert.ok(coach.argv.includes(`Edit(${coach.candidate})`), 'the coach may edit only its draft');
  for (const c of log.filter((x) => x.role === 'generator')) {
    assert.ok(c.argv.includes('--agents') && c.argv.includes('generator'));
  }
  const run = meta.runId;
  const coachPrompt = read(root, `evals/runs/${run}/coach-prompt.md`);
  assert.match(coachPrompt, /key-question/);
  assert.equal(coachPrompt.includes('What key unlocks it?'), false, 'the coach must not see held-out cases');
  // Flips are checked again before they count.
  assert.ok(log.some((c) => c.role === 'generator' && c.argv.some((a) => a.includes('recheck-candidate'))));
});

test('promote makes the draft live, saves a version and logs it', () => {
  const root = project();
  loop(root, ['propose']);
  const r = loop(root, ['promote', 'latest']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /now v002/);
  const live = read(root, '.claude/agents/generator.md');
  assert.match(live, /RULE: mention FAKEKEY/);
  assert.equal(read(root, 'evals/versions/v002.md'), live);
  assert.equal(read(root, 'evals/versions/v001.md'), GENERATOR);
  const changelog = read(root, 'evals/versions/CHANGELOG.md');
  assert.ok(changelog.indexOf('## v002') < changelog.indexOf('## v001'), 'newest entry first');
  assert.match(changelog, /Fixed: key-question, 1 held out\. Broke: none\./);
  assert.equal(loop(root, ['promote', 'latest']).code, 1, 'nothing left to promote');
});

test('rollback puts an earlier version back as a new version', () => {
  const root = project();
  loop(root, ['propose']);
  loop(root, ['promote', 'latest']);
  const r = loop(root, ['rollback', 'v001']);
  assert.equal(r.code, 0, r.out);
  assert.equal(read(root, '.claude/agents/generator.md'), GENERATOR);
  assert.equal(read(root, 'evals/versions/v003.md'), GENERATOR);
});

test('reject records the reason, and the next coach sees it', () => {
  const root = project();
  loop(root, ['propose']);
  const r = loop(root, ['reject', 'latest', '--reason', 'Too narrow']);
  assert.equal(r.code, 0, r.out);
  const meta = json(root, `evals/candidates/${drafts(root)[0]}`);
  assert.equal(meta.status, 'rejected');
  assert.equal(meta.reason, 'Too narrow');
  assert.match(read(root, 'evals/versions/CHANGELOG.md'), /rejected[\s\S]*Reason \(you\): Too narrow/);
  loop(root, ['propose', '--fresh']);
  const runs = fs.readdirSync(path.join(root, 'evals', 'runs')).filter((d) => /^\d/.test(d)).sort();
  assert.match(read(root, `evals/runs/${runs.at(-1)}/coach-prompt.md`), /Rejected \(Too narrow\)/);
});

test('a draft that breaks a case is not recommended', () => {
  const root = project();
  const r = loop(root, ['propose'], { FAKE_COACH: 'breaks' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Recommendation: REJECT\. Draft c-\S+ breaks 1 case \(and fixes 2\)/);
});

test('a flip that does not happen again does not count', () => {
  const root = project();
  const r = loop(root, ['propose'], { FAKE_FLAKY: '1' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Recommendation: PROMOTE/);
  const meta = json(root, `evals/candidates/${drafts(root)[0]}`);
  assert.deepEqual(meta.result.broke, []);
  assert.equal(meta.result.noisy, 1);
});

test('a draft that changes more than one place is thrown away', () => {
  const root = project();
  const r = loop(root, ['propose'], { FAKE_COACH: 'two-places' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /thrown away: the draft changes 2 separate places/);
  assert.equal(calls(root).filter((c) => c.role === 'coach').length, 2, 'the coach gets one second try');
  assert.equal(json(root, `evals/candidates/${drafts(root)[0]}`).status, 'invalid');
  assert.equal(read(root, '.claude/agents/generator.md'), GENERATOR);
});

test('the run stops if an agent changes a protected file', () => {
  const root = project();
  const r = loop(root, ['propose'], { FAKE_COACH: 'tamper' });
  assert.equal(r.code, 1);
  assert.match(r.out, /Stopped: evals\/answer_key\.md changed while the coach was running/);
});

test('auto promotes until every case passes', () => {
  const root = project();
  const r = loop(root, ['auto', '--max-iterations', '3']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1\. Promoted c-.* as v002/);
  assert.match(r.out, /2\. Every case passes/);
  assert.match(read(root, '.claude/agents/generator.md'), /RULE: mention FAKEKEY/);
});

test('auto stops after a run of drafts that fail the gate', () => {
  const root = project();
  const r = loop(root, ['auto', '--max-iterations', '5', '--patience', '2'], { FAKE_COACH: 'breaks' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Stopped: 2 drafts in a row didn't pass the gate/);
  assert.equal(read(root, '.claude/agents/generator.md'), GENERATOR);
});

test('snapshot saves hand edits as a new version', () => {
  const root = project();
  loop(root, ['snapshot']);
  fs.appendFileSync(path.join(root, '.claude/agents/generator.md'), '- Say hello.\n');
  const r = loop(root, ['snapshot', '--note', 'Added a greeting rule.']);
  assert.equal(r.code, 0, r.out);
  assert.match(read(root, 'evals/versions/CHANGELOG.md'), /## v002 .*\n\nAdded a greeting rule\./);
});
