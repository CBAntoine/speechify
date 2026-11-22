import type { Check, Host } from "../../core/types.ts";
import { fail, pass, skip } from "../common.ts";

/** The device behind "/", from /proc/mounts (the last entry wins, as later mounts cover earlier ones). */
export function rootSource(mounts: string): { source: string; fstype: string } | null {
  let found: { source: string; fstype: string } | null = null;
  for (const line of mounts.split("\n")) {
    const f = line.split(" ");
    if (f[1] === "/") found = { source: f[0], fstype: f[2] };
  }
  return found;
}

async function blockName(host: Host, source: string): Promise<string | null> {
  if (!source.startsWith("/dev/")) return null;
  const link = await host.readlink(source);
  const target = link ? (link.startsWith("/") ? link : `${source.slice(0, source.lastIndexOf("/"))}/${link}`) : source;
  const name = target.split("/").pop() ?? null;
  if (name === "root") {
    // /dev/root: ask the kernel command line which device it is.
    const cmd = (await host.readFile("/proc/cmdline")) ?? "";
    const m = cmd.match(/\broot=(\/dev\/\S+)/);
    return m ? m[1].split("/").pop()! : null;
  }
  return name;
}

/** Walks from a block device down through LVM, RAID and partitions, looking for a dm-crypt layer. */
async function encryptedBelow(host: Host, name: string, depth = 0): Promise<boolean> {
  if (depth > 8) return false;
  const uuid = (await host.readFile(`/sys/class/block/${name}/dm/uuid`))?.trim();
  if (uuid?.startsWith("CRYPT-")) return true;
  for (const slave of (await host.readDir(`/sys/class/block/${name}/slaves`)) ?? []) {
    if (await encryptedBelow(host, slave, depth + 1)) return true;
  }
  return false;
}

async function isVirtualMachine(host: Host): Promise<boolean> {
  const product = ((await host.readFile("/sys/class/dmi/id/product_name")) ?? "") + ((await host.readFile("/sys/class/dmi/id/sys_vendor")) ?? "");
  if (/KVM|QEMU|VMware|VirtualBox|Virtual Machine|Xen|Google Compute|Amazon EC2|DigitalOcean|Hetzner|Firecracker/i.test(product)) return true;
  const cpu = (await host.readFile("/proc/cpuinfo")) ?? "";
  return /^flags\s*:.*\bhypervisor\b/m.test(cpu);
}

export const diskEncryption: Check = {
  id: "linux.disk.encryption",
  title: "The disk isn't encrypted",
  category: "Encryption",
  severity: "medium",
  platforms: ["linux"],
  why: "Without disk encryption, anyone who gets hold of the device (or just its disk or SD card) can read every file, including saved passwords and keys.",
  steps: [
    "Encrypting a disk that's already in use can't be done safely by a script. Back up your files, then reinstall with encryption turned on (Ubuntu: \"Advanced features → Use LVM and encryption\").",
    "Until then, keep sensitive files in an encrypted folder (for example with gocryptfs or VeraCrypt).",
  ],
  async run(host) {
    const mounts = (await host.readFile("/proc/mounts")) ?? "";
    const root = rootSource(mounts);
    if (!root) return [skip("Couldn't find the root filesystem.")];
    if (await isVirtualMachine(host)) return [skip("This is a virtual machine; disk encryption is up to the host it runs on.")];
    if (root.fstype === "zfs") {
      const r = await host.exec("zfs", ["get", "-H", "-o", "value", "encryption", root.source]);
      const v = r.stdout.trim();
      if (r.code === 0 && v && v !== "off") return [pass(`The root filesystem uses ZFS encryption (${v}).`)];
      if (r.code === 0) return [fail("The root ZFS dataset isn't encrypted.")];
      return [skip("Couldn't ask ZFS about encryption.")];
    }
    const name = await blockName(host, root.source);
    if (!name) return [skip(`Can't tell whether ${root.source} is encrypted.`)];
    if (await encryptedBelow(host, name)) return [pass("The system disk is encrypted (LUKS/dm-crypt).")];
    const laptop = ((await host.readDir("/sys/class/power_supply")) ?? []).some((d) => d.startsWith("BAT"));
    return [
      fail(`The system disk (${root.source}) isn't encrypted.${laptop ? " This looks like a laptop, which is easy to lose or have stolen." : ""}`, {
        severity: laptop ? "high" : "medium",
        evidence: [`/ is ${root.source} (${root.fstype})`],
      }),
    ];
  },
};
