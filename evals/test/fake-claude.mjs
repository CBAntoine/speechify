#!/usr/bin/env node
// A stand-in for `claude -p`, so the loop's tests run without calling a model.
// It reads --agent and --agents from its arguments and the prompt from stdin, and
// plays each role by a simple rule:
//   generator  answers "Use FAKEKEY." only when its instructions contain "RULE: mention FAKEKEY",
//              and drops the word "fine" when they contain "RULE: never say fine".
//   verifier   passes a case when the answer contains every Must-include point.
//   coach      edits its draft the way FAKE_COACH says (default "good": adds the FAKEKEY rule).
// FAKE_FLAKY=1 makes the first draft run fail the "works" case once (a flip that doesn't hold up).
// FAKE_CLAUDE_LOG, if set, gets one JSON line per call.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('0.0.0 (fake Claude Code for tests)');
  process.exit(0);
}
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const role = flag('--agent');

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { prompt += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
      role, argv, loopRole: process.env.LOOP_ROLE, candidate: process.env.LOOP_CANDIDATE || null,
    }) + '\n');
  }
  const play = { generator, verifier, coach }[role];
  if (!play) return reply({ is_error: true, subtype: 'error_during_execution', result: `no agent called ${role}` });
  return reply({ result: play() });
});

function reply(fields) {
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0.001,
    modelUsage: { 'fake-model': {} }, permission_denials: [], ...fields,
  }));
}

function generator() {
  const agentsFile = flag('--agents');
  const body = JSON.parse(fs.readFileSync(agentsFile, 'utf8')).generator.prompt;
  const question = prompt.trim();
  const flaky = process.env.FAKE_FLAKY === '1' && question === 'Does it work?' &&
    agentsFile.split(/[\\/]/).includes('candidate');
  const parts = [];
  if (body.includes('RULE: mention FAKEKEY')) parts.push('Use FAKEKEY.');
  if (!body.includes('RULE: never say fine') && !flaky) parts.push('It works fine.');
  parts.push(`You asked: ${question}`);
  return parts.join(' ');
}

function verifier() {
  const grades = [...prompt.matchAll(/<case id="([^"]+)">([\s\S]*?)\n<\/case>/g)].map(([, id, body]) => {
    const must = (body.match(/<must_include>\n([\s\S]*?)\n<\/must_include>/)?.[1] || '')
      .split('\n').map((l) => l.replace(/^- /, '').trim()).filter((l) => l && !l.startsWith('('));
    const answer = body.match(/<generator_answer>\n([\s\S]*?)\n<\/generator_answer>/)?.[1] || '';
    const missing = must.filter((m) => !answer.toLowerCase().includes(m.toLowerCase()));
    return { id, verdict: missing.length ? 'fail' : 'pass', missing, wrong: [], reason: missing.length ? `It doesn't mention ${missing.join(', ')}.` : 'Every point is there.' };
  });
  return `Graded ${grades.length}.\n\n\`\`\`json\n${JSON.stringify({ grades })}\n\`\`\``;
}

function coach() {
  const root = process.cwd();
  const draft = path.join(root, process.env.LOOP_CANDIDATE);
  let text = fs.readFileSync(draft, 'utf8');
  const mode = process.env.FAKE_COACH || 'good';
  if (mode === 'good') text = `${text.trimEnd()}\n- RULE: mention FAKEKEY when someone asks about keys.\n`;
  if (mode === 'breaks') text = `${text.trimEnd()}\n- RULE: mention FAKEKEY when someone asks about keys.\n- RULE: never say fine.\n`;
  if (mode === 'two-places') {
    const lines = text.split('\n');
    const afterFrontmatter = lines.indexOf('---', 1) + 1;
    lines.splice(afterFrontmatter, 0, 'An extra opening line.');
    text = `${lines.join('\n').trimEnd()}\n- RULE: mention FAKEKEY when someone asks about keys.\n`;
  }
  if (mode === 'tamper') fs.appendFileSync(path.join(root, 'evals', 'answer_key.md'), '\n<!-- the coach was here -->\n');
  fs.writeFileSync(draft, text);
  const summary = { summary: 'Mention FAKEKEY when someone asks about keys.', hypothesis: 'Every failure is missing FAKEKEY.', targets: ['key-question'], risk: 'None expected.' };
  return `Done.\n\n\`\`\`json\n${JSON.stringify(summary)}\n\`\`\``;
}
