// Reading a business's customer list: whatever their booking system or
// spreadsheet exports (comma, semicolon or tab separated; English, Spanish
// or French headers; any phone format). Pure.

import { toE164 } from "../phone.ts";

/** RFC 4180-style parsing with the separator guessed from the first line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].map((s) => ({ s, n: firstLine.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

export type Field = "name" | "first" | "last" | "phone" | "email" | "lastVisit" | "interest" | "notes";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const ALIASES: Record<Field, string[]> = {
  name: ["name", "full name", "customer", "customer name", "client", "client name", "contact", "contact name", "patient", "patient name", "nombre", "nombre completo", "cliente", "paciente", "nom", "nom complet"],
  first: ["first name", "first", "given name", "firstname", "nombres", "nombre s", "prenom"],
  last: ["last name", "last", "surname", "family name", "lastname", "apellido", "apellidos", "nom de famille"],
  phone: ["phone", "phone number", "mobile", "mobile phone", "mobile number", "cell", "cell phone", "cellphone", "telephone", "tel", "telefono", "celular", "movil", "whatsapp", "numero", "cellulaire", "portable", "numero de telephone"],
  email: ["email", "e mail", "email address", "mail", "correo", "correo electronico", "courriel", "adresse courriel", "adresse e mail"],
  lastVisit: ["last visit", "last service", "last appointment", "last order", "last purchase", "last job", "visit date", "date", "service date", "ultima visita", "fecha", "ultima cita", "derniere visite", "date de visite"],
  interest: ["service", "services", "interest", "product", "treatment", "job", "servicio", "tratamiento", "producto", "traitement", "produit"],
  notes: ["notes", "note", "comments", "comment", "notas", "comentarios", "commentaires", "remarques"],
};

/** Which column holds which field, from the header row. */
export function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  const cells = header.map(fold);
  for (const field of Object.keys(ALIASES) as Field[]) {
    const exact = cells.findIndex((c) => ALIASES[field].includes(c));
    if (exact >= 0 && !Object.values(map).includes(exact)) map[field] = exact;
  }
  for (const field of Object.keys(ALIASES) as Field[]) {
    if (map[field] !== undefined) continue;
    const loose = cells.findIndex((c, i) => !Object.values(map).includes(i) && ALIASES[field].some((a) => a.length > 3 && c.includes(a)));
    if (loose >= 0) map[field] = loose;
  }
  return map;
}

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$/i;

/** No header row: guess columns from what's in them. */
function sniff(rows: string[][]): Partial<Record<Field, number>> {
  const width = Math.max(...rows.map((r) => r.length));
  const sample = rows.slice(0, 20);
  const share = (i: number, test: (v: string) => boolean) => sample.filter((r) => r[i] && test(r[i])).length / Math.max(1, sample.length);
  const map: Partial<Record<Field, number>> = {};
  for (let i = 0; i < width; i++) {
    if (map.email === undefined && share(i, (v) => EMAIL.test(v)) > 0.5) map.email = i;
    else if (map.phone === undefined && share(i, (v) => v.replace(/\D/g, "").length >= 7 && /^[\d\s()+.-]+$/.test(v)) > 0.5) map.phone = i;
    else if (map.name === undefined && share(i, (v) => /\p{L}{2,}/u.test(v) && !/\d{3}/.test(v)) > 0.5) map.name = i;
  }
  return map;
}

/** "2024-03-15", "03/15/2024", "15/03/2024", "15.03.24" → "2024-03-15". Day-first unless the country writes month-first. */
export function parseDate(raw: string | undefined, monthFirst = true): string | undefined {
  const t = (raw ?? "").trim();
  if (!t) return undefined;
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined);
  if (iso) return ok(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
  }
  let [a, b] = [Number(m[1]), Number(m[2])];
  let y = Number(m[3]);
  if (y < 100) y += y > 50 ? 1900 : 2000;
  if (a > 12) return ok(y, b, a);
  if (b > 12) return ok(y, a, b);
  return monthFirst ? ok(y, a, b) : ok(y, b, a);
}

export interface ImportRow {
  name: string;
  phone?: string;
  email?: string;
  lastVisit?: string;
  interest?: string;
  notes?: string;
}

export interface ImportResult {
  rows: ImportRow[];
  /** Data rows read (header excluded). */
  total: number;
  skipped: { line: number; reason: string }[];
  /** Which header each field came from, for showing the mapping. */
  columns: Partial<Record<Field, string>>;
  duplicates: number;
}

export const MAX_IMPORT = 10_000;

export function readContacts(text: string, country = "US"): ImportResult {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], total: 0, skipped: [], columns: {}, duplicates: 0 };
  let map = mapHeader(rows[0]);
  let header = true;
  if (map.phone === undefined && map.email === undefined) {
    map = sniff(rows);
    header = false;
  }
  const body = header ? rows.slice(1) : rows;
  const columns: Partial<Record<Field, string>> = {};
  for (const [f, i] of Object.entries(map) as [Field, number][]) columns[f] = header ? rows[0][i] : `Column ${i + 1}`;
  const monthFirst = ["US", "CA", "PR"].includes(country.toUpperCase());
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  const skipped: ImportResult["skipped"] = [];
  let duplicates = 0;
  body.slice(0, MAX_IMPORT).forEach((r, k) => {
    const line = k + (header ? 2 : 1);
    const get = (f: Field) => (map[f] !== undefined ? (r[map[f]!] ?? "").trim() : "");
    const name = (get("name") || [get("first"), get("last")].filter(Boolean).join(" ")).replace(/\s+/g, " ").slice(0, 120);
    const emailRaw = get("email").toLowerCase();
    const email = EMAIL.test(emailRaw) ? emailRaw : undefined;
    const phone = toE164(get("phone"), country);
    if (!phone && !email) {
      skipped.push({ line, reason: get("phone") || emailRaw ? "Phone or email doesn't look valid" : "No phone or email" });
      return;
    }
    const key = phone ?? email!;
    if (seen.has(key) || (phone && email && seen.has(email))) {
      duplicates++;
      return;
    }
    seen.add(key);
    if (email) seen.add(email);
    out.push({
      name: name || email?.split("@")[0] || phone!,
      phone,
      email,
      lastVisit: parseDate(get("lastVisit"), monthFirst),
      interest: get("interest").slice(0, 120) || undefined,
      notes: get("notes").slice(0, 500) || undefined,
    });
  });
  if (body.length > MAX_IMPORT) skipped.push({ line: MAX_IMPORT + 2, reason: `Only the first ${MAX_IMPORT.toLocaleString("en-US")} rows are imported at once` });
  return { rows: out, total: body.length, skipped, columns, duplicates };
}
