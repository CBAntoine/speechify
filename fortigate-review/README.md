# FortiGate rulebase review

A Claude agent that does the monthly rulebase and firmware review of a FortiGate (workflow NET-2 in the Cyber Security Engineer workflow design). Give it a configuration backup and, if you have them, the policy hit counts. It finds problems across 25 checks, quotes the config lines behind each one, and drafts fixes as FortiOS CLI grouped into change requests. It changes nothing on the firewall: an engineer reviews the report, and approved fixes go through the normal change process.

It runs on [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview). Anthropic hosts the agent loop and the sandbox its tools run in. Managed Agents is in beta. It bills sandbox time on top of tokens, and it keeps each session's history until you delete it.

## How a run works

1. **Redact.** On your machine, the runner replaces every secret in the backup with `<redacted>`: encrypted values (`ENC ...`), passwords, pre-shared keys, private keys and SNMP community names. Every line stays where it was, so line numbers in the report match your original backup. `redactions.json` lists which lines were redacted; it never leaves your machine.
2. **Parse.** It parses the backup into JSON with the line number of every setting, and adds the hit counts, the Fortinet entries from CISA's Known Exploited Vulnerabilities catalog, and any deviations your team has accepted.
3. **Upload and start.** It uploads those files, starts a session with a spending cap (default $5), and gives the agent the goal plus a 10-point rubric. Its sandbox has no network access.
4. **Review.** The agent writes Python to analyse the config, runs the checks, and writes `report.md`, `findings.json` and `analysis.py`. A separate grader scores the draft against the rubric, and the agent revises until it passes (up to three rounds).
5. **Save and clean up.** The runner downloads the three files, prints the finding counts and the cost, and deletes the uploaded inputs from your Anthropic account.

You can watch the session live in the Console; the runner prints the link.

## Set up (once)

You need Node.js 22.6 or later and an Anthropic account with Managed Agents.

```bash
cd fortigate-review
npm install
```

**Credentials.** The runner and the `ant` CLI read `ANTHROPIC_API_KEY`, or the profile `ant auth login` creates.

**Create the agent and its sandbox** with the [`ant` CLI](https://github.com/anthropics/anthropic-cli) (version 1.30.0 or later). The definitions are files in this folder, so changes are reviewed like code.

```bash
brew install anthropics/tap/ant      # macOS. On Linux, download a release from GitHub
ant auth login                       # or export ANTHROPIC_API_KEY

ant apply --dry-run -v agents/fortigate-rulebase-review.md environments/fortigate-review.yaml   # shows the plan, changes nothing
ant apply agents/fortigate-rulebase-review.md environments/fortigate-review.yaml                # creates them
```

`ant apply` writes the agent and environment IDs to `claude-lock.json`. Commit that file: the runner reads the IDs from it, and the next `ant apply` updates the same agent instead of creating another. To use IDs from somewhere else, set `FGT_REVIEW_AGENT_ID` and `FGT_REVIEW_ENVIRONMENT_ID`.

## Try it on the sample

`samples/branch-office.conf` is a made-up branch firewall with problems planted in it. `samples/EXPECTED.md` lists what a good review finds.

```bash
npm run review -- samples/branch-office.conf \
  --hits samples/branch-office-hits.json --hits-days 90 --hits-exported 2026-11-22T14:05:00Z \
  --deviations samples/deviations.json --review-date 2026-11-23
```

Add `--dry-run` to see exactly what would be uploaded without sending anything.

## Review a real firewall

1. **Back up the config.** In the FortiGate GUI, use the admin menu > Configuration > Backup. You can also use a FortiManager revision, or `execute backup config` on the CLI. Keep backups out of Git: the `private/` folder here is ignored.
2. **Export the hit counts** (optional, needed for the unused-rule check). Use a read-only REST API admin:

   ```bash
   curl -s -H "Authorization: Bearer $FGT_TOKEN" \
     "https://<firewall>/api/v2/monitor/firewall/policy?vdom=root" > private/hits.json
   ```

   Hit counters reset when the unit reboots or someone clears them. Pass `--hits-days` with how many days they cover; without it, the agent says the 90-day check may be incomplete. A CSV with `policyid`, `hit_count` and `last_used` columns also works.
3. **Run it:**

   ```bash
   npm run review -- private/fw01.conf --hits private/hits.json --hits-days 120
   ```

Everything lands in `reports/<hostname>-<date>/`:

| File | What it is |
|---|---|
| `report.md` | Summary for a manager, findings with evidence and fixes, draft change requests with test plans and rollbacks |
| `findings.json` | The same findings as data, for a ticketing system or a dashboard |
| `analysis.py` | The code the agent used, so the review can be checked and rerun |
| `inputs/` | Exactly what was uploaded |
| `redactions.json` | Which lines were redacted (not the values). Not uploaded |

## Options

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

## What leaves your machine

- **Sent:** the redacted backup, its parsed JSON, the hit counts, the deviations, the Fortinet KEV entries and `run.json` (device name, review date, your notes, which settings were redacted). IP addresses, object names and comments are not redacted. If your policy requires it, redact them before running.
- **Not sent:** secret values, `redactions.json`, and the original backup.
- **Kept by Anthropic:** the session's history, until you delete it with `ant beta:sessions delete --session-id <id>`. The uploaded inputs are deleted when the run ends unless you pass `--keep-uploads`.

The agent's tools use the `auto` permission policy: the platform runs calls it judges safe, blocks high-risk ones, and pauses the rest for approval. When a call pauses, the runner asks you at the terminal; in an unattended run it declines.

## Change what it checks

- **Checks and instructions:** `agents/fortigate-rulebase-review.md`. After editing, run `ant apply` again; the agent gets a new version and the next run uses it.
- **What counts as done:** the rubric in `src/rubric.ts`. The check list in the rubric must match the agent's check table; `npm test` fails if they drift apart.

## Limits

- The checks follow common FortiGate hardening practice. They are not the CIS Benchmark text; if your team licenses the benchmark, map the findings to it.
- Backups leave out settings at their default. When a finding depends on a default, the report says so and gives the CLI to confirm it on the device.
- The KEV catalog doesn't list affected versions, so firmware findings say "verify" with the vendor advisory instead of claiming a CVE applies.
- Overlaps that involve FQDN, geography or Internet Service objects are marked unconfirmed.
- Claude can be wrong. The report is a draft for an engineer, and the fixes go through change control.

## Next step: monthly and hands-off

To run on the 1st of every month without anyone exporting files, move tool execution inside the management network with a [self-hosted sandbox](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes). A worker there pulls the backup and hit counts from FortiManager with read-only tokens and connects out to Anthropic, so the firewall needs no inbound rule. A scheduled deployment then starts the session with cron `0 6 1 * *` in `America/Toronto`.

## Develop

```bash
npm test          # parser, redaction, inputs, and the session loop against a fake API
npm run typecheck
```
