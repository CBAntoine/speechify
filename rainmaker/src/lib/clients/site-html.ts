// A client's website as one self-contained HTML page: inline CSS, system
// fonts, no JavaScript, so it loads fast on any phone. One job: get a call or
// a form request. The form posts straight into instant lead follow-up. The
// same function renders the hosted page (/s/<slug>) and the HTML export.
// Pure.

import type { SiteContent } from "../types.ts";
import { l3, type L3 } from "./templates.ts";

export interface SiteRender {
  content: SiteContent;
  business: string;
  phone?: string;
  /** Display form of the phone ("(416) 555-0123"). */
  phoneLabel?: string;
  email?: string;
  address?: string;
  /** Where the form posts. */
  formAction: string;
  bookingUrl?: string;
  /** Canonical address of this page. */
  url?: string;
  rating?: number;
  reviewCount?: number;
  socials?: string[];
  /** Referral code from ?ref=, kept with the request. */
  refCode?: string;
  utm?: Record<string, string>;
  /** The visitor just sent the form. */
  sent?: boolean;
  error?: string;
  /** "Website by …" credit; empty to leave it off. */
  credit?: string;
  /** Not public yet: shown only to the agency, never indexed. */
  preview?: boolean;
}

const esc = (s: string | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const T: Record<L3, Record<string, string>> = {
  en: {
    call: "Call", callNow: "Call now", services: "What we do", why: "Why choose us", how: "How it works", reviews: "What customers say", faq: "Questions", area: "Where we work", hours: "Hours",
    name: "Your name", phone: "Mobile number", email: "Email", message: "What do you need?", service: "Service", choose: "Choose one (optional)", sms: "You can text me about my request",
    consent: "By sending, you agree that {b} may contact you about your request by phone, text or email. Message and data rates may apply. Reply STOP to opt out of texts.",
    sent: "Thanks! We got your request and will be in touch within minutes.", required: "Please add a phone number or an email address.", privacy: "Privacy",
    privacyText: "{b} uses the details you send (name, phone, email and message) only to answer your request and follow up about it, and to send texts if you allow it. We don't sell your information. To stop messages, reply STOP or ask us. To see, correct or delete your information, contact {b}.",
    reviewsLine: "{r}★ from {n} reviews", book: "Book online", or: "or", preview: "Preview: this page isn't public yet.",
  },
  es: {
    call: "Llamar", callNow: "Llamar ahora", services: "Lo que hacemos", why: "Por qué elegirnos", how: "Cómo funciona", reviews: "Lo que dicen nuestros clientes", faq: "Preguntas frecuentes", area: "Dónde trabajamos", hours: "Horario",
    name: "Su nombre", phone: "Celular", email: "Correo electrónico", message: "¿Qué necesita?", service: "Servicio", choose: "Elija uno (opcional)", sms: "Pueden escribirme por mensaje sobre mi solicitud",
    consent: "Al enviar, acepta que {b} le contacte sobre su solicitud por teléfono, mensaje o correo. Pueden aplicar cargos de mensajes y datos. Responda STOP para no recibir mensajes.",
    sent: "¡Gracias! Recibimos su solicitud y le contactaremos en minutos.", required: "Agregue un teléfono o un correo electrónico.", privacy: "Aviso de privacidad",
    privacyText: "{b} usa los datos que envía (nombre, teléfono, correo y mensaje) solo para atender su solicitud y darle seguimiento, y para enviarle mensajes si lo autoriza. No vendemos su información. Para dejar de recibir mensajes, responda STOP o pídanoslo. Para acceder, corregir o eliminar sus datos, contacte a {b}.",
    reviewsLine: "{r}★ en {n} reseñas", book: "Reservar en línea", or: "o", preview: "Vista previa: esta página aún no es pública.",
  },
  fr: {
    call: "Appeler", callNow: "Appeler maintenant", services: "Nos services", why: "Pourquoi nous choisir", how: "Comment ça marche", reviews: "Ce que disent nos clients", faq: "Questions", area: "Où nous travaillons", hours: "Heures",
    name: "Votre nom", phone: "Cellulaire", email: "Courriel", message: "De quoi avez-vous besoin?", service: "Service", choose: "Choisissez (facultatif)", sms: "Vous pouvez m'écrire par texto au sujet de ma demande",
    consent: "En envoyant, vous acceptez que {b} vous contacte au sujet de votre demande par téléphone, texto ou courriel. Des frais de messagerie peuvent s'appliquer. Répondez STOP pour ne plus recevoir de textos.",
    sent: "Merci! Nous avons bien reçu votre demande et vous répondrons d'ici quelques minutes.", required: "Ajoutez un numéro de téléphone ou un courriel.", privacy: "Confidentialité",
    privacyText: "{b} utilise les renseignements que vous envoyez (nom, téléphone, courriel et message) uniquement pour répondre à votre demande et en faire le suivi, et pour vous écrire par texto si vous l'autorisez. Nous ne vendons pas vos renseignements. Pour ne plus recevoir de messages, répondez STOP ou demandez-le-nous. Pour consulter, corriger ou supprimer vos renseignements, contactez {b}.",
    reviewsLine: "{r}★ sur {n} avis", book: "Réserver en ligne", or: "ou", preview: "Aperçu : cette page n'est pas encore publique.",
  },
};

/** Black or white text on a colour, whichever reads better. */
export function inkOn(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.45 ? "#111111" : "#ffffff";
}

function css(c: SiteContent["colors"]): string {
  const on = inkOn(c.primary);
  return `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:${c.ink};background:#fff}
a{color:inherit}img{max-width:100%}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid #eee}
.bar{display:flex;align-items:center;gap:12px;height:60px}.logo{font-weight:750;font-size:17px;letter-spacing:-.01em;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:999px;font-weight:650;text-decoration:none;border:0;font-size:16px;cursor:pointer}
.btn.p{background:${c.primary};color:${on}}.btn.s{background:${c.soft};color:${c.ink}}.bar .btn{min-height:40px;padding:0 16px;font-size:15px}
.hero{background:linear-gradient(180deg,${c.soft},#fff);padding:56px 0 44px}.badge{display:inline-block;background:#fff;border:1px solid ${c.primary}33;color:${c.ink};border-radius:999px;padding:5px 12px;font-size:14px;font-weight:600;margin-bottom:16px}
h1{font-size:clamp(30px,6vw,50px);line-height:1.08;letter-spacing:-.025em;margin:0 0 14px;max-width:16ch}h2{font-size:clamp(23px,4vw,32px);letter-spacing:-.02em;line-height:1.15;margin:0 0 20px}h3{font-size:18px;margin:0 0 6px}
.sub{font-size:clamp(17px,2.4vw,20px);color:#444;max-width:46ch;margin:0 0 26px}.ctas{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.stars{margin-top:18px;color:#555;font-size:15px}
section{padding:48px 0}section.alt{background:#fafafa}.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.card{background:#fff;border:1px solid #ececec;border-radius:16px;padding:20px}.card p{margin:0;color:#555}.num{display:inline-flex;width:30px;height:30px;border-radius:50%;background:${c.primary};color:${on};align-items:center;justify-content:center;font-weight:700;margin-bottom:10px}
blockquote{margin:0;font-size:17px}blockquote footer{margin-top:10px;color:#666;font-size:14px}details{border-bottom:1px solid #eee;padding:14px 0}summary{font-weight:650;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}summary:after{content:"+";float:right;color:#888}details[open] summary:after{content:"−"}details p{color:#555;margin:10px 0 0}
.two{display:grid;gap:28px;grid-template-columns:1fr}@media(min-width:820px){.two{grid-template-columns:1fr 1fr}}
form{display:grid;gap:12px;background:#fff;border:1px solid #e6e6e6;border-radius:18px;padding:22px;box-shadow:0 10px 30px -18px rgba(0,0,0,.25)}
label{display:grid;gap:5px;font-size:14px;font-weight:600}input,select,textarea{font:inherit;padding:12px 14px;border:1px solid #d6d6d6;border-radius:12px;width:100%;background:#fff;color:inherit}textarea{min-height:96px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:2px solid ${c.primary};outline-offset:1px}.check{display:flex;gap:10px;align-items:flex-start;font-weight:500}.check input{width:20px;height:20px;margin-top:2px;flex:none}
.fine{font-size:12.5px;color:#666;line-height:1.45;margin:0}.ok{background:#e9f7ef;color:#155d34;border-radius:12px;padding:14px 16px;font-weight:600}.err{background:#fdecec;color:#8a1c1c;border-radius:12px;padding:12px 16px}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}footer.site{padding:36px 0 110px;color:#666;font-size:14px;border-top:1px solid #eee}footer.site details{border:0;padding:8px 0}
.callbar{position:fixed;left:12px;right:12px;bottom:12px;z-index:9;display:flex;gap:8px}.callbar .btn{flex:1;min-width:0;padding:0 14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 10px 26px -10px rgba(0,0,0,.45)}@media(min-width:820px){.callbar{display:none}footer.site{padding-bottom:40px}}
section[id]{scroll-margin-top:76px}.bar .btn{white-space:nowrap}@media(max-width:520px){.bar .num{display:none}}
.preview{background:#111;color:#fff;text-align:center;font-size:13px;padding:6px}`;
}

export function renderSite(r: SiteRender): string {
  const c = r.content;
  const t = T[l3(c.lang)];
  const sub = (s: string) => s.replace(/\{b\}/g, esc(r.business));
  const tel = r.phone ? `tel:${r.phone.replace(/[^\d+]/g, "")}` : undefined;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: r.business,
    description: c.seoDescription,
    ...(r.url ? { url: r.url } : {}),
    ...(r.phone ? { telephone: r.phone } : {}),
    ...(r.email ? { email: r.email } : {}),
    ...(r.address ? { address: r.address } : {}),
    ...(c.serviceArea ? { areaServed: c.serviceArea } : {}),
    ...(r.socials?.length ? { sameAs: r.socials } : {}),
    ...(r.rating && r.reviewCount ? { aggregateRating: { "@type": "AggregateRating", ratingValue: r.rating, reviewCount: r.reviewCount } } : {}),
  };
  const hidden = [
    r.refCode ? `<input type="hidden" name="ref" value="${esc(r.refCode)}">` : "",
    ...Object.entries(r.utm ?? {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`),
  ].join("");
  const stars = r.rating && r.reviewCount ? `<p class="stars">${esc(t.reviewsLine.replace("{r}", r.rating.toFixed(1)).replace("{n}", String(r.reviewCount)))}</p>` : "";
  const list = (items: { title: string; text: string }[], numbered = false) =>
    `<div class="grid">${items.map((x, i) => `<div class="card">${numbered ? `<span class="num">${i + 1}</span>` : ""}<h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>`).join("")}</div>`;

  return `<!doctype html>
<html lang="${esc(c.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(c.seoTitle || r.business)}</title>
<meta name="description" content="${esc(c.seoDescription)}">
${r.preview ? '<meta name="robots" content="noindex,nofollow">' : ""}
${r.url ? `<link rel="canonical" href="${esc(r.url)}">` : ""}
<meta property="og:title" content="${esc(c.seoTitle || r.business)}">
<meta property="og:description" content="${esc(c.seoDescription)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="${esc(c.colors.primary)}">
<style>${css(c.colors)}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
${r.preview ? `<div class="preview">${esc(t.preview)}</div>` : ""}
<header><div class="wrap bar"><span class="logo">${esc(r.business)}</span>${tel ? `<a class="btn p" href="${tel}">${esc(t.call)}${r.phoneLabel ? `<span class="num">&nbsp;${esc(r.phoneLabel)}</span>` : ""}</a>` : `<a class="btn p" href="#contact">${esc(c.cta)}</a>`}</div></header>
<main>
<section class="hero"><div class="wrap">
${c.offer ? `<span class="badge">${esc(c.offer)}</span>` : ""}
<h1>${esc(c.headline)}</h1>
<p class="sub">${esc(c.subheadline)}</p>
<div class="ctas"><a class="btn p" href="${r.bookingUrl ? esc(r.bookingUrl) : "#contact"}">${esc(c.cta)}</a>${tel ? `<a class="btn s" href="${tel}">${esc(t.callNow)}</a>` : ""}</div>
${stars}
</div></section>
${c.services.length ? `<section><div class="wrap"><h2>${esc(t.services)}</h2>${list(c.services)}</div></section>` : ""}
${c.benefits.length ? `<section class="alt"><div class="wrap"><h2>${esc(t.why)}</h2>${list(c.benefits)}</div></section>` : ""}
${c.steps.length ? `<section><div class="wrap"><h2>${esc(t.how)}</h2>${list(c.steps, true)}</div></section>` : ""}
${c.testimonials.length ? `<section class="alt"><div class="wrap"><h2>${esc(t.reviews)}</h2><div class="grid">${c.testimonials.map((q) => `<div class="card"><blockquote>“${esc(q.quote)}”<footer>${esc(q.author)}</footer></blockquote></div>`).join("")}</div></div></section>` : ""}
<section id="contact"><div class="wrap two">
<div>
<h2>${esc(c.formTitle)}</h2>
<p class="sub" style="font-size:17px">${esc(c.about)}</p>
${c.serviceArea ? `<p><strong>${esc(t.area)}:</strong> ${esc(c.serviceArea)}</p>` : ""}
${c.hours.length ? `<p><strong>${esc(t.hours)}:</strong><br>${c.hours.map(esc).join("<br>")}</p>` : ""}
${r.address ? `<p>${esc(r.address)}</p>` : ""}
</div>
<form method="post" action="${esc(r.formAction)}">
${r.sent ? `<div class="ok" role="status">${esc(t.sent)}</div>` : ""}
${r.error ? `<div class="err" role="alert">${esc(r.error === "required" ? t.required : r.error)}</div>` : ""}
<label>${esc(t.name)}<input name="name" autocomplete="name" maxlength="120" required></label>
<label>${esc(t.phone)}<input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="40"></label>
<label>${esc(t.email)}<input name="email" type="email" autocomplete="email" maxlength="200"></label>
${c.services.length > 1 ? `<label>${esc(t.service)}<select name="interest"><option value="">${esc(t.choose)}</option>${c.services.map((s) => `<option>${esc(s.title)}</option>`).join("")}</select></label>` : ""}
<label>${esc(t.message)}<textarea name="message" maxlength="2000"></textarea></label>
<label class="check"><input type="checkbox" name="sms_consent" value="yes"> ${esc(t.sms)}</label>
<div class="hp" aria-hidden="true"><label>Company website<input name="company_url" tabindex="-1" autocomplete="off"></label></div>
${hidden}
<button class="btn p" type="submit">${esc(c.formButton)}</button>
<p class="fine">${sub(esc(t.consent))}</p>
</form>
</div></section>
${c.faqs.length ? `<section class="alt"><div class="wrap"><h2>${esc(t.faq)}</h2>${c.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div></section>` : ""}
</main>
<footer class="site"><div class="wrap">
<p><strong>${esc(r.business)}</strong>${r.address ? ` · ${esc(r.address)}` : ""}${r.phoneLabel ? ` · ${esc(r.phoneLabel)}` : ""}${r.email ? ` · ${esc(r.email)}` : ""}</p>
<details><summary>${esc(t.privacy)}</summary><p>${sub(esc(t.privacyText))}</p></details>
${r.credit ? `<p class="fine">${esc(r.credit)}</p>` : ""}
</div></footer>
<div class="callbar">${tel ? `<a class="btn p" href="${tel}">${esc(t.callNow)}</a>` : ""}<a class="btn ${tel ? "s" : "p"}" href="${r.bookingUrl ? esc(r.bookingUrl) : "#contact"}">${esc(c.cta)}</a></div>
</body>
</html>`;
}
