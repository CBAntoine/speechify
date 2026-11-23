---
name: improve
description: Improve the generator agent (.claude/agents/generator.md) with the Generator → Verifier → Coach loop. Level 1 fixes it by hand from this conversation. Level 2, the default, has the three agents run on the answer key and propose one change for the user to approve. Level 3 runs unattended until every case passes, 10 iterations at most. Use when the generator got something wrong, or when asked to test, grade, tune or improve it.
argument-hint: "[1|2|3] [what went wrong]"
---

# Improve the generator

The loop has three agents in `.claude/agents/`:

- the **generator** answers teammates' questions the way the owner would;
- the **verifier** grades its answers against `evals/answer_key.md`, and only reads;
- the **coach** reads the verifier's feedback and drafts one change in `evals/candidates/`.

`evals/loop.mjs` runs each one as its own headless Claude Code session. `evals/guard.mjs`, a hook in `.claude/settings.json`, stops each agent from touching what it mustn't. `evals/README.md` has the details.

Pick the level from the arguments: `$ARGUMENTS`. If they give no level, use Level 1 when this conversation shows the generator getting something wrong, and Level 2 otherwise.

## Level 1: fix it by hand

Use this when the generator has just got something wrong in this conversation.

1. Work out the question, what the generator said, and the answer the user wanted. If the right answer isn't clear from the conversation, ask the user for it in their own words: they are the source of truth.
2. Add the case to the Questions table in `evals/answer_key.md` as a new row. It needs a short ID, the question as asked, the user's ideal answer and the points that decide right or wrong (under Must include). Put today's date and a few words under Added. If the answer is private, put the row in `evals/answer_key.private.md` instead, with the same columns: this repository is public, and git ignores that file.
3. Make the smallest change to `.claude/agents/generator.md` that fixes the cause, so similar questions go right too. Describe the behavior to change instead of pasting the answer in. Leave the frontmatter as it is.
4. Save the version: `node evals/loop.mjs snapshot --note "<what changed and why, in one sentence>"`.
5. Check the fix: `node evals/loop.mjs grade --only <the new ID>`. That's one generator run and one verifier run.
6. Tell the user what changed, and suggest a Level 2 run to make sure nothing else broke.

## Level 2: the loop proposes, the user decides (recommended)

1. Tell the user what a run does and what it costs. It makes about two generator runs per answer-key case, a few verifier runs and one coach run, each a headless Claude Code session on their account. `node evals/loop.mjs check` prints the exact counts.
2. Run `node evals/loop.mjs propose` with Bash in the background (`run_in_background: true`, `timeout: 3600000`). Don't wrap it in a subagent.
3. When it finishes, read the report it names (`evals/runs/<run>/report.md`).
4. Show the user, briefly:
   - the recommendation (promote or reject) and the gate's reason;
   - the score table: live against draft, for the cases the Coach sees and for the held-out ones;
   - the Coach's one change, as the diff from the report, with its summary, reason and risk;
   - the cases that changed verdict, and whether the re-run confirmed each one.
5. Ask the user to approve or reject the draft, with AskUserQuestion. Put the report's recommendation first and mark it "(Recommended)".
6. On approve, run `node evals/loop.mjs promote <draft-id>`. On reject, run `node evals/loop.mjs reject <draft-id> --reason "<the user's reason>"`. The next Coach sees the reason.

If the report says every case passes, or that only held-out cases fail, say so and suggest adding harder or similar questions to the answer key (`/interview` helps). If it says the Coach's draft was thrown away, show why and offer another run.

## Level 3: fully autonomous

Use it only when the user asks for Level 3 or for the loop to run unattended. It suits questions with clear-cut right answers.

1. Say what it does. It runs up to 10 iterations, each like a Level 2 run, and promotes every draft that fixes at least one case and breaks none. It stops when every case passes, when 3 drafts in a row fail the gate, or after 10 iterations. That can cost up to ten Level 2 runs. Get a yes.
2. Run `node evals/loop.mjs auto --max-iterations 10` with Bash in the background, with `timeout: 7200000`. Add `--budget-usd <n>` if the user gave a spending limit.
3. When it finishes, report its summary: what was promoted, what was rejected, why it stopped and the live version. The history is in `evals/versions/CHANGELOG.md`.

## Rules at every level

- At Levels 2 and 3, never edit `evals/answer_key.md`, `.claude/agents/verifier.md`, `.claude/agents/coach.md` or `.claude/agents/generator.md` yourself, and never write a draft in `evals/candidates/`. The loop and the user do that. The reports show you the held-out cases, and the Coach must not get them from you.
- Changing the answer key changes the test. Change it only when the user asks to, and say that you did.
- `node evals/loop.mjs rollback <version>` undoes a promotion. `node evals/loop.mjs status` shows where things stand.
