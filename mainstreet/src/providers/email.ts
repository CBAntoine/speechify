import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MAIL_FROM, PRICES, features, keys } from "../config.ts";
import { addCost } from "../db.ts";
import type { AgentId } from "../types.ts";
import { fetchWithTimeout, newId } from "../util.ts";

// Email through Resend. Without a Resend key (or in demo mode) every email
// lands in data/outbox/ instead, so you can read exactly what would have gone
// out. Reserved test domains (.example, .invalid, .test) are never sent.

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  unsubscribeUrl?: string;
  agent: AgentId;
  leadId?: string;
  tags?: Record<string, string>;
}

const TEST_DOMAIN = /\.(example|invalid|test|localhost)$/i;

export function canSendEmail(): boolean {
  return features.resend;
}

export async function sendEmail(e: OutgoingEmail): Promise<{ id: string; simulated: boolean }> {
  const domain = e.to.split("@")[1] ?? "";
  if (!features.resend || TEST_DOMAIN.test(domain)) {
    const id = newId("outbox");
    const dir = path.join(DATA_DIR, "outbox");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${id}.txt`),
      [`To: ${e.to}`, `Subject: ${e.subject}`, e.replyTo ? `Reply-To: ${e.replyTo}` : "", e.unsubscribeUrl ? `List-Unsubscribe: <${e.unsubscribeUrl}>` : "", "", e.text].filter((l, i) => l || i > 3).join("\n"),
    );
    return { id, simulated: true };
  }
  const res = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${keys.resend}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [e.to],
      subject: e.subject,
      text: e.text,
      ...(e.html ? { html: e.html } : {}),
      ...(e.replyTo ? { reply_to: e.replyTo } : {}),
      headers: e.unsubscribeUrl ? { "List-Unsubscribe": `<${e.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      tags: Object.entries(e.tags ?? {}).map(([name, value]) => ({ name, value: value.replace(/[^\w-]/g, "_").slice(0, 256) })),
    }),
    timeoutMs: 20_000,
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !data.id) throw new Error(`Resend: ${data.message ?? data.name ?? `HTTP ${res.status}`}`);
  addCost({ provider: "resend", agent: e.agent, leadId: e.leadId, usd: PRICES.resendEmail, units: 1, unit: "email" });
  return { id: data.id, simulated: false };
}

/** Plain-text email to HTML that still looks like a personal note, not a newsletter. */
export function textToHtml(text: string, opts: { poster?: { src: string; href: string; alt: string } } = {}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#0b57d0">${u}</a>`);
  const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${linkify(p).replace(/\n/g, "<br>")}</p>`);
  if (opts.poster) {
    const img = `<p style="margin:0 0 14px"><a href="${esc(opts.poster.href)}"><img src="${esc(opts.poster.src)}" alt="${esc(opts.poster.alt)}" width="240" style="border-radius:14px;display:block;max-width:240px;height:auto;border:0"></a></p>`;
    paras.splice(Math.min(2, paras.length), 0, img);
  }
  return `<!doctype html><html><body style="margin:0;padding:24px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;background:#ffffff"><div style="max-width:560px">${paras.join("")}</div></body></html>`;
}
