// Tests of evals/lib.mjs: the answer-key parser, the one-change check and the helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as L from '../lib.mjs';

test('parses answer-key tables, ignoring other tables and columns', () => {
  const { cases, errors } = L.parseAnswerKey(`
| Column | What goes in it |
| --- | --- |
| ID | A short name. |

| Held out | ID | Question | Ideal answer | Must include | Added |
| --- | --- | --- | --- | --- | --- |
|  | one | Pipes? | Use a \\| here.<br>Then this. | pipe; second line | seed |
| yes | two | Held? | Yes. |  | today |
`);
  assert.deepEqual(errors, []);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].ideal, 'Use a | here.\nThen this.');
  assert.deepEqual(cases[0].must, ['pipe', 'second line']);
  assert.equal(cases[0].heldOut, false);
  assert.equal(cases[1].heldOut, true);
  assert.deepEqual(cases[1].must, []);
});

test('reports rows it cannot use', () => {
  const { errors } = L.parseAnswerKey(`| ID | Question | Ideal answer |\n| --- | --- | --- |\n| bad id | Q? |  |\n`);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /letters, numbers and dashes/);
  assert.match(errors[1], /no ideal answer/);
});

test('reads the private answer key too, and catches duplicate IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-lib-'));
  const P = L.paths(root);
  fs.mkdirSync(P.evals, { recursive: true });
  const table = (id) => `| ID | Question | Ideal answer |\n| --- | --- | --- |\n| ${id} | Q? | A. |\n`;
  fs.writeFileSync(P.answerKey, table('a'));
  fs.writeFileSync(P.privateKey, table('b'));
  assert.deepEqual(L.loadAnswerKey(P).cases.map((c) => c.id), ['a', 'b']);
  fs.writeFileSync(P.privateKey, table('a'));
  assert.match(L.loadAnswerKey(P).errors[0], /already used/);
});

const LIVE = `---
name: generator
description: Test.
tools: Read, Grep
---

Intro line.

## Rules
- One.
- Two.
- Three.
`;

test('one contiguous change passes the check', () => {
  const r = L.checkCandidate(LIVE, LIVE.replace('- Two.', '- Two, but better.\n- Two and a half.'));
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.places, 1);
  assert.match(r.diff, /^-- Two\.$/m);
  assert.match(r.diff, /^\+- Two and a half\.$/m);
});

test('an edit that keeps a line in the middle still counts as one place', () => {
  const r = L.checkCandidate(LIVE, LIVE.replace('- One.\n- Two.\n- Three.', '- One!\n- Two.\n- Three!'));
  assert.equal(r.places, 1);
});

test('two places, the frontmatter, no change and big changes all fail', () => {
  assert.match(L.checkCandidate(LIVE, LIVE.replace('Intro line.', 'Intro.').replace('- Three.', '- 3.')).problems.join(), /2 separate places/);
  assert.match(L.checkCandidate(LIVE, LIVE.replace('tools: Read, Grep', 'tools: Read, Grep, Bash')).problems.join(), /frontmatter/);
  assert.match(L.checkCandidate(LIVE, LIVE).problems.join(), /no change/);
  const big = LIVE + Array.from({ length: 41 }, (_, i) => `- Extra ${i}.\n`).join('');
  assert.match(L.checkCandidate(LIVE, big).problems.join(), /41 lines/);
});

test('frontmatter parsing and the --agents JSON', () => {
  const fm = L.parseFrontmatter('---\nname: generator\ntools:\n  - Read\n  - Grep\nmodel: inherit\nmaxTurns: 25\n---\n');
  assert.deepEqual(fm.tools, ['Read', 'Grep']);
  const { name, json } = L.agentsJson(LIVE.replace('tools: Read, Grep', 'tools: Read, Grep\nmodel: inherit\nmaxTurns: 7'));
  assert.equal(name, 'generator');
  assert.deepEqual(json.generator.tools, ['Read', 'Grep']);
  assert.equal(json.generator.model, undefined, '"inherit" means no model override');
  assert.equal(json.generator.maxTurns, 7);
  assert.ok(json.generator.prompt.startsWith('Intro line.'));
  assert.equal(L.agentsJson(LIVE, { model: 'sonnet' }).json.generator.model, 'sonnet');
});

test('extracts the JSON an agent ends with', () => {
  assert.deepEqual(L.extractJson('Text\n```json\n{"a": 1}\n```\nmore\n```json\n{"b": {"c": 2}}\n```'), { b: { c: 2 } });
  assert.deepEqual(L.extractJson('No fence: {"grades": [{"id": "x"}]} done'), { grades: [{ id: 'x' }] });
  assert.equal(L.extractJson('{ not json'), null);
  assert.equal(L.extractJson(''), null);
});

test('mapLimit keeps order and respects the limit', async () => {
  let running = 0;
  let peak = 0;
  const out = await L.mapLimit([5, 1, 3, 2], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 30, 20]);
  assert.equal(peak, 2);
});
