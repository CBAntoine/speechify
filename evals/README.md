# The self-improving generator

Three Claude Code agents that make one agent better at its job, one tested change at a time.

| Agent | File | Job | Can it write? |
| --- | --- | --- | --- |
| Generator | `.claude/agents/generator.md` | Answers teammates' questions about this repository the way the owner would. | No. It has only Read, Grep and Glob. |
| Verifier | `.claude/agents/verifier.md` | Grades the generator's answers against the answer key as right or wrong, and says why each failure failed. | No. It has only Read, Grep and Glob. |
| Coach | `.claude/agents/coach.md` | Reads the Verifier's feedback and drafts one change to a copy of the generator. | Only its own draft in `evals/candidates/`. |

The answer key (`evals/answer_key.md`) is the test, and you are its source of truth. `evals/versions/` keeps every version of the generator that has been live. `evals/candidates/` keeps every draft the Coach wrote and what happened to it.

## Use it

In Claude Code, in this repository:

- **`/interview`**: Claude interviews you about how you answer your team. Then it writes the generator in your voice and puts your real questions in the answer key. Start here.
- **`/improve 1`**: the generator just got something wrong in the conversation. Claude adds the question to the answer key, fixes the generator and saves a version.
- **`/improve 2`** (recommended): the three agents run against the answer key and propose one change, with a report. You approve or reject it.
- **`/improve 3`**: the loop runs unattended. It promotes each draft that fixes a case and breaks none, until every case passes, for 10 iterations at most.

To use the generator itself, ask Claude something like "ask the generator how to deploy Rainmaker".

The same commands from a terminal:

```bash
node evals/loop.mjs check            # check the set-up; no model calls
node evals/loop.mjs grade            # how the live generator does right now
node evals/loop.mjs propose          # Level 2: one draft, tested, with a report
node evals/loop.mjs promote latest   # or: reject latest --reason "..."
node evals/loop.mjs auto             # Level 3
node evals/loop.mjs status           # live version, cases, drafts waiting for you
node evals/loop.mjs rollback v002    # undo a promotion
```

## What a run does

1. **Grade the live generator.** It answers every question in the answer key, each in its own headless Claude Code session (`claude -p --agent generator`). The Verifier grades the answers in batches. If the same generator, answer key and repository were measured in the last day, that measurement is reused.
2. **Draft one change.** The Coach gets the failures it's allowed to see, with the Verifier's reasons, the passing cases it mustn't break, and what earlier drafts tried. It edits a fresh copy of the generator at `evals/candidates/c-<run>.md`.
3. **Check that it's one change.** The loop compares the draft with the live generator line by line. A draft that changes more than one place, more than 40 lines or the frontmatter is thrown away, and the Coach gets one more try.
4. **Test the draft on every case**, held-out cases included.
5. **Re-run what flipped.** Both versions answer each case that went from fail to pass, or pass to fail, once more, and the Verifier grades it again. A flip that doesn't happen again is noise, and it doesn't count.
6. **Apply the gate.** A draft should be promoted only if it fixes at least one case and breaks none. At Level 2 that's the report's recommendation, and you decide. At Level 3 the loop decides.

Promoting copies the draft over `.claude/agents/generator.md`, saves it as the next `evals/versions/vNNN.md` and adds an entry to `evals/versions/CHANGELOG.md`. Rejected drafts are logged there too. The next Coach is told about them, so it tries something else.

## How the rules are enforced

The rules don't depend on the agents behaving:

- **The guard.** `evals/guard.mjs` runs as a PreToolUse hook, from `.claude/settings.json`. It rules only on calls from the three agents, and it leaves your own sessions and other agents alone.
  - The generator can't read anything under `evals/`, so it can't copy the ideal answers.
  - The Verifier can't write.
  - The Coach can write only its own draft. It can't read the answer key, the run results (they include the held-out cases) or the Verifier.
  - For the generator and the Coach, a content search over a folder that contains an off-limits file is blocked too, because the results would show that file's text.
- **The tools.** Each agent's frontmatter lists only the tools it needs. None of them has Bash.
- **The sessions.** Each role runs in its own `claude -p` session with `--permission-mode dontAsk --permission-prompts none`, so anything not allowed is refused without asking anyone. The Coach's session pre-approves edits to its one draft and nothing else. MCP servers are off (`--strict-mcp-config`), and so are your personal settings (`--setting-sources project,local`).
- **A double check.** After every step, the loop checks that the live generator, the answer key, the agent files, the guard, the settings and the saved versions haven't changed. If any of them did, the run stops, says which, and keeps a copy of the earlier content.
- **Held-out cases.** Rows marked Held out are graded on every run, but the Coach never sees them, and nothing it's shown names them. A draft that only teaches to the visible cases won't move them.

## The answer key

`evals/answer_key.md` explains its columns. Every time the generator gets something wrong, add the question as a new row (`/improve 1` does this for you). This repository is public, so put private rows in `evals/answer_key.private.md`. Git ignores that file, and the loop reads both.

## Costs and models

Every agent run is a Claude Code session on your account. A Level 2 run makes about two generator runs per case, a few Verifier runs and one Coach run, so about 45 sessions for the 20 starter cases, or about 25 when a recent measurement is reused. Each report shows the run's estimated cost at API list prices. On a Claude plan it comes out of your plan's usage instead. Each session also has its own spending cap (`--max-budget-usd`), and Level 3 takes `--budget-usd` for the whole loop.

For scale: in a test on Opus 5.5, a full Level 2 run on 3 cases took 2 minutes and came to an estimated $0.70. Each answer cost about $0.05 and took about 10 seconds, and grading cost about $0.04 a case. At that rate, a run on the 20 starter cases is roughly $3 to $4 and about 5 minutes, and about half that when a recent measurement is reused.

The generator uses your default model (`model: inherit`), so it's graded on the model it actually answers with. Pass `--model` to change it for one run, or change its frontmatter. The Verifier and the Coach use Opus.

The loop needs Claude Code installed and signed in on the machine that runs it (`claude --version`). It works in cloud sessions on claude.ai/code too.

## Files

| Path | What it is | In git? |
| --- | --- | --- |
| `evals/answer_key.md` | The test. | Yes |
| `evals/answer_key.private.md` | Private rows, if you have any. | No |
| `evals/versions/` | Every live version of the generator, and the CHANGELOG. | Yes |
| `evals/candidates/` | Every draft, with a `.json` of what happened to it. It never names held-out cases. | Yes |
| `evals/runs/` | The answers, grades, Coach prompts and report from each run. | No |
| `evals/loop.mjs`, `evals/lib.mjs` | The runner. | Yes |
| `evals/guard.mjs` | The hook that enforces the rules. | Yes |
| `evals/test/` | Tests, run against a fake `claude` (`npm run evals:test`). | Yes |
