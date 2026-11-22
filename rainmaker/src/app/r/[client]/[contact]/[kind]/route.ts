import { trackClick } from "@/lib/clients/engine";
import { clientByRef } from "@/lib/clients/repo";
import { l3 } from "@/lib/clients/templates";
import { siteUrl } from "@/lib/site";

// Tracked links in a client's messages: g = their review page (the click is
// counted and the referral ask follows), f = a customer's referral link
// (opens the client's site with the referral code), u = unsubscribe.

export const dynamic = "force-dynamic";

const page = (title: string, body: string, lang: string) =>
  new Response(
    `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 24px;color:#111"><h1 style="font-size:24px">${title}</h1><p>${body}</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: Request, { params }: { params: Promise<{ client: string; contact: string; kind: string }> }) {
  const p = await params;
  const client = await clientByRef(p.client);
  if (!client || !["g", "f", "u"].includes(p.kind)) return new Response("Not found", { status: 404 });
  const res = await trackClick(client, p.contact, p.kind as "g" | "f" | "u", { base: siteUrl(req) });
  const lang = l3(client.lang);
  if (p.kind === "u") {
    const T = {
      en: ["You're unsubscribed", `You won't get any more messages from ${esc(client.name)}.`],
      es: ["Listo, se dio de baja", `Ya no recibirá mensajes de ${esc(client.name)}.`],
      fr: ["Désabonnement confirmé", `Vous ne recevrez plus de messages de ${esc(client.name)}.`],
    }[lang];
    return page(T[0], T[1], lang);
  }
  if (res.to) return Response.redirect(res.to, 302);
  return page(client.name, lang === "es" ? "Gracias por su visita." : lang === "fr" ? "Merci de votre visite." : "Thanks for stopping by.", lang);
}
