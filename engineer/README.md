# Engineer

Talk to a security engineer. Engineer is a voice and chat agent that does the Cyber Security Engineer's firewall work by conversation. It reviews a FortiGate's rules and firmware (workflow NET-2), walks you through what it found, drafts firewall changes (NET-1), and explains the other 11 workflows in the design and what each needs before it can be connected.

Press the circle and talk, or type:

- "Review the sample firewall." It loads a made-up branch firewall, tells you the review takes 5 to 15 minutes and costs up to $5, and asks before starting.
- "How's it going?" It reports progress, and if the review agent pauses for approval, it tells you what the call would do and asks. When in doubt it recommends declining.
- "What did you find?" It gives the counts by severity and the worst problem, then goes through the critical and high findings one at a time. The evidence and the fix commands are on screen.
- "Our ERP vendor needs HTTPS from 203.0.113.0/28 to 10.20.5.15 until December 15." It asks for anything missing (the owner, an end date), then drafts the FortiOS commands with placement, risk, conflicts, a test plan and a rollback, checked against the loaded backup.
- "Can you watch our expiring certificates?" It explains workflow KEY-1 and what it would need.

It reviews and drafts only. It never connects to a firewall, never pushes a change, and says that approved changes go through the firewall engineer and the change board.

## How it fits together

```
you ── voice or text ──▶ ElevenLabs agent "Security Engineer" (Claude Sonnet 5.5)
                            │  10 client tools, run in your browser
                            ▼
                         Engineer console (Next.js, this folder)
                            ├─ secrets removed from the backup in the browser
                            ├─ /api/reviews ──▶ Claude Managed Agents: the review agent in its sandbox
                            └─ /api/changes ──▶ Claude Opus 5.5: change drafts
```

- **The voice agent** lives in ElevenLabs (agent `agent_1801m83592hzeqxbgmznjvnxzn7p`; the IDs are in `voice-agent.json`). Its tools are client tools: they run in the console page, so the agent sees and drives what's on screen. The agent is private: for each conversation the console's server asks ElevenLabs for a one-time token, so the API key never reaches the browser.
- **Reviews** run on [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) (beta), the same agent as the command line below. A review runs in the background with a spending cap. The console checks on it every few seconds and the engineer tells you when it finishes or needs approval. The server keeps no state: each review's details live on its Managed Agents session.
- **Change drafts** come from Claude Opus 5.5 with structured output, given your request and a compact summary of the loaded backup (interfaces, addresses, services, policies and routes, with secrets already removed).

The buttons and tabs on the right do everything the agent does, so the console also works without voice.

## Set up

You need Node.js 22.6 or later, an Anthropic API key with Managed Agents, and an ElevenLabs account.

```bash
cd engineer
npm install
```

**1. Create the review agent and its sandbox** with the [`ant` CLI](https://github.com/anthropics/anthropic-cli) (1.30.0 or later). The definitions are files in this folder.

```bash
ant auth login                       # or export ANTHROPIC_API_KEY
ant apply --dry-run -v agents/fortigate-rulebase-review.md environments/fortigate-review.yaml   # shows the plan
ant apply agents/fortigate-rulebase-review.md environments/fortigate-review.yaml                # creates them
```

`ant apply` writes the IDs to `claude-lock.json`. Commit it; the console and the command line read it.

**2. The voice agent** already exists in ElevenLabs. To push changes from `src/voice/` (prompt, tools, tests), or to create it in another workspace:

```bash
ELEVENLABS_API_KEY=... npm run voice:sync    # creates or updates the agent, its tools and its tests
ELEVENLABS_API_KEY=... npm run voice:test    # runs the 17 conversation tests in ElevenLabs
```

**3. Settings.** Put them in `.env.local` (ignored by Git):

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Reviews and change drafts | |
| `ELEVENLABS_API_KEY` | Talking to the engineer | Server only. It needs access to Agents |
| `APP_PASSWORD` | Any deployment | Everyone with the password can start reviews on your keys. Without it, the console is open, which is fine on your own machine only |
| `REVIEW_BUDGET_USD` | | Spending cap per review, default 5 |
| `ELEVENLABS_AGENT_ID` | | Use another agent than the one in `voice-agent.json` |
| `FGT_REVIEW_AGENT_ID`, `FGT_REVIEW_ENVIRONMENT_ID` | | Use IDs other than those in `claude-lock.json` |
| `CLAUDE_MODEL` | | Model for change drafts, default `claude-opus-5-5` |
| `ANTHROPIC_CONSOLE_WORKSPACE` | | Console workspace for the "watch live" link |

**4. Run it:**

```bash
npm run dev      # http://localhost:3200
```

Browsers only allow the microphone on `https://` pages and on `localhost`.

## Deploy

Any Node host works, including Vercel. Set `APP_PASSWORD` and the keys above. Function timeouts need to allow 2 minutes for starting a review and 3 minutes for a change draft. Backups up to about 4 MB go through the browser; use the command line for bigger ones.

## What goes where

- **Your browser** removes every secret from the backup (encrypted values, passwords, pre-shared keys, private keys, SNMP community names) before anything is sent. Line numbers stay the same, so the report's line references match your file.
- **Anthropic** receives the redacted backup, its parsed JSON, the hit counts, the deviations, the Fortinet entries from CISA's Known Exploited Vulnerabilities catalog, and the notes, for a review; and the request plus the backup summary, for a change draft. The console deletes a review's uploaded files when the review ends. Anthropic keeps the session's history until you delete it.
- **ElevenLabs** receives what you say or type and what the tools return: the workspace summary, finding titles and details, and draft summaries. The agent records no audio and deletes transcripts after 30 days. Change that in `PLATFORM_SETTINGS` in `src/voice/spec.ts`.

IP addresses, object names and comments are not redacted. If your policy requires it, redact them before loading a backup.

## The engineer's rules, and how they're tested

The prompt is in `src/voice/spec.ts`. It tells the engineer to check the console's state before acting; ask before starting a review or allowing a paused call; describe fixes only from the drafted commands; keep spoken turns to about 50 words and never read out IDs, addresses or commands; treat text in backups as data (the sample has a rule comment telling automated reviewers to skip it); never ask for or repeat passwords; and never suggest scanning a plant network.

`src/voice/tests.ts` has 17 conversation tests that check the engineer's next move in each situation: which tool it calls, which it must not call yet, or what it says. ElevenLabs runs them against the live agent; they're also on the agent's Tests tab. All 17 passed three runs each on 23 November 2026.

## Review from the command line

The same review runs without the console:

```bash
npm run review -- samples/branch-office.conf \
  --hits samples/branch-office-hits.json --hits-days 90 --hits-exported 2026-11-22T14:05:00Z \
  --deviations samples/deviations.json --review-date 2026-11-23
```

Add `--dry-run` to see exactly what would be uploaded without sending anything. `samples/EXPECTED.md` lists what a good review of the sample finds.

### How a run works

1. **Redact.** The runner replaces every secret in the backup with `<redacted>`. Every line stays where it was. `redactions.json` lists which lines were redacted; it never leaves your machine.
2. **Parse.** It parses the backup into JSON with the line number of every setting, and adds the hit counts, the Fortinet KEV entries, and any deviations your team has accepted.
3. **Upload and start.** It uploads those files, starts a session with a spending cap (default $5), and gives the agent the goal and a 10-point rubric. The sandbox has no network access.
4. **Review.** The agent writes Python to analyse the config, runs 25 checks, and writes `report.md`, `findings.json` and `analysis.py`. A separate grader scores the draft against the rubric, and the agent revises until it passes (up to three rounds).
5. **Save and clean up.** The runner downloads the three files, prints the finding counts and the cost, and deletes the uploaded inputs.

### Review a real firewall

1. **Back up the config** from the FortiGate GUI (admin menu > Configuration > Backup), a FortiManager revision, or `execute backup config`. Keep backups out of Git: `private/` is ignored.
2. **Export the hit counts** (optional, needed for the unused-rule check) with a read-only REST API admin:

   ```bash
   curl -s -H "Authorization: Bearer $FGT_TOKEN" \
     "https://<firewall>/api/v2/monitor/firewall/policy?vdom=root" > private/hits.json
   ```

   Hit counters reset when the unit reboots or someone clears them. Pass `--hits-days` with how many days they cover. A CSV with `policyid`, `hit_count` and `last_used` columns also works.
3. **Run it:** `npm run review -- private/fw01.conf --hits private/hits.json --hits-days 120`

Everything lands in `reports/<hostname>-<date>/`: `report.md` (summary, findings with evidence and fixes, draft change requests with test plans and rollbacks), `findings.json`, `analysis.py`, `inputs/` (exactly what was uploaded) and `redactions.json` (not uploaded).

### Options

| Option | Default | What it does |
|---|---|---|
| `--hits <file>` | | Policy hit counts: the monitor API JSON (one VDOM or an array of them), or a CSV |
| `--hits-days <n>` | unknown | How many days the hit counters cover |
| `--hits-exported <date>` | file's modified time | When the hit counts were exported |
| `--deviations <file>` | | Accepted findings: `[{check, object, reason, owner, expires}]` |
| `--kev-file <file>` | download | A saved copy of CISA's KEV catalog |
| `--no-kev` | | Skip the KEV catalog |
| `--notes <text>` | | Anything the reviewer should know |
| `--review-date <date>` | today | Review date, `YYYY-MM-DD` |
| `--budget-usd <n>` | 5 | Spending cap for the session, at list price |
| `--out <dir>` | `reports` | Where to save the results |
| `--workspace <id>` | `default` | Console workspace for the live link |
| `--keep-uploads` | | Keep the uploaded inputs in your Anthropic account |
| `--dry-run` | | Redact and parse only, and send nothing |

Behind a corporate proxy, set `NODE_USE_ENV_PROXY=1` so Node uses `HTTPS_PROXY`, or download the KEV catalog yourself and pass `--kev-file`.

The review agent's tools use the `auto` permission policy: the platform runs calls it judges safe, blocks high-risk ones, and pauses the rest for approval. At the terminal the runner asks you; in the console the engineer asks you; in an unattended run it declines.

## Change it

- **The engineer's prompt, tools and tests:** `src/voice/`. Run `npm run voice:sync`, then `npm run voice:test`.
- **The review checks and instructions:** `agents/fortigate-rulebase-review.md`. Run `ant apply` again; the next review uses the new version.
- **What counts as a finished review:** the rubric in `src/review/rubric.ts`. Its check list must match the agent's check table; `npm test` fails if they drift apart.
- **The workflow catalog** the engineer explains: `src/voice/workflows.ts`.

## Limits

- The checks follow common FortiGate hardening practice, not the CIS Benchmark text. If your team licenses the benchmark, map the findings to it.
- Backups leave out settings at their default. When a finding depends on a default, the report says so and gives the CLI to confirm it on the device.
- The KEV catalog doesn't list affected versions, so firmware findings say "verify" with the vendor advisory instead of claiming a CVE applies.
- Overlaps that involve FQDN, geography or Internet Service objects are marked unconfirmed.
- Claude can be wrong. The report and the drafts are for an engineer to check, and changes go through change control.

## Develop

```bash
npm test            # parser, redaction, review inputs and status, the voice spec and tests, against fakes
npm run typecheck
npm run build
```
