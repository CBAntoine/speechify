// "Fresh": airy, centred hero with the image in a rounded card, soft tinted sections, pill buttons.

import {
  ART_CSS,
  artDecor,
  artLayers,
  contactLines,
  ctaHref,
  esc,
  factChips,
  faqList,
  header,
  hoursList,
  icon,
  mix,
  ratingLine,
  rgba,
  testimonialCards,
  txt,
  visitButtons,
  type Ctx,
  type LayoutOutput,
} from "./common.ts";

function isLight(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

export function renderFresh(c: Ctx): LayoutOutput {
  const { p, spec } = c;
  const card = c.heroImage ? `${c.heroImage} center / cover no-repeat, ${artLayers(c, "light")}` : artLayers(c, "light");
  // Keep text on the gradient readable: darken toward deep under light ink, lighten toward accent under dark ink.
  const ctaGrad = isLight(p.primaryInk)
    ? `linear-gradient(135deg, ${p.primary} 0%, ${mix(p.primary, p.deep, 0.42)} 100%)`
    : `linear-gradient(135deg, ${p.primary} 0%, ${mix(p.primary, p.accent, 0.5)} 100%)`;
  const tagline = txt(spec.tagline);
  const primaryIcon = c.primary.href.startsWith("tel:") ? icon("phone") : "";

  const css = `
${ART_CSS}
.v-fresh{background:var(--bg)}
.v-fresh .hdr{position:sticky;top:10px;z-index:60;padding:10px 0 0}
.v-fresh .hdr-in{width:min(1180px,calc(100% - 20px));min-height:60px;padding:0 8px 0 10px;border-radius:999px;background:${rgba(p.surface, 0.86)};-webkit-backdrop-filter:saturate(1.5) blur(16px);backdrop-filter:saturate(1.5) blur(16px);border:1px solid var(--border);box-shadow:0 10px 30px ${rgba(p.ink, 0.08)}}
.v-fresh .hdr .mark{border-radius:50%;background:var(--primary-soft);color:var(--primary-text);width:40px;height:40px}
.v-fresh .hdr .btn-call{border-radius:999px}
.v-fresh .hdr .menu-btn{border-radius:50%;color:var(--ink);border-color:var(--border)}
.v-fresh .hdr.open .nav{border-radius:24px;top:calc(100% + 8px)}
.v-fresh .btn{border-radius:999px}
.v-fresh .btn-soft{background:var(--surface);color:var(--ink);border-color:var(--border);box-shadow:0 4px 14px ${rgba(p.ink, 0.06)}}
.v-fresh .pill{display:inline-flex;align-items:center;gap:8px;padding:7px 14px 7px 10px;border-radius:999px;background:var(--surface);border:1px solid var(--border);font-size:.86rem;font-weight:700;color:var(--primary-text);box-shadow:0 4px 14px ${rgba(p.ink, 0.05)};max-width:100%}
.v-fresh .pill span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v-fresh .pill svg{flex:none;width:17px;height:17px}
.v-fresh .pill.sm{font-size:.76rem;letter-spacing:.12em;text-transform:uppercase;padding:6px 14px;box-shadow:none;background:var(--primary-soft);border-color:transparent}
.v-fresh .hero{position:relative;isolation:isolate;padding:48px 0 32px;text-align:center;overflow:hidden}
.v-fresh .hero::before{content:"";position:absolute;z-index:-1;inset:-20% -30% auto -30%;height:780px;background:radial-gradient(45% 45% at 22% 28%, ${rgba(p.accent, 0.4)}, transparent 70%),radial-gradient(40% 40% at 82% 18%, ${rgba(p.primary, 0.16)}, transparent 70%)}
.v-fresh .hero-in{display:flex;flex-direction:column;align-items:center}
.v-fresh .hero h1{font-size:calc(var(--h-scale) * clamp(2.4rem,9.4vw,4.8rem));line-height:1.03;margin-top:20px;max-width:17ch}
.v-fresh .lede{margin-top:18px;font-size:clamp(1.05rem,3.6vw,1.25rem);color:var(--muted);max-width:36rem}
.v-fresh .ctas{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:28px}
.v-fresh .ctas .btn{min-height:54px;padding:.95em 1.55em}
.v-fresh .hero .rating{display:inline-flex;align-items:center;gap:10px;margin-top:22px;color:var(--muted);font-size:.95rem}
.v-fresh .hero-card{position:relative;margin:40px auto 0;aspect-ratio:4/3.2;border-radius:32px;overflow:hidden;background:${card};box-shadow:0 30px 80px ${rgba(p.ink, 0.16)};border:6px solid var(--surface)}
.v-fresh .medal{position:absolute;inset:0;margin:auto;width:clamp(110px,40%,230px);aspect-ratio:1;border-radius:32%;display:grid;place-items:center;color:var(--primary-text);background:${rgba(p.surface, 0.75)};-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 22px 50px ${rgba(p.ink, 0.13)},inset 0 0 0 1px ${rgba(p.surface, 0.9)};transform:rotate(-6deg)}
.v-fresh .medal svg{width:46%;height:46%;stroke-width:1.4;transform:rotate(6deg)}
.v-fresh .chips .chip{position:absolute;display:inline-flex;align-items:center;gap:7px;max-width:70%;padding:9px 14px;border-radius:999px;background:${rgba(p.surface, 0.95)};box-shadow:0 8px 24px ${rgba(p.ink, 0.12)};font-size:.84rem;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v-fresh .chips .chip svg{flex:none;width:16px;height:16px;color:var(--primary-text)}
.v-fresh .chips .chip:nth-child(1){top:8%;left:6%;transform:rotate(-2deg)}
.v-fresh .chips .chip:nth-child(2){bottom:9%;right:6%;transform:rotate(2deg)}
.v-fresh .chips .chip:nth-child(3){top:40%;left:4%;display:none}
.v-fresh .stars.sm svg{width:13px;height:13px}
.v-fresh .hl{padding:44px 0 8px}
.v-fresh .hl-grid{display:grid;gap:12px}
.v-fresh .hl-item{display:flex;gap:14px;align-items:center;padding:18px 20px;border-radius:22px;background:var(--surface);border:1px solid var(--border)}
.v-fresh .hl-item .hi{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:${rgba(p.accent, 0.38)};color:var(--primary-text)}
.v-fresh .hl-item .hi svg{width:21px;height:21px}
.v-fresh .hl-item b{display:block;line-height:1.3}
.v-fresh .hl-item span{display:block;color:var(--muted);font-size:.94rem}
.v-fresh .tinted{background:var(--soft);border-radius:36px;margin:24px 10px}
.v-fresh .sec-head.center{margin-inline:auto;text-align:center;display:flex;flex-direction:column;align-items:center}
.v-fresh .sec-head .rating{display:inline-flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:14px;color:var(--muted)}
.v-fresh .svc-grid{display:grid;gap:14px}
.v-fresh .svc-card{padding:24px;background:var(--surface);border-radius:26px;box-shadow:0 1px 2px ${rgba(p.ink, 0.04)};transition:transform .2s ease,box-shadow .2s ease}
.v-fresh .svc-card:hover{transform:translateY(-3px);box-shadow:var(--shadow)}
.v-fresh .svc-card .svc-icon{width:54px;height:54px;border-radius:50%;background:${rgba(p.accent, 0.38)}}
.v-fresh .svc-card h3{font-size:calc(var(--h-scale) * 1.25rem);margin-top:18px}
.v-fresh .svc-card p{color:var(--muted);margin-top:8px}
.v-fresh .about .narrow{max-width:760px;margin-inline:auto;text-align:center;display:flex;flex-direction:column;align-items:center}
.v-fresh .about h2{font-size:calc(var(--h-scale) * clamp(2rem,6.4vw,3.3rem));margin-top:14px}
.v-fresh .about p.body{margin-top:18px;font-size:1.12rem;line-height:1.75;color:var(--muted)}
.v-fresh .about .btn{margin-top:28px}
.v-fresh .rev-grid{display:grid;gap:16px}
.v-fresh .rev{margin:0;display:flex;flex-direction:column;gap:14px;padding:26px 24px;border-radius:28px;background:var(--surface);border:1px solid var(--border)}
.v-fresh .rev:nth-child(3n+2){background:var(--soft);border-color:transparent}
.v-fresh .rev blockquote{margin:0;font-size:1.05rem;line-height:1.65}
.v-fresh .rev figcaption{display:flex;justify-content:space-between;gap:12px;margin-top:auto;font-size:.9rem;color:var(--muted)}
.v-fresh .rev .who{font-weight:700;color:var(--ink)}
.v-fresh .visit-card{display:grid;gap:26px;padding:28px 24px;border-radius:32px;background:var(--surface);border:1px solid var(--border);box-shadow:0 20px 60px ${rgba(p.ink, 0.07)}}
.v-fresh .visit-card h2{font-size:calc(var(--h-scale) * clamp(1.8rem,5vw,2.6rem));margin:14px 0 20px}
.v-fresh .visit-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.v-fresh .hours-box{padding:20px 22px 10px;border-radius:24px;background:var(--soft)}
.v-fresh .hours-box h3{font-size:1.08rem;margin-bottom:6px}
.v-fresh .hours li{border-bottom-color:${rgba(p.ink, 0.1)}}
.v-fresh .faq .sec-head{margin-inline:auto}
.v-fresh .faq-wrap{max-width:820px;margin-inline:auto}
.v-fresh .faq-item{border-radius:22px}
.v-fresh .cta-card{position:relative;isolation:isolate;overflow:hidden;text-align:center;padding:52px 24px;border-radius:36px;background:${ctaGrad};color:var(--primary-ink)}
.v-fresh .cta-card::after{content:"";position:absolute;z-index:-1;width:420px;height:420px;right:-140px;top:-180px;border-radius:50%;background:${rgba(p.primaryInk, 0.1)}}
.v-fresh .cta-card h2{font-size:calc(var(--h-scale) * clamp(2rem,7vw,3.6rem));max-width:18ch;margin-inline:auto}
.v-fresh .cta-card p{margin:14px auto 0;font-size:1.1rem;max-width:34rem;opacity:.92}
.v-fresh .btn-white{margin-top:28px;background:var(--surface);color:var(--primary-text);min-height:56px;padding:1em 1.7em;box-shadow:0 12px 30px ${rgba(p.deep, 0.22)}}
.v-fresh .ftr{padding:40px 0 34px;text-align:center;color:var(--muted)}
.v-fresh .ftr-name{display:block;font-family:var(--font-h);font-weight:var(--h-weight);font-size:calc(var(--h-scale) * 1.35rem);color:var(--ink);overflow-wrap:break-word}
.v-fresh .ftr .meta{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;margin-top:12px}
.v-fresh .ftr .meta a{text-decoration:none}
.v-fresh .ftr .copy{margin-top:18px;font-size:.88rem}
@media (min-width:520px){.v-fresh .chips .chip:nth-child(3){display:inline-flex}}
@media (min-width:760px){
  .v-fresh .hero{padding:72px 0 40px}
  .v-fresh .hero-card{aspect-ratio:16/7.4;border-width:8px}
  .v-fresh .hl-grid{grid-template-columns:repeat(var(--hl-cols,3),1fr)}
  .v-fresh .svc-grid{grid-template-columns:repeat(2,1fr)}
  .v-fresh .rev-grid{grid-template-columns:repeat(2,1fr)}
  .v-fresh .visit-card{grid-template-columns:1.1fr .9fr;padding:44px}
  .v-fresh .tinted{margin:32px 20px}
  .v-fresh .cta-card{padding:76px 40px}
}
@media (min-width:980px){
  .v-fresh .svc-grid{grid-template-columns:repeat(3,1fr)}
  .v-fresh .rev-grid{grid-template-columns:repeat(3,1fr)}
}
`;

  const chips = c.heroImage ? (c.rating ? factChips(c, 1) : []) : factChips(c, 3);
  const cardInner = c.heroImage
    ? chips.length
      ? `<div class="chips">${chips.join("")}</div>`
      : ""
    : `${artDecor(c, "light")}<div class="medal" aria-hidden="true">${icon(c.icon)}</div>${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}`;

  const eyebrow = [c.nicheLabel, c.location].filter(Boolean).join(" in ");
  const hero = `<section class="hero"><div class="wrap hero-in">
  ${eyebrow ? `<span class="pill">${icon(c.icon)}<span>${esc(eyebrow)}</span></span>` : ""}
  <h1>${esc(txt(spec.heroHeadline) || c.name)}</h1>
  ${txt(spec.heroSubheadline) ? `<p class="lede">${esc(txt(spec.heroSubheadline))}</p>` : ""}
  <div class="ctas"><a class="btn btn-primary" href="${esc(c.primary.href)}">${primaryIcon}<span>${esc(c.primary.label)}</span></a><a class="btn btn-soft" href="${esc(c.secondary.href)}"${c.secondary.href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(c.secondary.label)}</a></div>
  ${ratingLine(c)}
</div><div class="wrap"><div class="hero-card" role="img" aria-label="${esc(`${c.name}${c.location ? `, ${c.location}` : ""}`)}">${cardInner}</div></div></section>`;

  const hlIcons = ["sparkle", "heart", "shield", "clock"] as const;
  const highlights = c.highlights.length
    ? `<section class="hl" aria-label="Highlights"><div class="wrap hl-grid" style="--hl-cols:${Math.min(c.highlights.length, 4)}">${c.highlights
        .map((h, i) => `<div class="hl-item"><span class="hi">${icon(hlIcons[i] ?? "check")}</span><div><b>${esc(h.label)}</b>${h.detail ? `<span>${esc(h.detail)}</span>` : ""}</div></div>`)
        .join("")}</div></section>`
    : "";

  const services = c.services.length
    ? `<section id="services" class="sec svc tinted"><div class="wrap">
  <div class="sec-head center"><span class="pill sm">Services</span><h2>${esc(tagline || "What we offer")}</h2></div>
  <div class="svc-grid" data-n="${c.services.length}">${c.services
    .map((s) => `<article class="svc-card"><span class="svc-icon">${icon(s.icon)}</span><h3>${esc(s.name)}</h3>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}</article>`)
    .join("")}</div>
</div></section>`
    : "";

  const aboutHeading = txt(spec.about?.heading) || `About ${c.name}`;
  const about = `<section id="about" class="sec about"><div class="wrap"><div class="narrow">
  <span class="pill sm">About us</span><h2>${esc(aboutHeading)}</h2>${txt(spec.about?.body) ? `<p class="body">${esc(txt(spec.about?.body))}</p>` : ""}
  <a class="btn btn-primary" href="${esc(c.primary.href)}">${primaryIcon}<span>${esc(c.primary.label)}</span></a>
</div></div></section>`;

  const reviews = c.testimonials.length
    ? `<section id="reviews" class="sec reviews"><div class="wrap">
  <div class="sec-head center"><span class="pill sm">Google reviews</span><h2>Kind words from our ${esc(c.audience)}</h2>${ratingLine(c)}</div>
  <div class="rev-grid">${testimonialCards(c, "rev")}</div>
</div></section>`
    : "";

  const visit = c.hasVisit
    ? `<section id="contact" class="sec visit"><div class="wrap"><div class="visit-card">
  <div><span class="pill sm">${c.hours.length ? "Visit" : "Contact"}</span><h2>${c.hours.length ? "Come say hello" : `Get in touch with ${esc(c.name)}`}</h2>${contactLines(c)}${visitButtons(c, "btn-primary", "btn-soft")}</div>
  ${c.hours.length ? `<div class="hours-box"><h3>Opening hours</h3>${hoursList(c)}</div>` : ""}
</div></div></section>`
    : "";

  const faq = c.faq.length
    ? `<section id="faq" class="sec faq"><div class="wrap"><div class="sec-head center"><span class="pill sm">FAQ</span><h2>Questions, answered</h2></div><div class="faq-wrap">${faqList(c)}</div></div></section>`
    : "";

  const band = spec.ctaBand ?? { heading: "", body: "", button: "" };
  const cta = `<section class="sec cta"${c.hasVisit ? "" : ' id="contact"'}><div class="wrap"><div class="cta-card">
  <h2>${esc(txt(band.heading) || "Ready when you are")}</h2>${txt(band.body) ? `<p>${esc(txt(band.body))}</p>` : ""}
  <a class="btn btn-white" href="${esc(ctaHref(c))}">${c.phoneHref ? icon("phone") : ""}<span>${esc(txt(band.button) || c.primary.label)}</span></a>
</div></div></section>`;

  const meta: string[] = [];
  if (c.address) meta.push(c.directions ? `<a href="${esc(c.directions)}" target="_blank" rel="noopener">${esc(c.address)}</a>` : `<span>${esc(c.address)}</span>`);
  else if (c.location) meta.push(`<span>${esc(c.location)}</span>`);
  if (c.phoneHref) meta.push(`<a href="${esc(c.phoneHref)}">${esc(c.phoneLabel)}</a>`);
  if (c.emailHref) meta.push(`<a href="${esc(c.emailHref)}">${esc(c.email)}</a>`);
  const footer = `<footer class="ftr"><div class="wrap"><b class="ftr-name">${esc(c.name)}</b>${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}<p class="copy">© ${c.year} ${esc(c.name)}</p></div></footer>`;

  const body = `<a id="top"></a>
${header(c, { callClass: "btn-primary" })}
<main>
${hero}
${highlights}
${services}
${about}
${reviews}
${visit}
${faq}
${cta}
</main>
${footer}`;

  return { css, body };
}
