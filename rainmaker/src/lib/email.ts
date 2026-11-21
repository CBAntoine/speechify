import "server-only";
import { resendEnabled } from "@/lib/config";

/** Send a plain-text email through Resend's REST API. */
export async function sendEmail(input: { to: string; subject: string; text: string; replyTo?: string }): Promise<{ id: string }> {
  if (!resendEnabled()) throw new Error("Set RESEND_API_KEY and RESEND_FROM to send from Rainmaker");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !data.id) throw new Error(`Email not sent: ${data.message ?? `HTTP ${res.status}`}`);
  return { id: data.id };
}
