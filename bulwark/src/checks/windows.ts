// Windows checks, through PowerShell cmdlets that return structured data (so the language of
// Windows doesn't matter).

import { powershellJson, powershellSpec } from "../core/host.ts";
import type { Check, Fix } from "../core/types.ts";
import { fail, needsAdmin, pass, skip } from "./common.ts";

const asBool = (v: unknown) => v === true || v === 1 || v === "True" || v === "true";
const asArray = <T>(v: T | T[] | null): T[] => (v === null ? [] : Array.isArray(v) ? v : [v]);

export const winFirewall: Check = {
  id: "windows.firewall",
  title: "Windows Firewall is off",
  category: "Firewall",
  severity: "high",
  platforms: ["win32"],
  why: "With the firewall off, every service on the PC can be reached by every device on the network, including public Wi-Fi.",
  steps: ["Settings → Privacy & security → Windows Security → Firewall & network protection → turn it on for every network type."],
  async run(host) {
    const profiles = asArray(await powershellJson<{ Name: string; Enabled: unknown }[]>(host, "Get-NetFirewallProfile | Select-Object Name, Enabled"));
    if (!profiles.length) return [skip("Couldn't read the firewall settings.")];
    const off = profiles.filter((p) => !asBool(p.Enabled)).map((p) => p.Name);
    if (!off.length) return [pass("Windows Firewall is on for every network type.")];
    return [fail(`Windows Firewall is off for: ${off.join(", ")}.`, { severity: off.includes("Public") ? "high" : "medium", auto: { fixId: "windows.firewall.enable", params: { profiles: off } } })];
  },
};

const PROFILE = /^(Domain|Private|Public)$/;

export const winFirewallFix: Fix = {
  id: "windows.firewall.enable",
  title: () => "Turn Windows Firewall on",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx, { params }) {
    const list = (Array.isArray(params.profiles) ? params.profiles : []).map(String).filter((p) => PROFILE.test(p));
    if (!list.length) return;
    await tx.exec(powershellSpec(`Set-NetFirewallProfile -Profile ${list.join(",")} -Enabled True`), {
      title: `Turn the firewall on for ${list.join(", ")}`,
      undo: powershellSpec(`Set-NetFirewallProfile -Profile ${list.join(",")} -Enabled False`),
    });
  },
};

export const winDefender: Check = {
  id: "windows.defender",
  title: "Microsoft Defender real-time protection is off",
  category: "System",
  severity: "high",
  platforms: ["win32"],
  why: "Real-time protection catches malware as it lands, before it runs.",
  steps: ["Windows Security → Virus & threat protection → Manage settings → turn on Real-time protection."],
  async run(host) {
    const s = await powershellJson<{ AMRunningMode?: string; RealTimeProtectionEnabled?: unknown; AntivirusSignatureAge?: number }>(
      host,
      "Get-MpComputerStatus | Select-Object AMRunningMode, RealTimeProtectionEnabled, AntivirusSignatureAge",
    );
    if (!s) return [skip("Couldn't read Defender's status (another antivirus may be in charge).")];
    if (s.AMRunningMode && s.AMRunningMode !== "Normal") return [skip(`Defender is in ${s.AMRunningMode} mode, so another antivirus is in charge.`)];
    const out = [];
    if (!asBool(s.RealTimeProtectionEnabled)) out.push(fail("Real-time protection is off.", { auto: { fixId: "windows.defender.realtime" } }));
    else out.push(pass("Real-time protection is on."));
    if (typeof s.AntivirusSignatureAge === "number" && s.AntivirusSignatureAge > 7) {
      out.push(fail(`Defender's malware definitions are ${s.AntivirusSignatureAge} days old.`, { subject: "signatures", title: "Defender's definitions are out of date", severity: "medium", auto: { fixId: "windows.defender.update" } }));
    }
    return out;
  },
};

export const winDefenderFix: Fix = {
  id: "windows.defender.realtime",
  title: () => "Turn on Defender real-time protection",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx) {
    await tx.exec(powershellSpec("Set-MpPreference -DisableRealtimeMonitoring $false"), {
      title: "Turn real-time protection on",
      undo: powershellSpec("Set-MpPreference -DisableRealtimeMonitoring $true"),
    });
  },
};

export const winDefenderUpdateFix: Fix = {
  id: "windows.defender.update",
  title: () => "Update Defender's malware definitions",
  needsRoot: true,
  risk: "safe",
  reversible: false,
  async apply(tx) {
    await tx.exec(powershellSpec("Update-MpSignature"), { title: "Download the latest definitions", undo: null });
  },
};

export const winSmb1: Check = {
  id: "windows.smb1",
  title: "SMBv1 file sharing is on",
  category: "Services",
  severity: "high",
  platforms: ["win32"],
  why: "SMBv1 is the 30-year-old protocol that WannaCry and NotPetya spread through (EternalBlue). Nothing modern needs it.",
  steps: ["Run in an admin PowerShell: Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force"],
  references: ["https://learn.microsoft.com/windows-server/storage/file-server/troubleshoot/detect-enable-and-disable-smbv1-v2-v3"],
  async run(host) {
    const s = await powershellJson<{ EnableSMB1Protocol?: unknown }>(host, "Get-SmbServerConfiguration | Select-Object EnableSMB1Protocol");
    if (!s) return [host.isRoot ? skip("Couldn't read the SMB settings.") : needsAdmin("SMB settings")];
    if (asBool(s.EnableSMB1Protocol)) return [fail("The SMBv1 server is on.", { cves: ["CVE-2017-0144"], auto: { fixId: "windows.smb1.disable" } })];
    return [pass("SMBv1 is off.")];
  },
};

export const winSmb1Fix: Fix = {
  id: "windows.smb1.disable",
  title: () => "Turn off SMBv1",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async warnings() {
    return ["Very old devices (Windows XP, some old NAS boxes and printers) can't reach this PC's shared folders afterwards."];
  },
  async apply(tx) {
    await tx.exec(powershellSpec("Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force"), {
      title: "Turn the SMBv1 server off",
      undo: powershellSpec("Set-SmbServerConfiguration -EnableSMB1Protocol $true -Force"),
    });
  },
};

const RDP_KEY = "HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server";
const RDP_TCP = `${RDP_KEY}\\WinStations\\RDP-Tcp`;

export const winRdpNla: Check = {
  id: "windows.rdp-nla",
  title: "Remote Desktop doesn't require Network Level Authentication",
  category: "Remote access",
  severity: "high",
  platforms: ["win32"],
  why: "Without NLA, anyone who can reach port 3389 gets to the Windows login screen before proving who they are, which is where bugs like BlueKeep struck.",
  steps: ["Settings → System → Remote Desktop → Advanced settings → turn on \"Require devices to use Network Level Authentication\"."],
  async run(host) {
    const deny = await powershellJson<{ fDenyTSConnections?: number }>(host, `Get-ItemProperty '${RDP_KEY}' | Select-Object fDenyTSConnections`);
    if (!deny) return [skip("Couldn't read the Remote Desktop settings.")];
    if (deny.fDenyTSConnections !== 0) return [pass("Remote Desktop is off.")];
    const nla = await powershellJson<{ UserAuthentication?: number }>(host, `Get-ItemProperty '${RDP_TCP}' | Select-Object UserAuthentication`);
    if (nla?.UserAuthentication === 0) return [fail("Remote Desktop is on and doesn't require Network Level Authentication.", { auto: { fixId: "windows.rdp-nla.enable" } })];
    return [pass("Remote Desktop requires Network Level Authentication.")];
  },
};

export const winRdpNlaFix: Fix = {
  id: "windows.rdp-nla.enable",
  title: () => "Require Network Level Authentication for Remote Desktop",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async warnings() {
    return ["Very old Remote Desktop apps that don't support NLA won't be able to connect."];
  },
  async apply(tx) {
    await tx.exec(powershellSpec(`Set-ItemProperty -Path '${RDP_TCP}' -Name UserAuthentication -Value 1`), {
      title: "Turn on NLA",
      undo: powershellSpec(`Set-ItemProperty -Path '${RDP_TCP}' -Name UserAuthentication -Value 0`),
    });
  },
};

export const winGuest: Check = {
  id: "windows.guest",
  title: "The Guest account is on",
  category: "Accounts",
  severity: "medium",
  platforms: ["win32"],
  why: "The built-in Guest account lets people use the PC, and sometimes its shared folders, without a password.",
  steps: ["Run in an admin PowerShell: Get-LocalUser | Where-Object { $_.SID -like '*-501' } | Disable-LocalUser"],
  async run(host) {
    const users = asArray(await powershellJson<{ Name: string; Enabled: unknown; SID: { Value?: string } | string }[]>(host, "Get-LocalUser | Select-Object Name, Enabled, SID"));
    if (!users.length) return [skip("Couldn't list local accounts.")];
    const sid = (u: (typeof users)[number]) => (typeof u.SID === "string" ? u.SID : u.SID?.Value ?? "");
    const guest = users.find((u) => sid(u).endsWith("-501"));
    if (guest && asBool(guest.Enabled)) return [fail(`The built-in Guest account ("${guest.Name}") is on.`, { auto: { fixId: "windows.guest.disable", params: { sid: sid(guest) } } })];
    return [pass("The Guest account is off.")];
  },
};

export const winGuestFix: Fix = {
  id: "windows.guest.disable",
  title: () => "Turn off the Guest account",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx, { params }) {
    const sid = String(params.sid);
    if (!/^S-1-5-21-[\d-]+-501$/.test(sid)) throw new Error("Unexpected account ID.");
    await tx.exec(powershellSpec(`Disable-LocalUser -SID '${sid}'`), { title: "Disable the Guest account", undo: powershellSpec(`Enable-LocalUser -SID '${sid}'`) });
  },
};

const UAC_KEY = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";

export const winUac: Check = {
  id: "windows.uac",
  title: "User Account Control is off",
  category: "System",
  severity: "high",
  platforms: ["win32"],
  why: "Without UAC, every program you run has full admin rights, so any malware does too.",
  steps: ["Control Panel → User Accounts → Change User Account Control settings → move the slider up to the default, then restart."],
  async run(host) {
    const v = await powershellJson<{ EnableLUA?: number; ConsentPromptBehaviorAdmin?: number }>(host, `Get-ItemProperty '${UAC_KEY}' | Select-Object EnableLUA, ConsentPromptBehaviorAdmin`);
    if (!v) return [skip("Couldn't read the UAC settings.")];
    if (v.EnableLUA === 0) return [fail("User Account Control is turned off.", { auto: { fixId: "windows.uac.enable", params: { key: "EnableLUA", value: 1, prev: 0 } } })];
    if (v.ConsentPromptBehaviorAdmin === 0) {
      return [fail("Admin accounts are elevated without being asked.", { severity: "medium", auto: { fixId: "windows.uac.enable", params: { key: "ConsentPromptBehaviorAdmin", value: 5, prev: 0 } } })];
    }
    return [pass("User Account Control is on.")];
  },
};

export const winUacFix: Fix = {
  id: "windows.uac.enable",
  title: () => "Turn User Account Control back on",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async warnings({ params }) {
    return params.key === "EnableLUA" ? ["Takes effect after a restart."] : [];
  },
  async apply(tx, { params }) {
    const key = params.key === "ConsentPromptBehaviorAdmin" ? "ConsentPromptBehaviorAdmin" : "EnableLUA";
    const value = key === "EnableLUA" ? 1 : 5;
    const prev = Number(params.prev) || 0;
    await tx.exec(powershellSpec(`Set-ItemProperty -Path '${UAC_KEY}' -Name ${key} -Value ${value}`), {
      title: `Set ${key} to ${value}`,
      undo: powershellSpec(`Set-ItemProperty -Path '${UAC_KEY}' -Name ${key} -Value ${prev}`),
    });
  },
};

export const winBitLocker: Check = {
  id: "windows.bitlocker",
  title: "The system drive isn't encrypted",
  category: "Encryption",
  severity: "medium",
  platforms: ["win32"],
  why: "Without BitLocker (or Device Encryption), anyone with the laptop can read the disk by plugging it into another computer.",
  steps: ["Settings → Privacy & security → Device encryption (or Control Panel → BitLocker Drive Encryption) → turn it on, and save the recovery key to your Microsoft account or print it."],
  async run(host) {
    if (!host.isRoot) return [needsAdmin("BitLocker")];
    const v = await powershellJson<{ ProtectionStatus?: unknown; VolumeStatus?: unknown }>(host, "Get-BitLockerVolume -MountPoint $env:SystemDrive | Select-Object ProtectionStatus, VolumeStatus");
    if (!v) return [skip("BitLocker isn't available on this edition of Windows.")];
    const on = v.ProtectionStatus === 1 || v.ProtectionStatus === "On";
    return on ? [pass("The system drive is encrypted with BitLocker.")] : [fail("The system drive isn't protected by BitLocker.")];
  },
};

export const winUpdates: Check = {
  id: "windows.updates",
  title: "Windows hasn't installed updates in a while",
  category: "Updates",
  severity: "medium",
  platforms: ["win32"],
  why: "Microsoft fixes security holes every month (Patch Tuesday). A PC that hasn't updated for weeks is missing those fixes.",
  steps: ["Settings → Windows Update → Check for updates, install everything and restart."],
  async run(host) {
    const v = await powershellJson<{ Days?: number }>(
      host,
      "$h = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1; [pscustomobject]@{ Days = [int]((Get-Date) - $h.InstalledOn).TotalDays }",
    );
    if (!v || typeof v.Days !== "number") return [skip("Couldn't read the update history.")];
    if (v.Days > 45) return [fail(`The last update was installed ${v.Days} days ago.`)];
    return [pass(`The last update was installed ${v.Days} day${v.Days === 1 ? "" : "s"} ago.`)];
  },
};

export const winChecks: Check[] = [winFirewall, winDefender, winSmb1, winRdpNla, winGuest, winUac, winBitLocker, winUpdates];
export const winFixes: Fix[] = [winFirewallFix, winDefenderFix, winDefenderUpdateFix, winSmb1Fix, winRdpNlaFix, winGuestFix, winUacFix];
