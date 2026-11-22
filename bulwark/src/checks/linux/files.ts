import type { Check, CheckOutcome, Fix, Host } from "../../core/types.ts";
import { octal } from "../../core/util.ts";
import { fail, pass } from "../common.ts";

interface Rule {
  path: string;
  label: string;
  /** Bits that must not be set. */
  forbidden: number;
  why: string;
}

const SENSITIVE: Rule[] = [
  { path: "/etc/shadow", label: "password hashes", forbidden: 0o027, why: "Anyone who can read the password hashes can try to crack them offline." },
  { path: "/etc/gshadow", label: "group password hashes", forbidden: 0o027, why: "Group password hashes can be cracked offline." },
  { path: "/etc/passwd", label: "the account list", forbidden: 0o022, why: "Anyone who can write the account list can make themselves root." },
  { path: "/etc/group", label: "the group list", forbidden: 0o022, why: "Anyone who can write the group list can add themselves to sudo or admin groups." },
  { path: "/etc/sudoers", label: "sudo settings", forbidden: 0o027, why: "Anyone who can change sudo settings can give themselves root." },
  { path: "/etc/crontab", label: "the system schedule", forbidden: 0o022, why: "Jobs in /etc/crontab run as root, so whoever can edit it can run anything as root." },
];

async function sshHostKeys(host: Host): Promise<string[]> {
  return ((await host.readDir("/etc/ssh")) ?? []).filter((f) => /^ssh_host_.*_key$/.test(f)).map((f) => `/etc/ssh/${f}`);
}

const chmodAuto = (path: string, mode: number) => ({ fixId: "files.chmod", params: { items: [{ path, mode }] } });

export const sensitiveFiles: Check = {
  id: "linux.files.sensitive",
  title: "Sensitive system files have loose permissions",
  category: "Files",
  severity: "high",
  platforms: ["linux"],
  why: "Password hashes, SSH host keys and the files that decide who is root must only be readable or writable by root.",
  async run(host) {
    const rules: Rule[] = [...SENSITIVE];
    for (const k of await sshHostKeys(host)) {
      rules.push({ path: k, label: "an SSH host key", forbidden: 0o027, why: "Anyone with the server's private key can impersonate it and read SSH sessions." });
    }
    const out: CheckOutcome[] = [];
    for (const r of rules) {
      const st = await host.lstat(r.path);
      if (!st || st.isSymlink) continue;
      const bad = st.mode & r.forbidden;
      if (!bad) continue;
      const next = st.mode & ~r.forbidden;
      const what = bad & 0o022 ? (bad & 0o004 ? "readable and writable" : "writable") : "readable";
      out.push(
        fail(`${r.path} (${r.label}) is ${what} by ${bad & 0o007 ? "every user" : "its group"} (permissions ${octal(st.mode)}).`, {
          subject: r.path,
          title: `${r.path} has loose permissions`,
          severity: r.path.startsWith("/etc/ssh/") || r.path === "/etc/shadow" || bad & 0o002 ? "high" : "medium",
          evidence: [`${r.path} ${octal(st.mode)} owner ${st.uid}:${st.gid}`, r.why],
          auto: chmodAuto(r.path, next),
          steps: [`sudo chmod ${octal(next)} ${r.path}`],
        }),
      );
    }
    return out.length ? out : [pass("Password files, sudo settings and SSH host keys are only accessible to root.")];
  },
};

const PATH_DIRS = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin", "/usr/lib/systemd/system", "/lib/systemd/system"];

const CRITICAL_ETC = /^\/etc\/(cron|systemd|init\.d|sudoers|profile|rc|ld\.so)/;

/**
 * One `find` per area instead of a look at every file: much quicker, which matters most when the
 * machine is another computer reached over SSH. Null if find isn't there (then each file is checked).
 */
async function findCandidates(host: Host): Promise<string[] | null> {
  const run = async (args: string[]) => {
    const r = await host.exec("find", args, { timeoutMs: 120_000 });
    // find exits 1 when some folders can't be read or don't exist, and still lists what it found.
    return r.code === 0 || (r.code === 1 && !/not found|unknown predicate|invalid/i.test(r.stderr)) ? r.stdout.split("\n").filter((l) => l.startsWith("/")) : null;
  };
  const etc = await run(["/etc", "-xdev", "-maxdepth", "6", "-perm", "-0002", "!", "-type", "l", "-print"]);
  if (!etc) return null;
  const bins = await run([...PATH_DIRS, "-maxdepth", "1", "-perm", "-0002", "!", "-type", "l", "-print"]);
  return bins ? [...etc, ...bins] : null;
}

/** Finds world-writable files and folders that root relies on. Skips symlinks and sticky folders like /tmp. */
export async function findWorldWritable(host: Host, limit = 200): Promise<{ path: string; mode: number; critical: boolean }[]> {
  const out: { path: string; mode: number; critical: boolean }[] = [];
  let visited = 0;
  const consider = async (p: string, critical: boolean) => {
    const st = await host.lstat(p);
    if (!st || st.isSymlink) return null;
    if (st.mode & 0o002 && !(st.isDir && st.mode & 0o1000)) out.push({ path: p, mode: st.mode, critical });
    return st;
  };
  const candidates = await findCandidates(host);
  if (candidates) {
    for (const p of [...new Set(candidates)].slice(0, limit)) await consider(p, !p.startsWith("/etc/") || CRITICAL_ETC.test(p));
    return out;
  }
  const walk = async (dir: string, depth: number) => {
    if (out.length >= limit || visited > 25_000) return;
    for (const name of (await host.readDir(dir)) ?? []) {
      visited++;
      const p = `${dir}/${name}`;
      const st = await consider(p, CRITICAL_ETC.test(p));
      if (st?.isDir && depth < 6) await walk(p, depth + 1);
      if (out.length >= limit) return;
    }
  };
  await consider("/etc", true);
  await walk("/etc", 1);
  for (const d of PATH_DIRS) {
    const st = await consider(d, true);
    if (!st || !st.isDir) continue;
    for (const name of (await host.readDir(d)) ?? []) {
      visited++;
      await consider(`${d}/${name}`, true);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export const worldWritable: Check = {
  id: "linux.files.world-writable",
  title: "System files anyone can change",
  category: "Files",
  severity: "high",
  platforms: ["linux"],
  why: "If any user can change a program root runs, or a file in /etc, any program on the device can turn itself into root.",
  async run(host) {
    const found = await findWorldWritable(host);
    if (!found.length) return [pass("No world-writable files in /etc or the system program folders.")];
    return found.slice(0, 40).map((f) =>
      fail(`${f.path} can be changed by every user (permissions ${octal(f.mode)}).`, {
        subject: f.path,
        title: `${f.path} is writable by everyone`,
        severity: f.critical ? "high" : "medium",
        auto: chmodAuto(f.path, f.mode & ~0o002),
        steps: [`sudo chmod o-w ${f.path}`],
      }),
    );
  },
};

interface ChmodItem {
  path: string;
  mode: number;
}

function items(params: Record<string, unknown>): ChmodItem[] {
  const list = Array.isArray(params.items) ? params.items : [];
  return list.map((i) => ({ path: String((i as ChmodItem).path), mode: Number((i as ChmodItem).mode) }));
}

export const chmodFix: Fix = {
  id: "files.chmod",
  title: (p) => {
    const list = items(p);
    return list.length === 1 ? `Tighten the permissions of ${list[0].path}` : `Tighten the permissions of ${list.length} files`;
  },
  needsRoot: true,
  risk: "safe",
  reversible: true,
  merge: (all) => ({ items: all.flatMap(items) }),
  async preconditions({ host, params }) {
    const out = [];
    for (const it of items(params)) {
      const st = await host.lstat(it.path);
      if (!st || st.isSymlink) out.push({ ok: false, message: `${it.path} no longer exists.` });
      // This fix only ever removes permissions.
      else if ((it.mode & ~st.mode) !== 0) out.push({ ok: false, message: `${it.path} changed since the scan. Scan again.` });
    }
    return out;
  },
  async apply(tx, { params }) {
    for (const it of items(params)) {
      if (!it.path.startsWith("/") || it.path.includes("/../")) throw new Error(`Refusing odd path ${it.path}.`);
      await tx.chmod(it.path, it.mode);
    }
  },
};
