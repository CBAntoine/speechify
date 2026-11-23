// Shared helpers for the Generator → Verifier → Coach loop (evals/loop.mjs).
// No dependencies beyond Node's built-ins.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROLES = ['generator', 'verifier', 'coach'];

export function paths(root) {
  const evals = path.join(root, 'evals');
  const agents = path.join(root, '.claude', 'agents');
  return {
    root,
    evals,
    agents,
    generator: path.join(agents, 'generator.md'),
    verifier: path.join(agents, 'verifier.md'),
    coach: path.join(agents, 'coach.md'),
    settings: path.join(root, '.claude', 'settings.json'),
    answerKey: path.join(evals, 'answer_key.md'),
    privateKey: path.join(evals, 'answer_key.private.md'),
    candidates: path.join(evals, 'candidates'),
    versions: path.join(evals, 'versions'),
    changelog: path.join(evals, 'versions', 'CHANGELOG.md'),
    runs: path.join(evals, 'runs'),
    guard: path.join(evals, 'guard.mjs'),
    loop: path.join(evals, 'loop.mjs'),
    lib: path.join(evals, 'lib.mjs'),
  };
}

export const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// The answer key: markdown tables with the columns
//   | ID | Question | Ideal answer | Must include | Held out |
// Column order doesn't matter and other columns (e.g. "Added") are ignored.
// Write `\|` for a literal pipe and `<br>` for a line break inside a cell.

const COLUMNS = {
  id: /^id$/i,
  question: /^question$/i,
  ideal: /^ideal\b/i,
  must: /^must\b/i,
  heldOut: /^held[\s-]?out$/i,
};

export function splitRow(line) {
  let s = line.trim();
  if (!s.startsWith('|')) return null;
  s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const cleanCell = (cell) => (cell || '').replace(/<br\s*\/?>/gi, '\n').trim();
const isSeparator = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');

export function parseAnswerKey(text, source = 'answer_key.md') {
  const cases = [];
  const errors = [];
  let header = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const cells = splitRow(line);
    if (!cells) { header = null; return; }
    if (isSeparator(cells)) return;
    if (!header) {
      const map = {};
      cells.forEach((cell, idx) => {
        for (const [key, re] of Object.entries(COLUMNS)) if (map[key] === undefined && re.test(cell)) map[key] = idx;
      });
      if (map.id !== undefined && map.question !== undefined && map.ideal !== undefined) header = map;
      return;
    }
    const get = (key) => (header[key] === undefined ? '' : cleanCell(cells[header[key]]));
    const id = get('id');
    if (!id) return;
    const at = `${source}:${i + 1}`;
    const c = {
      id,
      question: get('question'),
      ideal: get('ideal'),
      must: splitMust(get('must')),
      heldOut: /^(y|yes|true|x|✓|✔)$/i.test(get('heldOut')),
      source: at,
    };
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) errors.push(`${at}: the ID "${id}" should use only letters, numbers and dashes.`);
    if (!c.question) errors.push(`${at}: ${id} has no question.`);
    if (!c.ideal) errors.push(`${at}: ${id} has no ideal answer.`);
    cases.push(c);
  });
  return { cases, errors };
}

export function splitMust(text) {
  return text.split(/;|\n/).map((s) => s.trim()).filter(Boolean);
}

// Reads evals/answer_key.md plus the optional, git-ignored evals/answer_key.private.md.
export function loadAnswerKey(P) {
  const files = [P.answerKey, P.privateKey].filter((f) => fs.existsSync(f));
  const cases = [];
  const errors = [];
  let raw = '';
  if (!fs.existsSync(P.answerKey)) errors.push(`${path.relative(P.root, P.answerKey)} is missing.`);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    raw += text + '\0';
    const parsed = parseAnswerKey(text, path.relative(P.root, f).split(path.sep).join('/'));
    cases.push(...parsed.cases);
    errors.push(...parsed.errors);
  }
  const seen = new Map();
  for (const c of cases) {
    if (seen.has(c.id)) errors.push(`${c.source}: the ID ${c.id} is already used at ${seen.get(c.id)}.`);
    else seen.set(c.id, c.source);
  }
  if (!cases.length && !errors.length) errors.push('The answer key has no cases yet.');
  return { cases, errors, sha: sha(raw) };
}

// ---------------------------------------------------------------------------
// Agent definition files: YAML-ish frontmatter between --- lines, then the prompt.

export function splitAgent(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return { frontmatter: '', body: text };
  return { frontmatter: m[0], body: text.slice(m[0].length) };
}

// Enough of YAML for agent frontmatter: `key: value`, `key: [a, b]` and `key:` followed by `- item` lines.
export function parseFrontmatter(frontmatter) {
  const out = {};
  let listKey = null;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (/^---\s*$/.test(line) || !line.trim() || /^\s*#/.test(line)) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { out[listKey].push(unquote(item[1])); continue; }
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) { listKey = null; continue; }
    const [, key, value] = kv;
    if (value === '') { out[key] = []; listKey = key; continue; }
    listKey = null;
    if (/^\[.*\]$/.test(value)) out[key] = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    else out[key] = unquote(value);
  }
  return out;
}

const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2');

export const toolList = (tools) =>
  (Array.isArray(tools) ? tools : String(tools || '').split(',')).map((t) => t.trim()).filter(Boolean);

// The --agents JSON that runs an agent file under its own name, so the same definition
// (and the same guard rules) apply whether the file is the live generator or a draft.
export function agentsJson(text, { model } = {}) {
  const { frontmatter, body } = splitAgent(text);
  const fm = parseFrontmatter(frontmatter);
  const name = fm.name || 'generator';
  const def = { description: fm.description || name, prompt: body.trim() };
  const tools = toolList(fm.tools);
  if (tools.length) def.tools = tools;
  const disallowed = toolList(fm.disallowedTools);
  if (disallowed.length) def.disallowedTools = disallowed;
  const m = model || fm.model;
  if (m && m !== 'inherit') def.model = m;
  if (fm.maxTurns && /^\d+$/.test(fm.maxTurns)) def.maxTurns = Number(fm.maxTurns);
  if (fm.effort) def.effort = fm.effort;
  return { name, json: { [name]: def } };
}

// ---------------------------------------------------------------------------
// Line diffs, and the "one change per draft" check.

export function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: a[i++] });
    else ops.push({ t: '+', s: b[j++] });
  }
  while (i < n) ops.push({ t: '-', s: a[i++] });
  while (j < m) ops.push({ t: '+', s: b[j++] });
  return ops;
}

// Groups changed lines into places. Changes separated by `gap` or fewer unchanged lines
// count as one place (one Edit that keeps a line in the middle still reads as one change).
export function changeBlocks(ops, gap = 2) {
  const blocks = [];
  let cur = null;
  let unchanged = 0;
  for (const op of ops) {
    if (op.t === ' ') { unchanged++; continue; }
    if (cur && unchanged <= gap) cur.lines++;
    else { cur = { lines: 1 }; blocks.push(cur); }
    unchanged = 0;
  }
  return blocks;
}

export function unifiedDiff(ops, { context = 3, from = 'live', to = 'candidate' } = {}) {
  const changed = ops.map((o, k) => (o.t === ' ' ? -1 : k)).filter((k) => k >= 0);
  if (!changed.length) return '';
  const hunks = [];
  let start = changed[0];
  let end = changed[0];
  for (const k of changed.slice(1)) {
    if (k - end <= 2 * context) end = k;
    else { hunks.push([start, end]); start = end = k; }
  }
  hunks.push([start, end]);
  const out = [`--- ${from}`, `+++ ${to}`];
  for (const [s, e] of hunks) {
    const lo = Math.max(0, s - context);
    const hi = Math.min(ops.length - 1, e + context);
    let aLine = 1;
    let bLine = 1;
    for (let k = 0; k < lo; k++) {
      if (ops[k].t !== '+') aLine++;
      if (ops[k].t !== '-') bLine++;
    }
    let aCount = 0;
    let bCount = 0;
    const body = [];
    for (let k = lo; k <= hi; k++) {
      if (ops[k].t !== '+') aCount++;
      if (ops[k].t !== '-') bCount++;
      body.push(ops[k].t + ops[k].s);
    }
    out.push(`@@ -${aLine},${aCount} +${bLine},${bCount} @@`, ...body);
  }
  return out.join('\n');
}

export function checkCandidate(liveText, candText, { maxChangedLines = 40, gap = 2 } = {}) {
  const problems = [];
  if (splitAgent(liveText).frontmatter !== splitAgent(candText).frontmatter) {
    problems.push('the frontmatter changed (the lines between the --- markers must stay exactly as they are)');
  }
  const ops = diffLines(liveText.split('\n'), candText.split('\n'));
  const blocks = changeBlocks(ops, gap);
  const added = ops.filter((o) => o.t === '+').length;
  const removed = ops.filter((o) => o.t === '-').length;
  if (!blocks.length) problems.push('no change was made');
  if (blocks.length > 1) problems.push(`the draft changes ${blocks.length} separate places, and it must change exactly one`);
  if (added + removed > maxChangedLines) problems.push(`the change touches ${added + removed} lines, and the limit is ${maxChangedLines}`);
  return { ok: !problems.length, problems, places: blocks.length, added, removed, diff: unifiedDiff(ops) };
}

// ---------------------------------------------------------------------------
// Pulling the JSON an agent ends its reply with.

export function extractJson(text) {
  if (!text) return null;
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)].map((m) => m[1]);
  for (const candidate of fences.reverse()) {
    try { return JSON.parse(candidate); } catch { /* try the next one */ }
  }
  // No fenced block: widen from the last "{" until a span up to the last "}" parses.
  const end = text.lastIndexOf('}');
  let start = text.lastIndexOf('{');
  while (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* widen */ }
    if (start === 0) break;
    start = text.lastIndexOf('{', start - 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small utilities.

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const k = next++;
      results[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return results;
}

export const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

export const money = (usd) => `$${(usd || 0).toFixed(2)}`;

export function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
