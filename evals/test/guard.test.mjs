// Tests of evals/guard.mjs, the PreToolUse hook that locks down the loop's agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from '../guard.mjs';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'guard.mjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-guard-'));
for (const dir of ['evals/candidates', 'evals/runs', '.claude/agents', 'rainmaker']) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, 'evals/answer_key.md'), 'secret answers');
fs.writeFileSync(path.join(root, 'README.md'), 'readme');
fs.symlinkSync(path.join(root, 'evals/answer_key.md'), path.join(root, 'rainmaker/notes.md'));

const env = { CLAUDE_PROJECT_DIR: root };
const call = (agent, tool, toolInput, extraEnv = {}) =>
  decide({ agent_type: agent, tool_name: tool, tool_input: toolInput, cwd: root }, { ...env, ...extraEnv });
const allowed = (...a) => assert.equal(call(...a), null, `expected ${a[0]} ${a[1]} ${JSON.stringify(a[2])} to be allowed`);
const denied = (...a) => assert.ok(call(...a)?.reason, `expected ${a[0]} ${a[1]} ${JSON.stringify(a[2])} to be denied`);

test('other sessions and agents are left alone', () => {
  assert.equal(call(undefined, 'Write', { file_path: 'evals/answer_key.md' }), null);
  assert.equal(call('Explore', 'Edit', { file_path: '.claude/agents/generator.md' }), null);
  assert.equal(call(undefined, 'Bash', { command: 'rm -rf /' }), null);
});

test('generator: reads the repository but not the answer key, and never writes', () => {
  allowed('generator', 'Read', { file_path: path.join(root, 'README.md') });
  allowed('generator', 'Grep', { pattern: 'x', path: 'rainmaker', output_mode: 'content' });
  allowed('generator', 'Grep', { pattern: 'x' }); // file names only, by default
  allowed('generator', 'Glob', { pattern: '**/*.md' });
  denied('generator', 'Read', { file_path: 'evals/answer_key.md' });
  denied('generator', 'Read', { file_path: 'evals/candidates/c-1.md' });
  denied('generator', 'Read', { file_path: 'rainmaker/notes.md' }); // a symlink to the answer key
  denied('generator', 'Grep', { pattern: 'x', path: '.', output_mode: 'content' });
  denied('generator', 'Grep', { pattern: 'x', output_mode: 'count' });
  denied('generator', 'Grep', { pattern: 'x', path: 'evals' });
  denied('generator', 'Read', { file_path: '/etc/hosts' });
  denied('generator', 'Read', { file_path: '~/.claude/settings.json' });
  denied('generator', 'Glob', { pattern: '../**/*.md' });
  denied('generator', 'Write', { file_path: 'notes.md' });
  denied('generator', 'Edit', { file_path: 'README.md' });
  denied('generator', 'Bash', { command: 'cat evals/answer_key.md' });
  denied('generator', 'WebFetch', { url: 'https://example.com' });
});

test('verifier: reads everything in the repository, writes nothing', () => {
  allowed('verifier', 'Read', { file_path: 'evals/answer_key.md' });
  allowed('verifier', 'Grep', { pattern: 'x', path: '.', output_mode: 'content' });
  denied('verifier', 'Edit', { file_path: 'evals/answer_key.md' });
  denied('verifier', 'Write', { file_path: 'evals/runs/x.json' });
  denied('verifier', 'Bash', { command: 'ls' });
  denied('verifier', 'Read', { file_path: '/etc/hosts' });
});

test('coach: edits only its draft', () => {
  allowed('coach', 'Edit', { file_path: 'evals/candidates/c-1.md' });
  allowed('coach', 'Write', { file_path: path.join(root, 'evals/candidates/c-2.md') });
  denied('coach', 'Edit', { file_path: '.claude/agents/generator.md' });
  denied('coach', 'Edit', { file_path: '.claude/agents/verifier.md' });
  denied('coach', 'Write', { file_path: 'evals/answer_key.md' });
  denied('coach', 'Write', { file_path: 'evals/candidates/c-1.json' });
  denied('coach', 'Write', { file_path: 'evals/candidates/sub/c-1.md' });
  denied('coach', 'Write', { file_path: '.claude/settings.json' });
  denied('coach', 'Edit', { file_path: 'evals/guard.mjs' });
  denied('coach', 'Bash', { command: 'cp a b' });
  // When the loop names the draft, only that draft can be written.
  allowed('coach', 'Edit', { file_path: 'evals/candidates/c-1.md' }, { LOOP_CANDIDATE: 'evals/candidates/c-1.md' });
  denied('coach', 'Edit', { file_path: 'evals/candidates/c-2.md' }, { LOOP_CANDIDATE: 'evals/candidates/c-1.md' });
});

test("coach: can't read the answer key, run results or the verifier", () => {
  allowed('coach', 'Read', { file_path: '.claude/agents/generator.md' });
  allowed('coach', 'Read', { file_path: 'evals/candidates/c-1.md' });
  allowed('coach', 'Grep', { pattern: 'x', path: 'rainmaker', output_mode: 'content' });
  denied('coach', 'Read', { file_path: 'evals/answer_key.md' });
  denied('coach', 'Read', { file_path: 'evals/answer_key.private.md' });
  denied('coach', 'Read', { file_path: 'evals/runs/20261123/report.md' });
  denied('coach', 'Read', { file_path: '.claude/agents/verifier.md' });
  denied('coach', 'Grep', { pattern: 'x', path: 'evals', output_mode: 'content' });
});

test('LOOP_ROLE covers runs where Claude Code reports no agent', () => {
  assert.ok(decide({ tool_name: 'Read', tool_input: { file_path: 'evals/answer_key.md' }, cwd: root }, { ...env, LOOP_ROLE: 'generator' })?.reason);
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: 'README.md' }, cwd: root }, { ...env, LOOP_ROLE: 'generator' }), null);
});

test('as a hook: denies with JSON, and blocks when it cannot read its input', () => {
  const run = (input, extraEnv = {}) => spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', env: { ...process.env, ...env, LOOP_ROLE: '', ...extraEnv } });
  const deny = run(JSON.stringify({ agent_type: 'generator', tool_name: 'Read', tool_input: { file_path: 'evals/answer_key.md' }, cwd: root }));
  assert.equal(deny.status, 0);
  const out = JSON.parse(deny.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /off limits to the generator/);
  const pass = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'evals/answer_key.md' }, cwd: root }));
  assert.equal(pass.status, 0);
  assert.equal(pass.stdout, '');
  const broken = run('not json', { LOOP_ROLE: 'coach' });
  assert.equal(broken.status, 2);
});
