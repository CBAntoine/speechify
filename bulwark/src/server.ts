// The dashboard: a small web server on 127.0.0.1 that only answers requests carrying its token.
//
// It can change system settings when Bulwark runs as admin, so it guards against the ways a
// web page you visit could try to reach it: it refuses unexpected Host headers (DNS rebinding),
// needs a secret token on every API call (so other sites can't send requests), sends no CORS
// headers, and only accepts JSON. Fix requests name a finding; what the fix does comes from
// Bulwark's own scan and a fresh re-check, never from the request.

import { randomInt, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ADB_INSTALL_HINT, adbConnect, adbDevices, adbPair, findAdb } from "./android/adb.ts";
import { isSelfSerial } from "./android/scan.ts";
import { FIXES } from "./checks/index.ts";
import { applyFix, FixError, planFix, refreshFindings, rollbackChange, safeBatches } from "./core/fixer.ts";
import { markdownReport } from "./core/report.ts";
import { allFindings, deviceInfo, runScan, type ScanProgress } from "./core/scan.ts";
import type { StateStore } from "./core/state.ts";
import type { ChangeRecord, Finding, Host, Scan } from "./core/types.ts";
import { errorMessage, randomId } from "./core/util.ts";
import { arpTable, defaultGateway, localNetworks } from "./net/local.ts";
import { defaultTargets } from "./net/scan.ts";
import { defaultCodeRoots } from "./software/deps.ts";
import { isPrivate, resolveTargets } from "./net/scope.ts";
import type { SsdpReply } from "./net/ssdp.ts";
import { VERSION } from "./version.ts";

const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));
const STATIC: Record<string, string> = { "/": "index.html", "/app.js": "app.js", "/app.css": "app.css", "/favicon.svg": "favicon.svg" };
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

interface Job {
  id: string;
  kind: "scan" | "fix" | "fix-all" | "rollback";
  status: "running" | "done" | "error";
  progress?: ScanProgress;
  result?: unknown;
  error?: string;
  startedAt: string;
}

export interface ServerOptions {
  host: Host;
  state: StateStore;
  port: number;
  bind: string;
  /** Also listen on this device's Wi-Fi/LAN addresses, so a TV or tablet can open the dashboard. */
  lan?: boolean;
  /** Demo mode: scans only ever cover this pretend network (and these pretend code projects and TV). */
  demo?: { targets: string[]; extraSsdp: SsdpReply[]; codeRoots?: string[]; android?: boolean };
}

/**
 * A one-time sign-in code for the dashboard, for devices where typing the long link is a pain
 * (a TV remote). It works once, for 30 minutes, and five wrong guesses switch it off.
 */
export class LoginCode {
  readonly code: string;
  private expires: number;
  private attempts = 0;
  private used = false;

  constructor(code = String(randomInt(0, 1_000_000)).padStart(6, "0"), ttlMs = 30 * 60_000) {
    this.code = code;
    this.expires = Date.now() + ttlMs;
  }

  get pretty(): string {
    return `${this.code.slice(0, 3)} ${this.code.slice(3)}`;
  }

  /** "ok", or why the code can't be used. */
  check(given: string): "ok" | "wrong" | "off" {
    if (this.used || this.attempts >= 5 || Date.now() > this.expires) return "off";
    const a = Buffer.from(given.replace(/\s+/g, ""));
    const b = Buffer.from(this.code);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      this.used = true;
      return "ok";
    }
    this.attempts++;
    return this.attempts >= 5 ? "off" : "wrong";
  }
}

class HttpError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function send(res: http.ServerResponse, status: number, body: string | Buffer, type = "application/json; charset=utf-8", extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

const json = (res: http.ServerResponse, status: number, data: unknown) => send(res, status, JSON.stringify(data));

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Send JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

function tokenOk(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** This device's addresses on its Wi-Fi or wired network (never mobile data or VPNs). */
export function lanAddresses(): string[] {
  return [...new Set(localNetworks().filter((n) => n.private).map((n) => n.address))];
}

export function allowedHosts(bind: string, port: number, lan: string[] = []): Set<string> {
  const set = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...lan.map((a) => `${a}:${port}`)]);
  if (bind !== "127.0.0.1" && bind !== "localhost") {
    if (bind === "0.0.0.0") {
      for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs ?? []) if (a.family === "IPv4") set.add(`${a.address}:${port}`);
    } else set.add(`${bind}:${port}`);
  }
  return set;
}

export function createApp(opts: ServerOptions & { token: string; loginCode?: LoginCode; lanAddresses?: string[] }) {
  const { host, state, token } = opts;
  const hosts = allowedHosts(opts.bind, opts.port, opts.lanAddresses);
  const jobs = new Map<string, Job>();
  let running: Job | null = null;

  const startJob = (kind: Job["kind"], work: (job: Job) => Promise<unknown>): Job => {
    if (running) throw new HttpError(409, "Bulwark is busy with another task. Wait for it to finish.", "busy");
    const job: Job = { id: randomId(8), kind, status: "running", startedAt: new Date().toISOString() };
    jobs.set(job.id, job);
    running = job;
    work(job)
      .then((r) => {
        job.result = r;
        job.status = "done";
      })
      .catch((err) => {
        job.error = errorMessage(err);
        job.status = "error";
      })
      .finally(() => {
        running = null;
        // Keep the last few jobs around for the page to read.
        const ids = [...jobs.keys()];
        for (const old of ids.slice(0, Math.max(0, ids.length - 20))) jobs.delete(old);
      });
    return job;
  };

  async function latest(): Promise<Scan> {
    const s = await state.latestScan();
    if (!s) throw new HttpError(409, "Run a scan first.", "no-scan");
    return s;
  }

  async function findingsFor(ids: unknown): Promise<Finding[]> {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((i) => typeof i === "string")) throw new HttpError(400, "Say which findings.");
    const all = allFindings(await latest());
    const out = ids.map((id) => {
      const f = all.find((x) => x.id === id && x.status === "fail");
      if (!f) throw new HttpError(404, "That problem isn't in the latest scan. Scan again.");
      if (!f.remedy?.auto) throw new HttpError(400, `"${f.title}" has no automatic fix.`);
      return f;
    });
    const fixIds = new Set(out.map((f) => f.remedy!.auto!.fixId));
    if (fixIds.size > 1) throw new HttpError(400, "Fix these one at a time.");
    if (out.length > 1 && !FIXES.get([...fixIds][0])?.merge) throw new HttpError(400, "Fix these one at a time.");
    return out;
  }

  async function networkKeys(targets: string[]): Promise<string[]> {
    const gw = await defaultGateway(host);
    const mac = gw ? (await arpTable(host)).get(gw) : undefined;
    return targets.map((t) => `${t}${mac ? `@${mac}` : ""}`);
  }

  async function needAdb(): Promise<string> {
    const adb = await findAdb(host);
    if (!adb) throw new HttpError(400, `adb isn't installed. ${ADB_INSTALL_HINT}`, "no-adb");
    return adb;
  }

  const routes: Record<string, (req: http.IncomingMessage, url: URL) => Promise<unknown>> = {
    "GET /api/state": async () => {
      const [scan, changes, device] = await Promise.all([state.latestScan(), state.listChanges(), deviceInfo(host)]);
      const def = opts.demo ? { targets: opts.demo.targets, skipped: [] } : defaultTargets();
      const known = await state.confirmedNetworks();
      const keys = await networkKeys(def.targets);
      return {
        demo: !!opts.demo,
        version: VERSION,
        device,
        stateDir: state.dir,
        scan,
        changes: changes.slice(0, 100),
        safeFixes: [...FIXES.values()].filter((f) => f.risk === "safe").map((f) => f.id),
        network: { targets: def.targets, skipped: def.skipped, confirmed: opts.demo ? def.targets : def.targets.filter((_, i) => known.includes(keys[i])) },
        code: { defaultRoots: opts.demo ? opts.demo.codeRoots ?? [] : await defaultCodeRoots(host) },
        android: { adb: opts.demo ? !!opts.demo.android : !!(await findAdb(host)), hint: ADB_INSTALL_HINT },
        rootFixes: [...FIXES.values()].filter((f) => f.needsRoot).map((f) => f.id),
        job: running ? { id: running.id, kind: running.kind } : null,
      };
    },
    "GET /api/scans": async () =>
      (await state.listScans()).map((s) => ({ id: s.id, startedAt: s.startedAt, scores: s.scores, local: !!s.local, devices: s.network?.devices.length ?? 0, android: s.android?.devices.length ?? 0 })),
    "GET /api/android": async () => {
      const adb = await findAdb(host);
      if (!adb) return { adb: false, hint: ADB_INSTALL_HINT, devices: [] };
      return { adb: true, devices: (await adbDevices(host, adb)).map((d) => ({ ...d, self: isSelfSerial(d.serial) })) };
    },
    "POST /api/android/connect": async (req) => {
      const body = await readJson(req);
      if (typeof body.address !== "string" || !body.address.trim() || body.address.length > 300) throw new HttpError(400, "Enter the device's address.");
      return adbConnect(host, await needAdb(), body.address);
    },
    "POST /api/android/pair": async (req) => {
      const body = await readJson(req);
      if (typeof body.address !== "string" || typeof body.code !== "string" || body.address.length > 300 || body.code.length > 20) throw new HttpError(400, "Enter the pairing address and code.");
      return adbPair(host, await needAdb(), body.address, body.code);
    },
    "POST /api/scan": async (req) => {
      const body = await readJson(req);
      if (opts.demo) {
        const demo = opts.demo;
        const job = startJob("scan", async (j) => {
          const scan = await runScan(host, {
            local: false,
            code: demo.codeRoots?.length ? { roots: demo.codeRoots, cacheDir: path.join(state.dir, "osv-cache") } : undefined,
            network: { targets: demo.targets, authorized: false, confirmedOwnership: true, noMulticast: true, extraSsdp: demo.extraSsdp },
            android: !!demo.android,
            onProgress: (p) => (j.progress = p),
          });
          await state.saveScan(scan);
          return { scanId: scan.id };
        });
        return { jobId: job.id };
      }
      const local = body.local !== false;
      const wantNet = body.network === true;
      let network: Parameters<typeof runScan>[1]["network"];
      if (wantNet) {
        const typed = Array.isArray(body.targets) ? body.targets.filter((t): t is string => typeof t === "string" && t.length < 200).slice(0, 20) : [];
        const targets = typed.length ? typed : defaultTargets().targets;
        if (!targets.length) throw new HttpError(400, "No private network found to scan. Enter the addresses to check.");
        const keys = await networkKeys(targets);
        const known = await state.confirmedNetworks();
        if (body.confirmOwnership !== true && !keys.every((k) => known.includes(k))) {
          throw new HttpError(400, "Confirm this is your network (or that you have permission to scan it).", "confirm-network", { targets });
        }
        const resolved = await resolveTargets(targets, { authorized: body.authorized === true });
        if (!resolved.addresses.length) throw new HttpError(400, resolved.errors.join(" ") || "Nothing to scan.");
        if (resolved.errors.some((e) => /public internet/.test(e))) throw new HttpError(400, resolved.errors.find((e) => /public internet/.test(e))!, "authorize-public");
        for (const k of keys) await state.confirmNetwork(k);
        network = { targets, authorized: body.authorized === true, confirmedOwnership: true };
      }
      let code: Parameters<typeof runScan>[1]["code"];
      if (body.code === true) {
        const typed = Array.isArray(body.codeRoots) ? body.codeRoots.filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.length < 1000).slice(0, 10) : [];
        const home = (await defaultCodeRoots(host))[0];
        const roots = (typed.length ? typed : await defaultCodeRoots(host)).map((r) => path.resolve(r.trim().replace(/^~(?=$|[\\/])/, home)));
        code = { roots, cacheDir: path.join(state.dir, "osv-cache") };
      }
      const android = body.android === true;
      if (!local && !network && !code && !android) throw new HttpError(400, "Choose what to scan.");
      const job = startJob("scan", async (j) => {
        const scan = await runScan(host, { local, code, network, android, onProgress: (p) => (j.progress = p) });
        await state.saveScan(scan);
        return { scanId: scan.id };
      });
      return { jobId: job.id };
    },
    "POST /api/plan": async (req) => {
      const body = await readJson(req);
      const found = await findingsFor(body.findingIds);
      const fresh = await refreshFindings(host, found);
      if (!fresh.length) return { alreadyFixed: true };
      return planFix(host, fresh);
    },
    "POST /api/fix": async (req) => {
      const body = await readJson(req);
      const found = await findingsFor(body.findingIds);
      const job = startJob("fix", async () => {
        const fresh = await refreshFindings(host, found);
        if (!fresh.length) return { alreadyFixed: true };
        return applyFix(host, state, fresh);
      });
      return { jobId: job.id };
    },
    "POST /api/fix-all-safe": async () => {
      const scan = await latest();
      const batches = safeBatches(allFindings(scan));
      if (!batches.length) throw new HttpError(400, "There are no low-risk automatic fixes to apply.");
      const job = startJob("fix-all", async (j) => {
        const results: (ChangeRecord | { title: string; skipped: string })[] = [];
        let i = 0;
        for (const b of batches) {
          j.progress = { phase: "fix", done: i++, total: batches.length, message: b[0].title };
          const fresh = await refreshFindings(host, b);
          if (!fresh.length) continue;
          const plan = await planFix(host, fresh);
          if (!plan.canApply) {
            results.push({ title: plan.title, skipped: plan.blockedReason ?? "Can't apply." });
            continue;
          }
          results.push(await applyFix(host, state, fresh));
        }
        return { results };
      });
      return { jobId: job.id };
    },
    "POST /api/rollback": async (req) => {
      const body = await readJson(req);
      if (typeof body.changeId !== "string") throw new HttpError(400, "Say which change.");
      const id = body.changeId;
      const job = startJob("rollback", () => rollbackChange(host, state, id, { force: body.force === true }));
      return { jobId: job.id };
    },
  };

  return async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (!hosts.has(String(req.headers.host ?? ""))) {
        send(res, 421, "Unexpected Host header.", "text/plain; charset=utf-8");
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (method === "GET" && STATIC[url.pathname]) {
        const file = path.join(UI_DIR, STATIC[url.pathname]);
        send(res, 200, await fs.readFile(file), TYPES[path.extname(file)] ?? "application/octet-stream");
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        send(res, 404, "Not found.", "text/plain; charset=utf-8");
        return;
      }
      if (method === "POST" && url.pathname === "/api/login") {
        const body = await readJson(req);
        const result = opts.loginCode && typeof body.code === "string" && body.code.length < 20 ? opts.loginCode.check(body.code) : "off";
        if (result === "ok") json(res, 200, { key: token });
        else if (result === "wrong") json(res, 403, { error: "That code isn't right. Check the code Bulwark printed and try again.", code: "wrong-code" });
        else json(res, 403, { error: "Sign-in codes are off. Start Bulwark with ./bulwark serve --lan to get a new one, or open the full link it printed.", code: "codes-off" });
        return;
      }
      const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!tokenOk(auth, token)) {
        json(res, 401, { error: "Open the link Bulwark printed when it started (it includes a key).", code: "auth" });
        return;
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]{16})$/);
      if (method === "GET" && jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) json(res, 404, { error: "Unknown job." });
        else json(res, 200, job);
        return;
      }
      const scanMatch = url.pathname.match(/^\/api\/scans\/([\w.-]+)$/);
      if (method === "GET" && scanMatch) {
        const s = await state.getScan(scanMatch[1]);
        if (!s) json(res, 404, { error: "Unknown scan." });
        else json(res, 200, s);
        return;
      }
      if (method === "GET" && url.pathname === "/api/report") {
        const id = url.searchParams.get("scan");
        const scan = id ? await state.getScan(id) : await state.latestScan();
        if (!scan) throw new HttpError(404, "No scan.");
        send(res, 200, markdownReport(scan, await state.listChanges()), "text/markdown; charset=utf-8", { "Content-Disposition": `attachment; filename="bulwark-${scan.id}.md"` });
        return;
      }
      const route = routes[`${method} ${url.pathname}`];
      if (!route) {
        json(res, 404, { error: "Not found." });
        return;
      }
      json(res, 200, await route(req, url));
    } catch (err) {
      if (err instanceof HttpError) json(res, err.status, { error: err.message, code: err.code, ...err.extra });
      else if (err instanceof FixError) json(res, 400, { error: err.message });
      else json(res, 500, { error: errorMessage(err) });
    }
  };
}

/** Opens a URL in the default browser: the phone's browser in Termux, the desktop's elsewhere. */
export async function openInBrowser(host: Host, url: string): Promise<boolean> {
  const [cmd, args]: [string, string[]] =
    host.platform === "android" ? ["termux-open-url", [url]] : host.platform === "darwin" ? ["open", [url]] : host.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  if (host.platform === "linux" && (host.isRoot || (!host.env.DISPLAY && !host.env.WAYLAND_DISPLAY))) return false;
  const r = await host.exec(cmd, args, { timeoutMs: 10_000 });
  return r.code === 0;
}

export async function startServer(opts: ServerOptions & { open?: boolean }): Promise<http.Server> {
  const token = await opts.state.token();
  const local = opts.bind === "127.0.0.1" || opts.bind === "localhost";
  const lan = opts.lan && local ? lanAddresses() : [];
  const loginCode = lan.length || !local ? new LoginCode() : undefined;
  const handler = createApp({ ...opts, token, loginCode, lanAddresses: lan });
  const listen = async (bind: string): Promise<http.Server> => {
    const server = http.createServer((req, res) => void handler(req, res));
    server.requestTimeout = 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(opts.port, bind, () => resolve());
    });
    return server;
  };
  const server = await listen(opts.bind);
  // With --lan, the dashboard also listens on the Wi-Fi address, and only there: not on mobile data or a VPN.
  const extra: http.Server[] = [];
  for (const a of lan) {
    try {
      extra.push(await listen(a));
    } catch (err) {
      console.log(`Couldn't listen on ${a}: ${errorMessage(err)}`);
    }
  }
  server.on("close", () => extra.forEach((x) => x.close()));
  const shown = opts.bind === "0.0.0.0" || opts.bind === "::" ? "127.0.0.1" : opts.bind;
  const link = `http://${shown}:${opts.port}/#key=${token}`;
  console.log(`\nBulwark dashboard: ${link}\n`);
  if (opts.demo) console.log("Demo mode: scans cover a pretend network running on this computer, so nothing real is touched.");
  else if (opts.host.platform === "android") console.log("Running on Android: Bulwark checks this phone and your network. To check and fix phone or TV settings it connects over ADB (see the Phones & TVs tab).");
  else console.log(opts.host.isRoot ? "Running with admin rights: fixes can be applied from the dashboard." : "Running without admin rights: you can scan, but most fixes need `bulwark serve --sudo`.");
  if (!local || extra.length) {
    const others = [...allowedHosts(opts.bind, opts.port, extra.length ? lan : [])].filter((h) => !/^(127\.0\.0\.1|localhost|\[::1\]):/.test(h));
    if (others.length) {
      console.log("\nOn another device on your network (a TV, a tablet), open:");
      for (const h of others) console.log(`  http://${h}`);
      if (loginCode) console.log(`and enter the code ${loginCode.pretty} (it works once, for the next 30 minutes).\nOr open the full link: http://${others[0]}/#key=${token}`);
    } else if (opts.lan) console.log("\nCouldn't find this device's Wi-Fi address, so other devices can't open the dashboard. Is Wi-Fi connected?");
    console.log(`\nWarning: the dashboard is reachable from other devices on your network. Its traffic isn't encrypted, so only do this on a network you trust, and stop it (Ctrl+C) when you're done.`);
    if (!local && !isPrivate(opts.bind) && opts.bind !== "0.0.0.0") console.log("That address isn't private. Don't expose the dashboard to the internet.");
  } else if (opts.lan) console.log("Couldn't find this device's Wi-Fi address, so only this device can open the dashboard. Is Wi-Fi connected?");
  if (opts.open && !(await openInBrowser(opts.host, link))) console.log("(Couldn't open a browser here; open the link above yourself.)");
  console.log("Press Ctrl+C to stop.");
  return server;
}
