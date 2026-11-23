/**
 * Redact secrets from a FortiOS backup before it leaves the machine.
 *
 * Every redaction keeps the same number of lines, so line numbers in the
 * redacted copy match the original backup.
 */
import { lex, type Token } from "./fortios.ts";

export const REDACTED = "<redacted>";

/**
 * Setting names whose value is a secret, whether or not FortiOS encrypted it.
 * Matches the name itself or a name ending in "-<name>" (sso-admin-password).
 */
const SECRET_NAMES =
  /^(?:.*-)?(?:password|passwd|passphrase|secret|psksecret|ppk-secret|private-key|api-key|auth-pwd|priv-pwd|authpasswd|key|key-string|md5-key|auth-key|authentication-key|shared-key|secret-key)$/;
const SECRET_PREFIXES = /^(?:psksecret|passwd|password)/;

export interface Redaction {
  line: number;
  setting: string;
  section: string;
  reason: "encrypted value" | "secret setting" | "SNMP community" | "private key";
}

export interface SanitizeResult {
  text: string;
  redactions: Redaction[];
}

function replacement(text: string, tok: Token): string {
  const raw = text.slice(tok.start, tok.end);
  const lines = raw.split("\n").length;
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const body = Array.from({ length: lines }, () => REDACTED).join(eol);
  return tok.quoted ? `"${body}"` : body;
}

export function sanitize(text: string): SanitizeResult {
  const { statements } = lex(text);
  const path: string[] = [];
  const spans: { tok: Token; redaction: Redaction }[] = [];

  for (const st of statements) {
    const [cmd, ...args] = st.tokens;
    if (cmd.value === "config") {
      path.push(args.map((a) => a.value).join(" "));
      continue;
    }
    if (cmd.value === "end") {
      path.pop();
      continue;
    }
    if (cmd.value !== "set" || args.length < 2) continue;

    const setting = args[0].value;
    const values = args.slice(1);
    const section = path.join(" > ");
    const inner = path[path.length - 1] ?? "";
    let targets: Token[] = [];
    let reason: Redaction["reason"] | null = null;

    if (values[0].value === "ENC" && values.length > 1) {
      targets = values.slice(1);
      reason = "encrypted value";
    } else if (SECRET_NAMES.test(setting) || SECRET_PREFIXES.test(setting)) {
      targets = values;
      reason = "secret setting";
    } else if (setting === "name" && /(^|\s)snmp community$/.test(inner)) {
      targets = values;
      reason = "SNMP community";
    } else if (values.some((v) => /PRIVATE KEY-----/.test(v.value))) {
      targets = values;
      reason = "private key";
    }
    if (!reason) continue;
    for (const tok of targets) {
      if (tok.value === REDACTED) continue;
      spans.push({ tok, redaction: { line: st.line, setting, section, reason } });
    }
  }

  let out = text;
  for (const { tok } of [...spans].sort((a, b) => b.tok.start - a.tok.start)) {
    out = out.slice(0, tok.start) + replacement(text, tok) + out.slice(tok.end);
  }

  const seen = new Set<string>();
  const redactions: Redaction[] = [];
  for (const { redaction } of spans) {
    const key = `${redaction.line}:${redaction.setting}`;
    if (seen.has(key)) continue;
    seen.add(key);
    redactions.push(redaction);
  }
  return { text: out, redactions };
}

/** How many settings of each kind were redacted, for the run summary. */
export function redactionCounts(redactions: Redaction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of redactions) counts[r.setting] = (counts[r.setting] ?? 0) + 1;
  return counts;
}
