/**
 * Run one FortiGate rulebase review.
 *
 *   npm run review -- <backup.conf> [options]
 *
 * Redacts secrets on this machine, parses the backup, uploads the redacted
 * copy to a Claude Managed Agents session, follows the agent while it works,
 * and saves report.md, findings.json and analysis.py under reports/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { buildBundle, BundleError, type Bundle } from "./bundle.ts";
import { downloadFortinetKev, fortinetKev, type KevFile } from "./kev.ts";
import { loadIds, AGENT_FILE, ENVIRONMENT_FILE } from "./ids.ts";
import { outcomeEvent, startReview } from "./runs.ts";
import { downloadOutputs, follow, terminalApprover, type Printer } from "./session.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const USAGE = `Review a FortiGate rulebase and firmware with a Claude agent.

Usage:
  npm run review -- <backup.conf> [options]

Options:
  --hits <file>           Policy hit counts: the JSON from GET /api/v2/monitor/firewall/policy, or a CSV
  --hits-days <n>         How many days the hit counters cover (they reset when the unit reboots)
  --hits-exported <date>  When the hit counts were exported (default: the file's modified time)
  --deviations <file>     Findings the team has accepted (JSON array of {check, object, reason, owner, expires})
  --kev-file <file>       Use a saved copy of CISA's KEV catalog instead of downloading it
  --no-kev                Skip the KEV catalog
  --notes <text>          Anything the reviewer should know, passed to the agent
  --review-date <date>    Review date, YYYY-MM-DD (default: today)
  --budget-usd <n>        Spending cap for this run, in US dollars (default: 5)
  --out <dir>             Where to save the bundle and the report (default: reports)
  --workspace <id>        Console workspace for the live link (default: default)
  --keep-uploads          Keep the uploaded inputs in your Anthropic account after the run
  --dry-run               Redact and parse only. Writes what would be uploaded and sends nothing
  -h, --help              Show this help`;

const isTty = Boolean(process.stdout.isTTY);
const dim = (s: string) => (isTty ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (isTty ? `\x1b[1m${s}\x1b[0m` : s);
const pad = (n: number) => String(n).padStart(2, "0");

const print: Printer = {
  message: (text) => console.log(`\n${text}`),
  detail: (text) => console.log(dim(`  ${text}`)),
  heading: (text) => console.log(bold(`\n${text}`)),
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "fortigate";
}

/** A path relative to the current folder when it's inside it, absolute otherwise. */
function shown(p: string): string {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : p;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

interface Options {
  configPath: string;
  hits?: string;
  hitsDays: number | null;
  hitsExported?: string;
  deviations?: string;
  kevFile?: string;
  noKev: boolean;
  notes: string;
  reviewDate: string;
  budgetCents: number;
  out: string;
  workspace: string;
  keepUploads: boolean;
  dryRun: boolean;
}

function readOptions(): Options {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      hits: { type: "string" },
      "hits-days": { type: "string" },
      "hits-exported": { type: "string" },
      deviations: { type: "string" },
      "kev-file": { type: "string" },
      "no-kev": { type: "boolean", default: false },
      notes: { type: "string", default: "" },
      "review-date": { type: "string" },
      "budget-usd": { type: "string", default: "5" },
      out: { type: "string", default: "reports" },
      workspace: { type: "string", default: "default" },
      "keep-uploads": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const reviewDate = values["review-date"] ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) fail("--review-date must look like 2026-11-23.");
  const budget = Number(values["budget-usd"]);
  if (!Number.isFinite(budget) || budget <= 0) fail("--budget-usd must be a positive number of dollars.");
  let hitsDays: number | null = null;
  if (values["hits-days"] !== undefined) {
    hitsDays = Number(values["hits-days"]);
    if (!Number.isInteger(hitsDays) || hitsDays <= 0) fail("--hits-days must be a whole number of days.");
  }
  if (values["hits-exported"] !== undefined && Number.isNaN(new Date(values["hits-exported"]).getTime())) {
    fail("--hits-exported must be a date, such as 2026-11-22T14:05:00Z.");
  }
  return {
    configPath: path.resolve(positionals[0]),
    hits: values.hits,
    hitsDays,
    hitsExported: values["hits-exported"],
    deviations: values.deviations,
    kevFile: values["kev-file"],
    noKev: values["no-kev"],
    notes: values.notes,
    reviewDate,
    budgetCents: Math.round(budget * 100),
    out: path.resolve(values.out),
    workspace: values.workspace,
    keepUploads: values["keep-uploads"],
    dryRun: values["dry-run"],
  };
}

interface Staged {
  dir: string;
  bundle: Bundle;
}

function readText(file: string): string {
  if (!fs.existsSync(file)) fail(`Can't find ${file}.`);
  return fs.readFileSync(file, "utf8");
}

/** Redact, parse and stage every input under <out>/<device>-<date>/inputs/. */
async function prepare(opts: Options): Promise<Staged> {
  let kev: KevFile | null = null;
  if (opts.kevFile) {
    kev = fortinetKev(JSON.parse(readText(opts.kevFile)), path.basename(opts.kevFile));
  } else if (!opts.noKev) {
    try {
      kev = await downloadFortinetKev();
    } catch (err) {
      console.warn(
        `Couldn't download CISA's KEV catalog (${(err as Error).message}). Continuing without it. ` +
          "Behind a proxy, set NODE_USE_ENV_PROXY=1, or download the catalog yourself and pass --kev-file.",
      );
    }
  }

  let bundle: Bundle;
  try {
    bundle = buildBundle({
      configText: readText(opts.configPath),
      configName: path.basename(opts.configPath),
      hits: opts.hits
        ? {
            text: readText(opts.hits),
            name: path.basename(opts.hits),
            periodDays: opts.hitsDays,
            exportedAt: opts.hitsExported ? new Date(opts.hitsExported).toISOString() : fs.statSync(opts.hits).mtime.toISOString(),
          }
        : undefined,
      deviations: opts.deviations ? { text: readText(opts.deviations), name: path.basename(opts.deviations) } : undefined,
      kev,
      notes: opts.notes,
      reviewDate: opts.reviewDate,
    });
  } catch (err) {
    if (err instanceof BundleError) fail(err.message);
    throw err;
  }

  let dir = path.join(opts.out, `${slug(bundle.device)}-${opts.reviewDate}`);
  if (fs.existsSync(dir)) {
    const d = new Date();
    dir = `${dir}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  const inputs = path.join(dir, "inputs");
  fs.mkdirSync(inputs, { recursive: true });
  for (const f of bundle.files) fs.writeFileSync(path.join(inputs, f.name), f.content);
  // Kept on this machine only: which lines were redacted, never the values.
  fs.writeFileSync(path.join(dir, "redactions.json"), JSON.stringify(bundle.redactions, null, 2));

  const { summary } = bundle;
  const policies = Object.entries(summary.policies).map(([v, n]) => `${n} in ${v}`).join(", ") || "none";
  const n = bundle.redactions.length;
  console.log(bold(bundle.device) + dim(`  ${summary.model ?? "unknown model"}, FortiOS ${summary.version ?? "?"} build ${summary.build ?? "?"}`));
  console.log(`  ${bundle.lineCount} lines, policies: ${policies}, ${summary.addresses} addresses`);
  console.log(`  Redacted ${n} secret${n === 1 ? "" : "s"} before upload. The list of lines is in ${shown(path.join(dir, "redactions.json"))}`);
  if (bundle.warnings.length) console.log(`  Parser warnings: ${bundle.warnings.length} (listed in config.json)`);
  console.log(`  Inputs: ${bundle.files.map((f) => f.name).join(", ")}`);
  return { dir, bundle };
}

function printFindings(dir: string) {
  const p = path.join(dir, "findings.json");
  if (!fs.existsSync(p)) return;
  try {
    const f = JSON.parse(fs.readFileSync(p, "utf8")) as { summary?: Record<string, number> };
    const s = f.summary ?? {};
    const parts = ["critical", "high", "medium", "low", "info"].filter((k) => s[k]).map((k) => `${s[k]} ${k}`);
    console.log(bold(`Findings: ${parts.join(", ") || "none"}`));
  } catch {
    console.log("findings.json isn't valid JSON; read report.md instead.");
  }
}

async function main() {
  const opts = readOptions();
  // Check for the agent before writing anything, so a failed start leaves no files behind.
  const ids = opts.dryRun ? null : loadIds(ROOT);
  if (ids && "error" in ids) fail(ids.error);

  const { dir, bundle } = await prepare(opts);
  if (!ids) {
    console.log(`\nDry run: nothing was sent. The files that would be uploaded are in ${shown(path.join(dir, "inputs"))}`);
    return;
  }

  const client = new Anthropic();
  const uploaded: string[] = [];
  let exitCode = 0;
  try {
    const started = await startReview(client, ids, bundle, { budgetCents: opts.budgetCents, kickoff: false, source: "cli" });
    uploaded.push(...started.uploaded);
    const session = { id: started.sessionId };
    console.log(`\nSession ${session.id}, spending cap $${(opts.budgetCents / 100).toFixed(2)}`);
    console.log(`Watch it live: https://platform.claude.com/workspaces/${opts.workspace}/sessions/${session.id}`);

    let interrupted = false;
    process.on("SIGINT", () => {
      if (interrupted) process.exit(130);
      interrupted = true;
      console.log("\nStopping the agent. Press Ctrl+C again to quit without saving its outputs.");
      client.beta.sessions.events.send(session.id, { events: [{ type: "user.interrupt" }] }).catch(() => {});
    });

    const kickoff = async () => {
      await client.beta.sessions.events.send(session.id, { events: [outcomeEvent(bundle)] });
    };
    const ending = await follow(client, session.id, kickoff, {
      approve: terminalApprover,
      print,
      unattended: !process.stdin.isTTY,
    });

    const saved = await downloadOutputs(client, session.id, dir);
    const finished = await client.beta.sessions.retrieve(session.id);
    const cost = finished.usage?.list_cost;

    console.log("");
    if (ending.stopReason === "budget_reached") {
      console.log(`The run reached its $${(opts.budgetCents / 100).toFixed(2)} cap and paused. Run again with a higher --budget-usd.`);
      exitCode = 2;
    } else if (ending.stopReason === "refusal") {
      console.log("Claude declined to continue this review. Check the session in the Console.");
      exitCode = 2;
    } else if (ending.stopReason !== "end_turn") {
      console.log(`The session stopped early (${ending.stopReason}).`);
      exitCode = 2;
    } else if (ending.outcome && ending.outcome !== "satisfied") {
      console.log(`The report didn't fully meet the rubric (${ending.outcome.replace(/_/g, " ")}). Read it with that in mind.`);
      exitCode = 2;
    }
    printFindings(dir);
    if (saved.length) {
      console.log(`Saved to ${shown(dir)}: ${saved.join(", ")}`);
    } else {
      console.log("The agent didn't save any output files.");
      exitCode = exitCode || 2;
    }
    if (cost) console.log(dim(`Cost at list price: $${(Number(cost.amount) / 100).toFixed(2)} ${cost.currency}`));
    console.log(dim(`The session keeps its history until you delete it: ant beta:sessions delete --session-id ${session.id}`));
  } finally {
    if (!opts.keepUploads) {
      for (const id of uploaded) await client.files.delete(id).catch(() => {});
    }
  }
  process.exitCode = exitCode;
}

main().catch((err: unknown) => {
  if (err instanceof Anthropic.AuthenticationError) {
    fail("Anthropic rejected the credentials. Set ANTHROPIC_API_KEY, or run `ant auth login`.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    fail(`Anthropic couldn't find the agent or environment. Run \`ant apply ${AGENT_FILE} ${ENVIRONMENT_FILE}\` from the engineer folder.\n${err.message}`);
  }
  if (err instanceof Anthropic.APIError) fail(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
  fail(err instanceof Error ? err.message : String(err));
});
