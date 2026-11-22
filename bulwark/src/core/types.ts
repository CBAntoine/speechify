// Shared shapes for checks, findings, fixes and scans.

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export type Platform = "linux" | "darwin" | "win32";

/** fail = a problem was found. pass = checked and fine. skipped = didn't apply or couldn't run. */
export type Status = "fail" | "pass" | "error" | "skipped";

/** How sure we are. "possible" means a version looks vulnerable but the vendor may have patched it quietly. */
export type Confidence = "confirmed" | "likely" | "possible";

export type Category =
  | "Remote access"
  | "Firewall"
  | "Updates"
  | "Accounts"
  | "Files"
  | "Kernel"
  | "Services"
  | "Encryption"
  | "System"
  | "Wi-Fi"
  | "Network device";

export interface AutoFixRef {
  fixId: string;
  params: Record<string, unknown>;
}

export interface Remedy {
  /** A fix Bulwark can apply by itself. */
  auto?: AutoFixRef;
  /** What a person can do by hand. Always filled in for failures. */
  steps: string[];
}

export interface Finding {
  /** Unique within a scan. Local: "<checkId>[:subject]". Network: "<checkId>@<ip>[:port][#subject]". */
  id: string;
  checkId: string;
  /** "local" for this computer, otherwise the device's IP address. */
  target: string;
  title: string;
  category: Category;
  severity: Severity;
  status: Status;
  confidence: Confidence;
  summary: string;
  why: string;
  evidence: string[];
  remedy?: Remedy;
  references: string[];
  cves: string[];
}

// ── Local checks ─────────────────────────────────────────────────────────────

export interface CheckOutcome {
  status: Status;
  summary: string;
  /** Distinguishes outcomes when one check reports several things (one per user, per port, …). */
  subject?: string;
  title?: string;
  severity?: Severity;
  confidence?: Confidence;
  evidence?: string[];
  /** Manual steps. Overrides the check's defaults. */
  steps?: string[];
  auto?: { fixId: string; params?: Record<string, unknown> };
  cves?: string[];
}

export interface Check {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  platforms: Platform[];
  why: string;
  steps?: string[];
  references?: string[];
  run(host: Host): Promise<CheckOutcome[]>;
}

// ── Fixes ────────────────────────────────────────────────────────────────────

export interface Precondition {
  ok: boolean;
  message: string;
}

export interface FixContext {
  host: Host;
  params: Record<string, unknown>;
}

export interface Fix {
  id: string;
  title(params: Record<string, unknown>): string;
  needsRoot: boolean;
  /** "caution" fixes can disrupt something (block a service, change how you log in) and are never applied in bulk. */
  risk: "safe" | "caution";
  reversible: boolean;
  /** Combines several findings that use this fix into one change (for example every kernel setting at once). */
  merge?(params: Record<string, unknown>[]): Record<string, unknown>;
  /** Read-only checks that must all pass before the fix may run. */
  preconditions?(ctx: FixContext): Promise<Precondition[]>;
  /** Things the person should know before applying. */
  warnings?(ctx: FixContext): Promise<string[]>;
  /** Makes the change. Must only change the system through `tx`, so dry runs and rollbacks see every step. */
  apply(tx: TxApi, ctx: FixContext): Promise<void>;
  /** Runs after apply. Return an error message to undo the fix automatically. */
  validate?(ctx: FixContext): Promise<string | null>;
}

export interface PlanStep {
  kind: "file" | "command" | "permission" | "network" | "note";
  title: string;
  /** A unified diff for files, the command line for commands. */
  detail?: string;
}

export interface FixPlan {
  findingId: string;
  fixId: string;
  title: string;
  needsRoot: boolean;
  risk: "safe" | "caution";
  reversible: boolean;
  /** False when preconditions fail, the plan couldn't be built, or admin rights are missing. */
  canApply: boolean;
  blockedReason?: string;
  steps: PlanStep[];
  warnings: string[];
  preconditions: Precondition[];
}

export interface ExecSpec {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Readable form for plans, when the real argv isn't (encoded PowerShell, long scripts). */
  display?: string;
}

/** The only way a fix may change anything. */
export interface TxApi {
  readonly dryRun: boolean;
  note(title: string, detail?: string): void;
  writeFile(path: string, content: string, opts?: { mode?: number; title?: string }): Promise<void>;
  removeFile(path: string, opts?: { title?: string }): Promise<void>;
  chmod(path: string, mode: number, opts?: { title?: string }): Promise<void>;
  /** Runs a command that changes the system. `undo` runs on rollback; `rerunOnRollback` re-runs this same command after everything else is undone (service reloads). */
  exec(
    spec: ExecSpec,
    opts: { title: string; undo?: ExecSpec | null; rerunOnRollback?: boolean; okCodes?: number[]; readOnly?: boolean },
  ): Promise<ExecResult>;
  /** A change to another device (for example removing a router port forward). */
  network(action: NetworkAction, opts: { title: string; detail?: string }): Promise<void>;
}

export type NetworkAction = {
  type: "upnp-delete-mapping";
  controlUrl: string;
  serviceType: string;
  mapping: UpnpMapping;
};

export interface UpnpMapping {
  remoteHost: string;
  externalPort: number;
  protocol: "TCP" | "UDP";
  internalPort: number;
  internalClient: string;
  enabled: boolean;
  description: string;
  leaseDuration: number;
}

// ── Change journal ───────────────────────────────────────────────────────────

export type ActionRecord =
  | {
      type: "write";
      path: string;
      existed: boolean;
      /** Original content, base64. */
      backup?: string;
      prevMode?: number;
      newMode?: number;
      newHash: string;
    }
  | { type: "remove"; path: string; backup: string; prevMode: number; prevHash: string }
  | { type: "chmod"; path: string; prevMode: number; newMode: number }
  | { type: "exec"; title: string; spec: ExecSpec; undo?: ExecSpec | null; rerunOnRollback?: boolean }
  | { type: "network"; title: string; action: NetworkAction };

export interface ChangeRecord {
  id: string;
  fixId: string;
  findingId: string;
  target: string;
  title: string;
  appliedAt: string;
  status: "applied" | "failed" | "rolled-back";
  reversible: boolean;
  actions: ActionRecord[];
  log: string[];
  verification?: { status: Status; summary: string };
  rolledBackAt?: string;
  error?: string;
}

// ── Host access ──────────────────────────────────────────────────────────────

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface FileStat {
  mode: number; // permission bits only (0o7777)
  uid: number;
  gid: number;
  size: number;
  mtimeMs: number;
  isFile: boolean;
  isDir: boolean;
  isSymlink: boolean;
}

/** Everything checks and fixes may do to the machine. Tests swap in a fake. */
export interface Host {
  platform: Platform;
  isRoot: boolean;
  hostname: string;
  env: Record<string, string | undefined>;
  readFile(path: string): Promise<string | null>;
  readDir(path: string): Promise<string[] | null>;
  stat(path: string): Promise<FileStat | null>;
  lstat(path: string): Promise<FileStat | null>;
  readlink(path: string): Promise<string | null>;
  exec(cmd: string, args: string[], opts?: { timeoutMs?: number; env?: Record<string, string>; input?: string }): Promise<ExecResult>;
  which(cmd: string): Promise<string | null>;
  writeFile(path: string, content: string, mode?: number): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  remove(path: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
}

// ── Network results ──────────────────────────────────────────────────────────

export interface ServiceInfo {
  port: number;
  proto: "tcp" | "udp";
  /** Our best name for what's listening: ssh, http, https, telnet, smb, … */
  name: string;
  product?: string;
  version?: string;
  banner?: string;
  title?: string;
  tls?: { protocol?: string; selfSigned?: boolean; expired?: boolean; validTo?: string; subject?: string; legacy?: boolean };
  notes?: string[];
}

export interface NetDevice {
  ip: string;
  mac?: string;
  /** Locally administered MAC: phones and laptops use these for privacy. */
  randomMac?: boolean;
  vendor?: string;
  hostnames: string[];
  name?: string;
  model?: string;
  kind: string;
  isGateway: boolean;
  isSelf: boolean;
  services: ServiceInfo[];
  mdnsServices: string[];
  upnp?: { friendlyName?: string; manufacturer?: string; model?: string; igd: boolean; externalIp?: string };
}

export interface NetworkScan {
  targets: string[];
  confirmedOwnership: boolean;
  devices: NetDevice[];
  findings: Finding[];
  notes: string[];
  durationMs: number;
}

export interface DeviceInfo {
  hostname: string;
  platform: Platform;
  os: string;
  arch: string;
  isRoot: boolean;
  user: string;
}

export interface Scan {
  id: string;
  startedAt: string;
  finishedAt: string;
  tool: { name: string; version: string };
  device: DeviceInfo;
  local?: { findings: Finding[]; durationMs: number };
  network?: NetworkScan;
  scores: { local?: number; devices: Record<string, number> };
}
