// SSH server checks and fixes (Linux and macOS).
//
// sshd uses the FIRST value it reads for most options, and files pulled in with Include are read
// where the Include line is. So a setting only works if nothing earlier sets the same option.
// The fix below writes a drop-in that is read first and comments out anything that would still win,
// then proves the result with `sshd -t` before reloading.

import { memo } from "../core/cache.ts";
import type { Check, CheckOutcome, Fix, FixContext, Host, Precondition, TxApi } from "../core/types.ts";
import { fail, hasSystemd, loginAccounts, pass, skip, unitState } from "./common.ts";
import { isExposed, linuxListeners } from "./linux/procnet.ts";

export const SSHD_MAIN = "/etc/ssh/sshd_config";
export const SSHD_DROPIN_DIR = "/etc/ssh/sshd_config.d";
export const BULWARK_DROPIN = `${SSHD_DROPIN_DIR}/00-bulwark.conf`;
const MANAGED_HEADER = [
  "# Managed by Bulwark. sshd keeps the first value it reads for each option,",
  "# and this file is read before the other drop-ins, so these settings win.",
  "# Undo with `bulwark rollback`, or delete this file and reload sshd.",
];
const MAIN_BLOCK_START = "# >>> Bulwark: settings read first, so they win";
const MAIN_BLOCK_END = "# <<< Bulwark";

export interface SshDirective {
  keyword: string;
  args: string[];
  file: string;
  line: number;
  /** Match criteria this directive sits under, or null when global. */
  match: string | null;
}

export interface SshConfig {
  directives: SshDirective[];
  files: string[];
  unreadable: string[];
  /** Include lines in the main file (global scope), with what they expanded to. */
  includes: { file: string; line: number; patterns: string[]; matched: string[] }[];
}

const ALIASES: Record<string, string> = {
  challengeresponseauthentication: "kbdinteractiveauthentication",
};

function tokenize(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tok = m[1] ?? m[2];
    if (tok.startsWith("#")) break; // trailing comment
    out.push(tok);
  }
  return out;
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${esc}$`);
}

async function expandInclude(host: Host, pattern: string, overlay: Map<string, string | null>): Promise<string[]> {
  const abs = pattern.startsWith("/") ? pattern : `/etc/ssh/${pattern}`;
  if (!/[*?]/.test(abs)) {
    const exists = overlay.has(abs) ? overlay.get(abs) !== null : (await host.stat(abs)) !== null;
    return exists ? [abs] : [];
  }
  const slash = abs.lastIndexOf("/");
  const dir = abs.slice(0, slash);
  const re = globToRegex(abs.slice(slash + 1));
  const names = new Set((await host.readDir(dir)) ?? []);
  for (const [p, content] of overlay) {
    if (p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/")) {
      if (content === null) names.delete(p.slice(dir.length + 1));
      else names.add(p.slice(dir.length + 1));
    }
  }
  return [...names].filter((n) => re.test(n)).sort().map((n) => `${dir}/${n}`);
}

/**
 * Parses sshd_config the way sshd reads it, following Include lines in order.
 * `overlay` replaces file contents (null = file absent) so a fix can test its edits before writing them.
 */
export async function parseSshdConfig(
  host: Host,
  main = SSHD_MAIN,
  overlay: Map<string, string | null> = new Map(),
): Promise<SshConfig> {
  const cfg: SshConfig = { directives: [], files: [], unreadable: [], includes: [] };

  const read = async (file: string) => (overlay.has(file) ? overlay.get(file)! : await host.readFile(file));

  const walk = async (file: string, parentMatch: string | null, depth: number): Promise<void> => {
    if (depth > 16) return;
    const text = await read(file);
    if (text === null) {
      if ((await host.stat(file)) !== null) cfg.unreadable.push(file);
      return;
    }
    cfg.files.push(file);
    let match = parentMatch;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/) ?? trimmed.match(/^([A-Za-z][A-Za-z0-9]*)$/);
      if (!m) continue;
      const keyword = m[1].toLowerCase();
      const args = tokenize(m[2] ?? "");
      if (keyword === "match") {
        const criteria = args.join(" ") || "all";
        match = parentMatch ? `${parentMatch} → ${criteria}` : criteria;
        continue;
      }
      if (keyword === "include") {
        const matched: string[] = [];
        for (const pattern of args) matched.push(...(await expandInclude(host, pattern, overlay)));
        if (file === main && match === null) cfg.includes.push({ file, line: i + 1, patterns: args, matched });
        for (const inc of matched) await walk(inc, match, depth + 1);
        continue;
      }
      cfg.directives.push({ keyword: ALIASES[keyword] ?? keyword, args, file, line: i + 1, match });
    }
  };

  await walk(main, null, 0);
  return cfg;
}

const isMatchAll = (m: string | null) => m !== null && /^all$/i.test(m.trim());

/** The value that applies to ordinary connections: a `Match all` block beats global settings. */
export function effectiveDirective(cfg: SshConfig, keyword: string): SshDirective | undefined {
  const k = keyword.toLowerCase();
  return cfg.directives.find((d) => d.keyword === k && isMatchAll(d.match)) ?? cfg.directives.find((d) => d.keyword === k && d.match === null);
}

export function matchOverrides(cfg: SshConfig, keyword: string): SshDirective[] {
  const k = keyword.toLowerCase();
  return cfg.directives.filter((d) => d.keyword === k && d.match !== null && !isMatchAll(d.match));
}

const DEFAULTS: Record<string, string> = {
  permitrootlogin: "prohibit-password",
  passwordauthentication: "yes",
  kbdinteractiveauthentication: "yes",
  permitemptypasswords: "no",
  usepam: "no",
  pubkeyauthentication: "yes",
};

export function effectiveValue(cfg: SshConfig, keyword: string): string {
  const d = effectiveDirective(cfg, keyword);
  return (d?.args[0] ?? DEFAULTS[keyword.toLowerCase()] ?? "").toLowerCase();
}

const where = (d: SshDirective) => `${d.file}:${d.line}`;

export async function findSshd(host: Host): Promise<string | null> {
  for (const p of ["/usr/sbin/sshd", "/usr/bin/sshd", "/usr/local/sbin/sshd", "/opt/homebrew/sbin/sshd"]) {
    if (await host.stat(p)) return p;
  }
  return null;
}

/** `sshd -T` prints the configuration sshd would really use. Needs root (it reads the host keys). */
async function sshdTest(host: Host): Promise<Map<string, string> | null> {
  if (!host.isRoot) return null;
  const sshd = await findSshd(host);
  if (!sshd) return null;
  const r = await host.exec(sshd, ["-T"], { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  const map = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp > 0) {
      const k = line.slice(0, sp).toLowerCase();
      if (!map.has(k)) map.set(k, line.slice(sp + 1).trim().toLowerCase());
    }
  }
  return map;
}

async function sshRunning(host: Host): Promise<{ running: boolean; exposed: boolean }> {
  if (host.platform === "linux") {
    const ls = await linuxListeners(host);
    const ssh = ls.filter((l) => l.proto === "tcp" && (l.process === "sshd" || l.unit === "ssh.socket" || l.unit === "sshd.socket" || (l.port === 22 && !l.process)));
    if (ssh.length) return { running: true, exposed: ssh.some(isExposed) };
    return { running: false, exposed: false };
  }
  const r = await host.exec("netstat", ["-an", "-p", "tcp"]);
  const on = /\*\.22\s+\S+\s+LISTEN|\.22\s+\*\.\*\s+LISTEN/.test(r.stdout);
  return { running: on, exposed: on };
}

interface SshContext {
  cfg: SshConfig;
  effective: (k: string) => string;
  source: "sshd -T" | "config files";
  running: boolean;
  exposed: boolean;
}

function loadSsh(host: Host): Promise<SshContext | null> {
  return memo(host, "ssh", 5000, () => loadSshUncached(host));
}

async function loadSshUncached(host: Host): Promise<SshContext | null> {
  if (host.platform === "win32") return null;
  const sshd = await findSshd(host);
  if (!sshd && (await host.stat(SSHD_MAIN)) === null) return null;
  const cfg = await parseSshdConfig(host);
  const t = await sshdTest(host);
  const { running, exposed } = await sshRunning(host);
  return {
    cfg,
    effective: (k) => {
      const v = t?.get(k.toLowerCase());
      if (v !== undefined) return v === "without-password" ? "prohibit-password" : v;
      return effectiveValue(cfg, k);
    },
    source: t ? "sshd -T" : "config files",
    running,
    exposed,
  };
}

function notInstalled(): CheckOutcome[] {
  return [skip("The SSH server isn't installed.")];
}

function runningNote(ctx: SshContext): string {
  return ctx.running ? "" : " The SSH server isn't running right now, so this only matters if it's turned on.";
}

function lowerIfIdle<T extends CheckOutcome>(ctx: SshContext, o: T, sev: "critical" | "high" | "medium" | "low"): T {
  if (ctx.running) return { ...o, severity: sev };
  const down = { critical: "high", high: "medium", medium: "low", low: "low" } as const;
  return { ...o, severity: down[sev] };
}

export const sshRootLogin: Check = {
  id: "ssh.root-login",
  title: "SSH lets root log in with a password",
  category: "Remote access",
  severity: "high",
  platforms: ["linux", "darwin"],
  why: "Bots try passwords against the root account of every SSH server they find. If root accepts passwords, one good guess gives them the whole device.",
  steps: [
    "Edit /etc/ssh/sshd_config and set: PermitRootLogin prohibit-password",
    "Check it with: sudo sshd -t",
    "Reload SSH: sudo systemctl reload ssh (or sshd)",
  ],
  references: ["https://man.openbsd.org/sshd_config#PermitRootLogin"],
  async run(host) {
    const ctx = await loadSsh(host);
    if (!ctx) return notInstalled();
    const v = ctx.effective("permitrootlogin");
    const d = effectiveDirective(ctx.cfg, "permitrootlogin");
    const evidence = [`PermitRootLogin ${v} (from ${d ? where(d) : "the built-in default"}, read via ${ctx.source})`];
    const overrides = matchOverrides(ctx.cfg, "permitrootlogin").filter((o) => o.args[0]?.toLowerCase() === "yes");
    if (v === "yes") {
      return [
        lowerIfIdle(ctx, fail(`Root can log in over SSH with a password.${runningNote(ctx)}`, { evidence, auto: { fixId: "ssh.root-login" } }), "high"),
      ];
    }
    if (overrides.length) {
      return [
        fail(`A Match block lets root log in with a password for some connections.`, {
          severity: "medium",
          evidence: overrides.map((o) => `PermitRootLogin yes under "Match ${o.match}" at ${where(o)}`),
          steps: [`Remove or change the PermitRootLogin line inside the Match block at ${where(overrides[0])}, then reload SSH.`],
        }),
      ];
    }
    return [pass(v === "no" ? "Root can't log in over SSH." : "Root can only log in over SSH with a key.", { evidence })];
  },
};

export const sshPasswordAuth: Check = {
  id: "ssh.password-auth",
  title: "SSH accepts passwords",
  category: "Remote access",
  severity: "medium",
  platforms: ["linux", "darwin"],
  why: "Any SSH server that accepts passwords gets a steady stream of guessing attempts. Keys can't be guessed. Once every account that needs SSH has a key, turn passwords off.",
  steps: [
    "Make sure you can log in with an SSH key (ssh-copy-id user@device from your computer).",
    "Set PasswordAuthentication no and KbdInteractiveAuthentication no in /etc/ssh/sshd_config.",
    "Check with sudo sshd -t, then reload SSH.",
  ],
  references: ["https://man.openbsd.org/sshd_config#PasswordAuthentication"],
  async run(host) {
    const ctx = await loadSsh(host);
    if (!ctx) return notInstalled();
    const pw = ctx.effective("passwordauthentication") === "yes";
    const kbd = ctx.effective("kbdinteractiveauthentication") === "yes" && ctx.effective("usepam") === "yes";
    const methods = ctx.effective("authenticationmethods");
    const evidence = [
      `PasswordAuthentication ${ctx.effective("passwordauthentication")}`,
      `KbdInteractiveAuthentication ${ctx.effective("kbdinteractiveauthentication")} (UsePAM ${ctx.effective("usepam")})`,
      `Read via ${ctx.source}`,
    ];
    if (methods && methods !== "any" && !/password|keyboard-interactive/.test(methods)) {
      return [pass("SSH only allows key logins (AuthenticationMethods).", { evidence: [...evidence, `AuthenticationMethods ${methods}`] })];
    }
    if (pw || kbd) {
      const how = pw ? "passwords" : "passwords (through keyboard-interactive login)";
      return [lowerIfIdle(ctx, fail(`SSH accepts ${how}.${runningNote(ctx)}`, { evidence, auto: { fixId: "ssh.password-auth" } }), "medium")];
    }
    return [pass("SSH only accepts keys.", { evidence })];
  },
};

export const sshEmptyPasswords: Check = {
  id: "ssh.empty-passwords",
  title: "SSH allows accounts with no password",
  category: "Remote access",
  severity: "critical",
  platforms: ["linux", "darwin"],
  why: "With PermitEmptyPasswords on, any account without a password can be logged into over the network by anyone.",
  steps: ["Set PermitEmptyPasswords no in /etc/ssh/sshd_config, check with sudo sshd -t and reload SSH."],
  async run(host) {
    const ctx = await loadSsh(host);
    if (!ctx) return notInstalled();
    const v = ctx.effective("permitemptypasswords");
    if (v === "yes") {
      return [lowerIfIdle(ctx, fail(`SSH lets accounts with an empty password log in.${runningNote(ctx)}`, { auto: { fixId: "ssh.empty-passwords" } }), "critical")];
    }
    return [pass("SSH refuses accounts with empty passwords.")];
  },
};

// ── the fix ──

function setLines(content: string, desired: Record<string, string>, names: Record<string, string>): string {
  const lines = content === "" ? [] : content.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.trim().match(/^([A-Za-z]+)(\s*=\s*|\s+)/);
    if (!m) return line;
    const k = ALIASES[m[1].toLowerCase()] ?? m[1].toLowerCase();
    if (!(k in desired)) return line;
    if (seen.has(k)) return `# ${line}`;
    seen.add(k);
    return `${names[k]} ${desired[k]}`;
  });
  for (const k of Object.keys(desired)) if (!seen.has(k)) out.push(`${names[k]} ${desired[k]}`);
  return out.join("\n") + "\n";
}

const NAMES: Record<string, string> = {
  permitrootlogin: "PermitRootLogin",
  passwordauthentication: "PasswordAuthentication",
  kbdinteractiveauthentication: "KbdInteractiveAuthentication",
  permitemptypasswords: "PermitEmptyPasswords",
};

/** Works out every file edit needed so sshd ends up with `desired`, without writing anything. */
export async function planSshdEdits(host: Host, desired: Record<string, string>): Promise<{ edits: Map<string, string>; notes: string[] }> {
  const notes: string[] = [];
  const overlay = new Map<string, string | null>();
  const original = new Map<string, string | null>();
  const readCurrent = async (file: string) => {
    if (overlay.has(file)) return overlay.get(file)!;
    const t = await host.readFile(file);
    original.set(file, t);
    return t;
  };

  const initial = await parseSshdConfig(host);
  const dropInInclude = initial.includes.find((inc) =>
    inc.patterns.some((p) => {
      const abs = p.startsWith("/") ? p : `/etc/ssh/${p}`;
      return abs.startsWith(SSHD_DROPIN_DIR + "/") && globToRegex(abs.slice(abs.lastIndexOf("/") + 1)).test("00-bulwark.conf");
    }),
  );

  if (dropInInclude) {
    const existing = (await readCurrent(BULWARK_DROPIN)) ?? MANAGED_HEADER.join("\n") + "\n";
    overlay.set(BULWARK_DROPIN, setLines(existing, desired, NAMES));
  } else {
    const main = await readCurrent(SSHD_MAIN);
    if (main === null) throw new Error(`Can't read ${SSHD_MAIN}.`);
    const block = (body: string) => `${MAIN_BLOCK_START}\n${body}${MAIN_BLOCK_END}\n`;
    let next: string;
    const start = main.indexOf(MAIN_BLOCK_START);
    const end = main.indexOf(MAIN_BLOCK_END);
    if (start !== -1 && end > start) {
      const inner = main.slice(start + MAIN_BLOCK_START.length + 1, end);
      next = main.slice(0, start) + block(setLines(inner, desired, NAMES)) + main.slice(end + MAIN_BLOCK_END.length + 1);
    } else {
      next = block(setLines("", desired, NAMES)) + main;
    }
    overlay.set(SSHD_MAIN, next);
    notes.push(`${SSHD_MAIN} doesn't include ${SSHD_DROPIN_DIR}, so the settings go at the top of ${SSHD_MAIN}.`);
  }

  // Anything still winning over our values gets commented out.
  for (let round = 0; round < 12; round++) {
    const cfg = await parseSshdConfig(host, SSHD_MAIN, overlay);
    let changed = false;
    for (const [k, v] of Object.entries(desired)) {
      const d = effectiveDirective(cfg, k);
      if (!d || d.args[0]?.toLowerCase() === v) continue;
      const content = await readCurrent(d.file);
      if (content === null) throw new Error(`Can't read ${d.file}.`);
      const lines = content.split("\n");
      lines[d.line - 1] = `# ${lines[d.line - 1].trim()}  # turned off by Bulwark: ${NAMES[k]} ${v} is set in ${dropInInclude ? BULWARK_DROPIN : "the block at the top"}`;
      overlay.set(d.file, lines.join("\n"));
      notes.push(`${d.file}:${d.line} set ${NAMES[k]} ${d.args[0]} and would have won, so it's commented out.`);
      changed = true;
    }
    if (!changed) break;
  }

  const final = await parseSshdConfig(host, SSHD_MAIN, overlay);
  for (const [k, v] of Object.entries(desired)) {
    if (effectiveValue(final, k) !== v) throw new Error(`Couldn't arrange the SSH configuration so that ${NAMES[k]} is ${v}.`);
    for (const later of final.directives.filter((d) => d.keyword === k && d.match === null && d.file !== BULWARK_DROPIN && d.args[0]?.toLowerCase() !== v)) {
      notes.push(`${later.file}:${later.line} also sets ${NAMES[k]} ${later.args[0]}, but it's read later, so it no longer counts.`);
    }
  }

  const edits = new Map<string, string>();
  for (const [file, content] of overlay) {
    const before = original.has(file) ? original.get(file) : await host.readFile(file);
    if (content !== null && content !== before) edits.set(file, content);
  }
  return { edits, notes };
}

async function sshReload(host: Host): Promise<{ cmd: string; args: string[] } | null> {
  if (host.platform !== "linux") return null; // macOS starts sshd per connection, so new logins see the change.
  if (await hasSystemd(host)) {
    for (const unit of ["ssh.service", "sshd.service"]) {
      const st = await unitState(host, unit);
      if (st.exists && st.active) return { cmd: "systemctl", args: ["reload", unit] };
    }
    return null;
  }
  for (const pidFile of ["/run/sshd.pid", "/var/run/sshd.pid"]) {
    const pid = (await host.readFile(pidFile))?.trim();
    if (pid && /^\d+$/.test(pid)) return { cmd: "kill", args: ["-HUP", pid] };
  }
  return null;
}

export async function applySshdOptions(tx: TxApi, host: Host, desired: Record<string, string>): Promise<void> {
  const { edits, notes } = await planSshdEdits(host, desired);
  for (const n of notes) tx.note(n);
  // Write the drop-in last so a half-applied change never leaves a stray file behind.
  const ordered = [...edits.entries()].sort(([a], [b]) => (a === BULWARK_DROPIN ? 1 : b === BULWARK_DROPIN ? -1 : 0));
  for (const [file, content] of ordered) await tx.writeFile(file, content, file === BULWARK_DROPIN ? { mode: 0o644 } : undefined);
  const sshd = await findSshd(host);
  if (sshd) {
    await tx.exec({ cmd: sshd, args: ["-t"] }, { title: "Check the new SSH configuration (sshd -t)", readOnly: true });
  }
  const reload = await sshReload(host);
  if (reload) await tx.exec(reload, { title: "Reload the SSH server so it uses the new settings", rerunOnRollback: true });
  else tx.note("The SSH server isn't running as a service right now; it will use these settings when it starts.");
}

async function keyAccounts(host: Host): Promise<{ withKeys: string[]; without: string[]; keysCommand: boolean }> {
  const cfg = await parseSshdConfig(host);
  const keysCommand = !!effectiveDirective(cfg, "authorizedkeyscommand");
  const filesSetting = effectiveDirective(cfg, "authorizedkeysfile")?.args ?? [".ssh/authorized_keys", ".ssh/authorized_keys2"];
  const accounts = await loginAccounts(host);
  const withKeys: string[] = [];
  const without: string[] = [];
  for (const a of accounts) {
    let has = false;
    for (const pattern of filesSetting) {
      if (pattern.toLowerCase() === "none") continue;
      let p = pattern.replace(/%%/g, "\u0000").replace(/%h/g, a.home).replace(/%u/g, a.name).replace(/\u0000/g, "%");
      if (!p.startsWith("/")) p = `${a.home}/${p}`;
      const text = await host.readFile(p);
      if (text && /^\s*(?:[^#\s][^\n]*\s)?(ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-\S+|sk-\S+)\s+\S+/m.test(text)) {
        has = true;
        break;
      }
    }
    (has ? withKeys : without).push(a.name);
  }
  return { withKeys, without, keysCommand };
}

const sshFix = (id: string, desired: Record<string, string>, title: string, risk: "safe" | "caution", extra: Partial<Fix> = {}): Fix => ({
  id,
  title: () => title,
  needsRoot: true,
  risk,
  reversible: true,
  async preconditions(ctx: FixContext): Promise<Precondition[]> {
    const out: Precondition[] = [];
    const sshd = await findSshd(ctx.host);
    if (sshd && ctx.host.isRoot) {
      const r = await ctx.host.exec(sshd, ["-t"]);
      out.push({ ok: r.code === 0, message: r.code === 0 ? "The current SSH configuration is valid." : `The current SSH configuration already has errors: ${r.stderr.trim()}` });
    }
    if (extra.preconditions) out.push(...(await extra.preconditions(ctx)));
    return out;
  },
  warnings: extra.warnings,
  apply: (tx, ctx) => applySshdOptions(tx, ctx.host, desired),
});

export const sshFixes: Fix[] = [
  sshFix("ssh.root-login", { permitrootlogin: "prohibit-password" }, "Stop root from logging in over SSH with a password", "safe", {
    async warnings() {
      return ["Root can still log in with an SSH key, so key-based automation keeps working."];
    },
  }),
  sshFix("ssh.empty-passwords", { permitemptypasswords: "no" }, "Refuse SSH logins with empty passwords", "safe"),
  sshFix(
    "ssh.password-auth",
    { passwordauthentication: "no", kbdinteractiveauthentication: "no" },
    "Turn off SSH password logins (keys only)",
    "caution",
    {
      async preconditions(ctx) {
        const k = await keyAccounts(ctx.host);
        if (k.keysCommand) return [{ ok: true, message: "Keys come from AuthorizedKeysCommand, so key logins don't depend on local files." }];
        if (k.withKeys.length === 0) {
          return [{ ok: false, message: "No account has an SSH key set up. Turning off passwords now would lock everyone out of SSH. Add a key first (ssh-copy-id), then try again." }];
        }
        return [{ ok: true, message: `These accounts have SSH keys and will keep working: ${k.withKeys.join(", ")}.` }];
      },
      async warnings(ctx) {
        const k = await keyAccounts(ctx.host);
        const w = ["If you're connected over SSH right now, that session stays open. New logins will need a key."];
        if (k.without.length) w.push(`These accounts have no SSH key and won't be able to log in over SSH: ${k.without.join(", ")}.`);
        return w;
      },
    },
  ),
];

export const sshChecks: Check[] = [sshRootLogin, sshPasswordAuth, sshEmptyPasswords];
