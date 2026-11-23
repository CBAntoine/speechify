#!/usr/bin/env node
// PreToolUse hook that locks down the loop's three agents. .claude/settings.json runs it
// before tool calls in every session in this repo, but it only rules on calls made by
// the generator, the verifier or the coach: Claude Code's `agent_type` for those agents,
// or LOOP_ROLE, which evals/loop.mjs sets on the runs it starts. Calls from anyone else
// (your own sessions, other agents) get no answer from it and go through as usual.
//
//   generator  reads the repository, but nothing under evals/ (the answer key lives
//              there, so it can't copy the ideal answers). Never writes.
//   verifier   reads the repository, answer key included. Never writes.
//   coach      reads the repository, except the answer key, run results (they include
//              the held-out cases) and the verifier. Writes only its draft in
//              evals/candidates/ — never the live generator, the answer key or the verifier.
//
// It uses nothing but Node's built-ins, so nothing else can break it. If it can't decide
// a call from one of these agents, it blocks the call instead of letting it through.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROLES = ['generator', 'verifier', 'coach'];
const TOOLS = {
  generator: ['Read', 'Grep', 'Glob'],
  verifier: ['Read', 'Grep', 'Glob'],
  coach: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
};
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function roleOf(input, env = process.env) {
  if (ROLES.includes(input.agent_type)) return input.agent_type;
  if (ROLES.includes(env.LOOP_ROLE)) return env.LOOP_ROLE;
  return null;
}

// Returns null to stay out of the way, or { reason } to deny the call.
export function decide(input, env = process.env) {
  const role = roleOf(input, env);
  if (!role) return null;

  const tool = String(input.tool_name || '');
  const args = input.tool_input || {};
  const root = real(path.resolve(env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()));
  const cwd = input.cwd ? path.resolve(input.cwd) : root;
  const at = (...parts) => path.join(root, ...parts);
  const show = (p) => path.relative(root, p).split(path.sep).join('/') || 'the whole repository';
  const resolve = (p) => {
    if (typeof p !== 'string' || !p) return null;
    const expanded = p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
    return real(path.resolve(cwd, expanded));
  };

  if (!TOOLS[role].includes(tool)) {
    return { reason: `The ${role} can only use ${TOOLS[role].join(', ')}.` };
  }

  if (WRITE_TOOLS.has(tool)) {
    if (role !== 'coach') return { reason: `The ${role} is read-only. It can't change files.` };
    const target = resolve(args.file_path || args.notebook_path);
    if (!target) return { reason: 'No file path was given.' };
    const draft = env.LOOP_CANDIDATE ? resolve(path.resolve(root, env.LOOP_CANDIDATE)) : null;
    const isDraft = draft
      ? target === draft
      : path.dirname(target) === at('evals', 'candidates') && /\.md$/i.test(target);
    if (!isDraft) {
      return {
        reason:
          `The coach can only edit its draft (${draft ? show(draft) : 'a .md file in evals/candidates/'}). ` +
          `${show(target)} is locked: the coach never changes the live generator, the answer key or the verifier.`,
      };
    }
    return null;
  }

  // Read, Grep and Glob.
  const target = tool === 'Read' ? resolve(args.file_path) : resolve(args.path || '.');
  if (!target) return { reason: 'No path was given.' };
  if (!inside(target, root)) return { reason: `The ${role} can only read files inside this repository.` };
  if (tool === 'Glob' && typeof args.pattern === 'string' &&
      (path.isAbsolute(args.pattern) || args.pattern.split(/[\\/]/).includes('..'))) {
    return { reason: 'Use a pattern relative to the repository, without "..".' };
  }

  const offLimits = offLimitsFor(role, at);
  const hit = offLimits.find((zone) => inside(target, zone.path) || (zone.match && zone.match(target)));
  if (hit) return { reason: `${show(hit.path)} is off limits to the ${role}: ${hit.why}.` };

  // A content search over a folder that contains an off-limits file would print its text.
  if (tool === 'Grep') {
    const mode = args.output_mode || 'files_with_matches';
    const covered = offLimits.find((zone) => inside(zone.path, target));
    if (mode !== 'files_with_matches' && covered) {
      return {
        reason:
          `A "${mode}" search of ${show(target)} would show text from ${show(covered.path)}, which is off limits to the ${role}. ` +
          'Search a folder that doesn\'t contain it (for example path: "rainmaker"), or search with output_mode "files_with_matches" and then Read the files you need.',
      };
    }
  }
  return null;
}

function offLimitsFor(role, at) {
  const answerKeyFile = (p) => path.dirname(p) === at('evals') && /^answer_key/i.test(path.basename(p));
  if (role === 'generator') {
    return [{ path: at('evals'), why: 'it holds the answer key the generator is graded against' }];
  }
  if (role === 'coach') {
    return [
      { path: at('evals', 'answer_key.md'), match: answerKeyFile, why: 'the coach works from the verifier\'s feedback, not the answer key' },
      { path: at('evals', 'answer_key.private.md'), why: 'the coach works from the verifier\'s feedback, not the answer key' },
      { path: at('evals', 'runs'), why: 'run results include the held-out cases' },
      { path: at('.claude', 'agents', 'verifier.md'), why: 'the coach doesn\'t get to study how answers are graded' },
    ];
  }
  return [];
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolves symlinks, also for files that don't exist yet (a Write that creates a file).
function real(p) {
  try { return fs.realpathSync(p); } catch { /* fall through */ }
  const parent = path.dirname(p);
  if (parent === p) return p;
  return path.join(real(parent), path.basename(p));
}

function main(raw) {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch {
    if (ROLES.includes(process.env.LOOP_ROLE)) fail('guard: the hook input was not valid JSON.');
    return;
  }
  let verdict;
  try { verdict = decide(input); } catch (err) {
    if (roleOf(input)) fail(`guard: ${err.message}`);
    return;
  }
  if (!verdict) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: verdict.reason,
    },
  }));
}

// Exit code 2 blocks the tool call and shows Claude the message.
function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => main(raw));
}
