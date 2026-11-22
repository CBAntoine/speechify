import type { Check, CheckOutcome, Fix, Host } from "../../core/types.ts";
import { canLogIn, fail, needsAdmin, parsePasswd, parseShadow, pass, skip, usableHash, type ShadowEntry } from "../common.ts";

async function shadow(host: Host): Promise<ShadowEntry[] | null> {
  const text = await host.readFile("/etc/shadow");
  return text === null ? null : parseShadow(text);
}

async function passwd(host: Host) {
  return parsePasswd((await host.readFile("/etc/passwd")) ?? "");
}

export const emptyPasswords: Check = {
  id: "linux.accounts.empty-password",
  title: "An account has no password",
  category: "Accounts",
  severity: "critical",
  platforms: ["linux"],
  why: "An account with an empty password lets anyone at the keyboard, and often anyone on the network, log in as that user.",
  steps: ["Set a password: sudo passwd <user>", "Or lock the account if nobody uses it: sudo usermod -L <user>"],
  async run(host) {
    const sh = await shadow(host);
    if (!sh) return [needsAdmin("account passwords")];
    const users = new Map((await passwd(host)).map((p) => [p.name, p]));
    const empty = sh.filter((s) => s.hash === "" && users.get(s.name) && canLogIn(users.get(s.name)!));
    if (!empty.length) return [pass("Every account that can log in has a password or is locked.")];
    return empty.map((s) =>
      fail(`The account "${s.name}" has no password, so anyone can log in as it.`, {
        subject: s.name,
        title: `Account "${s.name}" has no password`,
        auto: { fixId: "linux.accounts.lock", params: { user: s.name } },
        steps: [`Set a password: sudo passwd ${s.name}`, `Or lock it: sudo usermod -L ${s.name}`],
      }),
    );
  },
};

export const lockAccountFix: Fix = {
  id: "linux.accounts.lock",
  title: (p) => `Lock the account "${p.user}" until it gets a password`,
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async warnings({ params }) {
    return [`Password logins as ${params.user} stop working. SSH keys for that account keep working. Give it a password later with: sudo passwd ${params.user}`];
  },
  async apply(tx, { params }) {
    const user = String(params.user);
    if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(user)) throw new Error("Invalid user name.");
    await tx.exec({ cmd: "usermod", args: ["-L", user] }, { title: `Lock the password of ${user}`, undo: { cmd: "usermod", args: ["-p", "", user] } });
  },
};

// Factory passwords that device images ship with, plus a few that people never change.
const FACTORY: Record<string, string[]> = {
  pi: ["raspberry"],
  ubuntu: ["ubuntu"],
  debian: ["debian", "temppwd"],
  kali: ["kali"],
  root: ["root", "toor", "admin", "password"],
  admin: ["admin", "password"],
  user: ["user", "password"],
  osmc: ["osmc"],
  dietpi: ["dietpi"],
  orangepi: ["orangepi"],
  odroid: ["odroid"],
  alarm: ["alarm"],
  linaro: ["linaro"],
  vagrant: ["vagrant"],
  volumio: ["volumio"],
  openhabian: ["openhabian"],
};
const COMMON = ["password", "123456", "changeme"];

/** Compares hashes with libc's crypt() through perl (present on nearly every Linux), reading from stdin so nothing shows in `ps`. */
async function cryptMatches(host: Host, pairs: { hash: string; candidate: string }[]): Promise<boolean[] | null> {
  if (!pairs.length) return [];
  if (!(await host.which("perl"))) return null;
  const script = 'while(<STDIN>){chomp; my($i,$h,$p)=split(/\\t/,$_,3); my $c=crypt($p,$h); print "$i\\t", ((defined $c && $c eq $h) ? 1 : 0), "\\n";}';
  const input = pairs.map((p, i) => `${i}\t${p.hash}\t${p.candidate}`).join("\n") + "\n";
  const r = await host.exec("perl", ["-e", script], { input, timeoutMs: 120_000 });
  if (r.code !== 0) return null;
  const out = new Array<boolean>(pairs.length).fill(false);
  for (const line of r.stdout.split("\n")) {
    const [i, ok] = line.split("\t");
    if (i !== undefined && ok !== undefined) out[Number(i)] = ok === "1";
  }
  return out;
}

export const defaultPasswords: Check = {
  id: "linux.accounts.default-password",
  title: "An account still has its factory password",
  category: "Accounts",
  severity: "critical",
  platforms: ["linux"],
  why: "Factory passwords like pi/raspberry are published online and are the first thing botnets try. Bulwark compares the password hashes on this device with a short list of them; nothing leaves the device.",
  async run(host) {
    const sh = await shadow(host);
    if (!sh) return [needsAdmin("account passwords")];
    const users = (await passwd(host)).filter(canLogIn);
    const hashes = new Map(sh.map((s) => [s.name, s]));
    const pairs: { user: string; hash: string; candidate: string }[] = [];
    for (const u of users) {
      const s = hashes.get(u.name);
      if (!s || !usableHash(s.hash)) continue;
      const candidates = new Set([...(FACTORY[u.name] ?? []), u.name, ...COMMON]);
      for (const c of candidates) pairs.push({ user: u.name, hash: s.hash, candidate: c });
    }
    if (!pairs.length) return [pass("No account that can log in uses a password Bulwark can check.")];
    const res = await cryptMatches(host, pairs);
    if (!res) return [skip("Couldn't compare password hashes (perl isn't available).")];
    const weak = new Map<string, string>();
    pairs.forEach((p, i) => {
      if (res[i] && !weak.has(p.user)) weak.set(p.user, p.candidate);
    });
    if (!weak.size) return [pass(`None of the ${users.length} accounts that can log in uses a factory or common password.`)];
    const out: CheckOutcome[] = [];
    for (const [user, pw] of weak) {
      const factory = FACTORY[user]?.includes(pw);
      out.push(
        fail(`The account "${user}" uses ${factory ? "its factory password" : "a password anyone could guess"} ("${pw.replace(/./g, (c, i) => (i < 2 ? c : "•"))}").`, {
          subject: user,
          title: `Account "${user}" has ${factory ? "its factory" : "an easily guessed"} password`,
          auto: { fixId: "linux.accounts.expire-password", params: { user } },
          steps: [`Change it now: sudo passwd ${user}`],
        }),
      );
    }
    return out;
  },
};

export const expirePasswordFix: Fix = {
  id: "linux.accounts.expire-password",
  title: (p) => `Make "${p.user}" choose a new password at the next login`,
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async warnings({ params }) {
    return [
      `The next password login as ${params.user} (at the keyboard or over SSH) asks for a new password before it continues.`,
      `To change it right away instead: sudo passwd ${params.user}`,
    ];
  },
  async apply(tx, { host, params }) {
    const user = String(params.user);
    if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(user)) throw new Error("Invalid user name.");
    const prev = (await shadow(host))?.find((s) => s.name === user)?.lastChange ?? "";
    await tx.exec(
      { cmd: "chage", args: ["-d", "0", user] },
      { title: `Expire the password of ${user}`, undo: { cmd: "chage", args: ["-d", prev === "" ? "-1" : prev, user] } },
    );
  },
};

export const extraRootAccounts: Check = {
  id: "linux.accounts.uid0",
  title: "Another account has root powers",
  category: "Accounts",
  severity: "high",
  platforms: ["linux"],
  why: "Accounts with user ID 0 are root under another name. Attackers add them as a hidden way back in.",
  async run(host) {
    const extra = (await passwd(host)).filter((p) => p.uid === 0 && p.name !== "root");
    if (!extra.length) return [pass("Only root has user ID 0.")];
    return extra.map((p) =>
      fail(`"${p.name}" has user ID 0, which makes it root.`, {
        subject: p.name,
        title: `"${p.name}" is a second root account`,
        steps: [
          `If you didn't create "${p.name}", assume the device was broken into: back up your data and reinstall.`,
          `If it's yours, give it its own user ID (sudo usermod -u 1500 ${p.name}) or remove it (sudo userdel ${p.name}).`,
        ],
      }),
    );
  },
};

// ── sudo without a password ──

export interface SudoRule {
  file: string;
  line: number;
  who: string;
  text: string;
}

export function findNopasswdAll(text: string, file: string): SudoRule[] {
  const out: SudoRule[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("#") || t.startsWith("Defaults") || /^(User|Runas|Host|Cmnd)_Alias\b/.test(t) || t.endsWith("\\")) continue;
    const m = t.match(/^(\S+)\s+[^=]+=\s*(.*)$/);
    if (!m) continue;
    const spec = m[2];
    if (!/\bNOPASSWD\s*:/.test(spec)) continue;
    // The command list after the last tag must be exactly ALL.
    const cmds = spec.replace(/^\([^)]*\)\s*/, "").replace(/^(?:[A-Z_]+\s*:\s*)+/, "").trim();
    if (cmds !== "ALL") continue;
    out.push({ file, line: i + 1, who: m[1], text: raw });
  }
  return out;
}

async function sudoersFiles(host: Host): Promise<string[]> {
  const files = ["/etc/sudoers"];
  for (const f of (await host.readDir("/etc/sudoers.d")) ?? []) {
    // sudo skips files with a dot in the name or ending in ~.
    if (f.includes(".") || f.endsWith("~")) continue;
    files.push(`/etc/sudoers.d/${f}`);
  }
  return files;
}

export const sudoNopasswd: Check = {
  id: "linux.sudo.nopasswd",
  title: "sudo works without a password",
  category: "Accounts",
  severity: "medium",
  platforms: ["linux"],
  why: "If sudo never asks for a password, any program running as that user (a compromised browser extension, a bad npm package) can become root silently.",
  async run(host) {
    if ((await host.readFile("/etc/sudoers")) === null) {
      return (await host.stat("/etc/sudoers")) ? [needsAdmin("sudo settings")] : [skip("sudo isn't installed.")];
    }
    const rules: SudoRule[] = [];
    for (const f of await sudoersFiles(host)) {
      const text = await host.readFile(f);
      if (text) rules.push(...findNopasswdAll(text, f));
    }
    if (!rules.length) return [pass("sudo asks for a password.")];
    const sh = await shadow(host);
    return rules.map((r) => {
      const isGroup = r.who.startsWith("%");
      const hasPassword = !isGroup && sh ? usableHash(sh.find((s) => s.name === r.who)?.hash ?? "") : false;
      const where = `${r.file}:${r.line}`;
      return fail(`${isGroup ? `Everyone in the group ${r.who.slice(1)}` : `"${r.who}"`} can use sudo without a password (${where}).`, {
        subject: `${r.file}:${r.line}`,
        title: `sudo doesn't ask ${isGroup ? `group ${r.who.slice(1)}` : `"${r.who}"`} for a password`,
        evidence: [r.text.trim()],
        auto: !isGroup ? { fixId: "linux.sudo.require-password", params: { file: r.file, line: r.line, user: r.who } } : undefined,
        steps: !isGroup && !hasPassword
          ? [`${r.who} has no password yet. Set one first: sudo passwd ${r.who}`, `Then remove "NOPASSWD:" from ${where} with: sudo visudo -f ${r.file}`]
          : [`Remove "NOPASSWD:" from ${where} with: sudo visudo -f ${r.file}`],
      });
    });
  },
};

export const sudoRequirePasswordFix: Fix = {
  id: "linux.sudo.require-password",
  title: (p) => `Make sudo ask ${p.user} for a password`,
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async preconditions({ host, params }) {
    const sh = await shadow(host);
    const has = usableHash(sh?.find((s) => s.name === params.user)?.hash ?? "");
    if (!has) {
      return [{ ok: false, message: `${params.user} has no password, so sudo would stop working for them. Set one first with: sudo passwd ${params.user}` }];
    }
    const visudo = await host.which("visudo");
    return [
      { ok: true, message: `${params.user} has a password.` },
      { ok: !!visudo, message: visudo ? "visudo is available to check the change." : "visudo isn't available to check the change." },
    ];
  },
  async warnings({ params }) {
    return [`After this, sudo asks for ${params.user}'s password (once every 15 minutes). Make sure you know it, or you won't be able to use sudo.`];
  },
  async apply(tx, { host, params }) {
    const file = String(params.file);
    if (file !== "/etc/sudoers" && !/^\/etc\/sudoers\.d\/[^/.~]+$/.test(file)) throw new Error("Unexpected sudoers file.");
    const text = await host.readFile(file);
    if (text === null) throw new Error(`Can't read ${file}.`);
    const lines = text.split("\n");
    const idx = Number(params.line) - 1;
    const rules = findNopasswdAll(text, file);
    if (!rules.some((r) => r.line === idx + 1 && r.who === params.user)) throw new Error(`${file} changed since the scan. Scan again.`);
    const original = lines[idx];
    lines[idx] = original.replace(/\bNOPASSWD\s*:\s*/, "");
    lines.splice(idx, 0, `# Bulwark removed NOPASSWD from the next line. It was: ${original.trim()}`);
    await tx.writeFile(file, lines.join("\n"));
    await tx.exec({ cmd: "visudo", args: ["-c"] }, { title: "Check the sudo configuration (visudo -c)", readOnly: true });
  },
};
