import "server-only";
import { resendEnabled } from "@/lib/config";

/** The address part of RESEND_FROM ("Sam at Acme <sam@acme.co>" → "sam@acme.co"). */
export function senderAddress(): string | undefined {
  const from = process.env.RESEND_FROM?.trim();
  if (!from) return undefined;
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? from;
}

/**
 * RESEND_FROM's address under another display name, so a client's customers
 * see the business they know ("Lakeside Dental <hello@agency.co>"). The
 * domain stays the agency's verified one; replies go to the client.
 */
export function brandedFrom(displayName: string): string | undefined {
  const address = senderAddress();
  if (!address) return undefined;
  const name = displayName.replace(/["<>\r\n]/g, "").trim().slice(0, 70);
  return name ? `"${name}" <${address}>` : address;
}

/** Send a plain-text email through Resend's REST API. */
export async function sendEmail(input: { to: string; subject: string; text: string; replyTo?: string; from?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  if (!resendEnabled()) throw new Error("Set RESEND_API_KEY and RESEND_FROM to send from Rainmaker");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: input.from ?? process.env.RESEND_FROM,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !data.id) throw new Error(`Email not sent: ${data.message ?? `HTTP ${res.status}`}`);
  return { id: data.id };
}
