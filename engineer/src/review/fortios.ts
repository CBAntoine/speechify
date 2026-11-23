/**
 * A small parser for FortiOS configuration backups: the file you get from
 * Backup in the GUI, `execute backup config`, or `show full-configuration`.
 *
 * It keeps the line number of every statement, so a finding can point at the
 * exact lines in the backup.
 */

export interface Token {
  value: string;
  quoted: boolean;
  /** Offset of the first character (the opening quote for a quoted token). */
  start: number;
  /** Offset just past the last character (the closing quote for a quoted token). */
  end: number;
  line: number;
  endLine: number;
}

export interface Statement {
  tokens: Token[];
  line: number;
  endLine: number;
}

export interface Comment {
  line: number;
  text: string;
}

/**
 * Split a backup into statements. A quoted value may run over several lines
 * (certificates, replacement messages, scripts), and `\"` and `\\` are escapes
 * inside quotes.
 */
export function lex(text: string): { statements: Statement[]; comments: Comment[] } {
  const statements: Statement[] = [];
  const comments: Comment[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      const start = i;
      while (i < n && text[i] !== "\n") i++;
      comments.push({ line, text: text.slice(start, i).replace(/\r$/, "") });
      continue;
    }
    const tokens: Token[] = [];
    const stmtLine = line;
    while (i < n && text[i] !== "\n") {
      const d = text[i];
      if (d === " " || d === "\t" || d === "\r") {
        i++;
        continue;
      }
      const start = i;
      const tokLine = line;
      let value = "";
      let quoted = false;
      if (d === '"') {
        quoted = true;
        i++;
        while (i < n) {
          const e = text[i];
          if (e === "\\" && i + 1 < n) {
            const next = text[i + 1];
            if (next === "\n") line++;
            value += next;
            i += 2;
            continue;
          }
          if (e === '"') {
            i++;
            break;
          }
          if (e === "\n") line++;
          if (e !== "\r") value += e;
          i++;
        }
      } else {
        while (i < n && text[i] !== " " && text[i] !== "\t" && text[i] !== "\r" && text[i] !== "\n") {
          value += text[i];
          i++;
        }
      }
      tokens.push({ value, quoted, start, end: i, line: tokLine, endLine: line });
    }
    if (tokens.length) statements.push({ tokens, line: stmtLine, endLine: line });
  }
  return { statements, comments };
}

export interface Setting {
  values: string[];
  line: number;
}

export interface Block {
  kind: "config" | "edit";
  /** The config path ("firewall policy") or the entry ID ("12", "wan1"). */
  name: string;
  line: number;
  end_line: number | null;
  settings: Record<string, Setting>;
  unset: Record<string, number>;
  /** `edit` entries and nested `config` blocks, in file order. */
  children: Block[];
}

export interface Header {
  lines: string[];
  config_version: string | null;
  model: string | null;
  /** FortiOS version, such as "7.2.8". */
  version: string | null;
  build: string | null;
  /** Firmware release date from the version string, as YYYY-MM-DD. */
  release_date: string | null;
  vdom_mode: boolean;
  user: string | null;
}

export interface Section {
  /** The VDOM this block belongs to: "root" on a single-VDOM unit, null for global settings on a multi-VDOM unit. */
  vdom: string | null;
  path: string;
  block: Block;
}

export interface ParsedConfig {
  header: Header;
  vdom_mode: boolean;
  vdoms: string[];
  sections: Section[];
  warnings: string[];
  line_count: number;
}

export function parseHeader(comments: Comment[]): Header {
  const header: Header = {
    lines: [],
    config_version: null,
    model: null,
    version: null,
    build: null,
    release_date: null,
    vdom_mode: false,
    user: null,
  };
  for (const c of comments) {
    if (c.line > 20) break;
    header.lines.push(c.text);
    const m = /^#config-version=(.*)$/.exec(c.text);
    if (!m) continue;
    const [first, ...pairs] = m[1].split(":");
    header.config_version = first;
    const v = /^(.+?)-(\d+\.\d+\.\d+)-FW-build(\d+)-(\d{2})(\d{2})(\d{2})$/.exec(first);
    if (v) {
      header.model = v[1];
      header.version = v[2];
      header.build = v[3];
      header.release_date = `20${v[4]}-${v[5]}-${v[6]}`;
    }
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (key === "vdom") header.vdom_mode = value === "1";
      if (key === "user") header.user = value ?? null;
    }
  }
  return header;
}

function newBlock(kind: Block["kind"], name: string, line: number): Block {
  return { kind, name, line, end_line: null, settings: {}, unset: {}, children: [] };
}

function lastIndex(stack: Block[], test: (b: Block) => boolean): number {
  for (let k = stack.length - 1; k >= 1; k--) if (test(stack[k])) return k;
  return -1;
}

export function parseConfig(text: string): ParsedConfig {
  const { statements, comments } = lex(text);
  const header = parseHeader(comments);
  const root = newBlock("config", "", 0);
  const stack: Block[] = [root];
  const warnings: string[] = [];

  const closeTo = (idx: number, line: number) => {
    for (let k = stack.length - 1; k > idx; k--) {
      warnings.push(`line ${stack[k].line}: "${stack[k].kind} ${stack[k].name}" was not closed before line ${line}`);
    }
    stack[idx].end_line = line;
    stack.length = idx;
  };

  for (const st of statements) {
    const [cmd, ...args] = st.tokens;
    const top = stack[stack.length - 1];
    switch (cmd.value) {
      case "config": {
        const block = newBlock("config", args.map((a) => a.value).join(" "), st.line);
        top.children.push(block);
        stack.push(block);
        break;
      }
      case "edit": {
        if (top === root || top.kind !== "config") warnings.push(`line ${st.line}: "edit" outside a config block`);
        const block = newBlock("edit", args[0]?.value ?? "", st.line);
        top.children.push(block);
        stack.push(block);
        break;
      }
      case "next": {
        const idx = lastIndex(stack, (b) => b.kind === "edit");
        if (idx < 1) warnings.push(`line ${st.line}: "next" without a matching "edit"`);
        else closeTo(idx, st.line);
        break;
      }
      case "end": {
        const idx = lastIndex(stack, (b) => b.kind === "config");
        if (idx < 1) warnings.push(`line ${st.line}: "end" without a matching "config"`);
        else closeTo(idx, st.line);
        break;
      }
      case "set": {
        const key = args[0]?.value;
        if (!key) warnings.push(`line ${st.line}: "set" without a setting name`);
        else if (top === root) warnings.push(`line ${st.line}: "set ${key}" outside any block`);
        else top.settings[key] = { values: args.slice(1).map((a) => a.value), line: st.line };
        break;
      }
      case "unset": {
        const key = args[0]?.value;
        if (key && top !== root) top.unset[key] = st.line;
        break;
      }
      default:
        warnings.push(`line ${st.line}: unrecognised statement "${cmd.value}"`);
    }
  }
  for (let k = stack.length - 1; k >= 1; k--) {
    warnings.push(`line ${stack[k].line}: "${stack[k].kind} ${stack[k].name}" is never closed`);
  }

  const vdomMode = header.vdom_mode || root.children.some((b) => b.kind === "config" && b.name === "global");
  const vdoms = new Set<string>();
  const sections: Section[] = [];
  for (const b of root.children) {
    if (b.kind !== "config") continue;
    if (vdomMode && b.name === "global") {
      for (const c of b.children) if (c.kind === "config") sections.push({ vdom: null, path: c.name, block: c });
    } else if (vdomMode && b.name === "vdom") {
      for (const e of b.children) {
        if (e.kind !== "edit") continue;
        vdoms.add(e.name);
        for (const c of e.children) if (c.kind === "config") sections.push({ vdom: e.name, path: c.name, block: c });
      }
    } else {
      sections.push({ vdom: vdomMode ? null : "root", path: b.name, block: b });
    }
  }
  if (!vdomMode) vdoms.add("root");

  return {
    header,
    vdom_mode: vdomMode,
    vdoms: [...vdoms],
    sections,
    warnings,
    line_count: text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length,
  };
}

/** Every top-level block with this path, such as "firewall policy". */
export function findSections(config: ParsedConfig, path: string, vdom?: string | null): Section[] {
  return config.sections.filter((s) => s.path === path && (vdom === undefined || s.vdom === vdom));
}

/** The first value of a setting in the first block with this path. */
export function settingValue(config: ParsedConfig, path: string, key: string): string | null {
  for (const s of findSections(config, path)) {
    const v = s.block.settings[key]?.values[0];
    if (v !== undefined) return v;
  }
  return null;
}

/** The JSON the agent reads as config.json. */
export function toAgentJson(config: ParsedConfig): object {
  return {
    format: "fortigate-review config.json v1",
    header: config.header,
    vdom_mode: config.vdom_mode,
    vdoms: config.vdoms,
    line_count: config.line_count,
    warnings: config.warnings,
    sections: config.sections.map((s) => ({ vdom: s.vdom, path: s.path, ...s.block })),
  };
}

export interface ConfigSummary {
  hostname: string | null;
  model: string | null;
  version: string | null;
  build: string | null;
  vdoms: string[];
  policies: Record<string, number>;
  addresses: number;
  warnings: number;
}

export function summarize(config: ParsedConfig): ConfigSummary {
  const policies: Record<string, number> = {};
  for (const s of findSections(config, "firewall policy")) {
    const key = s.vdom ?? "global";
    policies[key] = (policies[key] ?? 0) + s.block.children.filter((c) => c.kind === "edit").length;
  }
  let addresses = 0;
  for (const s of findSections(config, "firewall address")) addresses += s.block.children.filter((c) => c.kind === "edit").length;
  return {
    hostname: settingValue(config, "system global", "hostname"),
    model: config.header.model,
    version: config.header.version,
    build: config.header.build,
    vdoms: config.vdoms,
    policies,
    addresses,
    warnings: config.warnings.length,
  };
}
