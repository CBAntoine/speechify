// "Classic": trustworthy split hero, structured service grid, warm and professional.

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
  ratingLine,
  rgba,
  stars,
  testimonialCards,
  txt,
  visitButtons,
  type Ctx,
  type LayoutOutput,
} from "./common.ts";

export function renderClassic(c: Ctx): LayoutOutput {
  const { p, spec } = c;
  const media = c.heroImage ? `${c.heroImage} center / cover no-repeat, ${artLayers(c, "light")}` : artLayers(c, "light");
  const tagline = txt(spec.tagline);
  const primaryIcon = c.primary.href.startsWith("tel:") ? icon("phone") : "";

  const css = `
${ART_CSS}
.v-classic .topbar{display:none;background:var(--deep);color:var(--deep-ink);font-size:.88rem}
.v-classic .topbar .wrap{display:flex;align-items:center;gap:22px;min-height:40px}
.v-classic .topbar a,.v-classic .topbar span{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:${rgba(p.deepInk, 0.88)}}
.v-classic .topbar svg{width:15px;height:15px;color:var(--deep-accent)}
.v-classic .topbar .push{margin-left:auto}
.v-classic .hdr{position:sticky;top:0;z-index:60;background:${rgba(p.surface, 0.94)};-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)}
.v-classic .hdr .mark{background:var(--primary);color:var(--primary-ink);border-radius:50%}
.v-classic .hdr .menu-btn{color:var(--ink);border-color:var(--border)}
.v-classic .hero{position:relative;padding:36px 0 64px;background:linear-gradient(180deg,var(--surface) 0%,var(--bg) 100%)}
.v-classic .hero-grid{display:grid;gap:40px;align-items:center}
.v-classic .hero .eyebrow{padding:6px 12px;border-radius:999px;background:var(--primary-soft);letter-spacing:.08em}
.v-classic .hero h1{font-size:calc(var(--h-scale) * clamp(2.3rem,8.6vw,4.3rem));line-height:1.04;margin-top:18px;max-width:17ch}
.v-classic .lede{margin-top:18px;font-size:clamp(1.05rem,3.4vw,1.22rem);color:var(--muted);max-width:34rem}
.v-classic .ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;max-width:520px}
.v-classic .ctas .btn{flex:1 1 auto}
.v-classic .btn-outline{border-color:var(--border);background:var(--surface);color:var(--ink)}
.v-classic .btn-outline:hover{border-color:var(--primary-line)}
.v-classic .hero-trust{display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px;margin-top:28px;color:var(--muted);font-size:.95rem}
.v-classic .hero-trust .rating{display:inline-flex;align-items:center;gap:9px;color:var(--ink)}
.v-classic .hero-trust .loc{display:inline-flex;align-items:center;gap:7px}
.v-classic .hero-trust .loc svg{width:17px;height:17px;color:var(--primary-text)}
.v-classic .hero-media{position:relative;isolation:isolate}
.v-classic .frame{position:relative;aspect-ratio:4/3.3;border-radius:24px;overflow:hidden;background:${media};box-shadow:var(--shadow-lg);border:1px solid var(--border)}
.v-classic .frame-accent{position:absolute;z-index:-1;left:26px;right:-12px;bottom:-14px;height:64%;border-radius:24px;background:var(--accent);opacity:.45}
.v-classic .medal{position:absolute;inset:0;margin:auto;width:clamp(110px,42%,230px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;color:var(--primary-text);background:${rgba(p.surface, 0.72)};-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 20px 50px ${rgba(p.ink, 0.14)},inset 0 0 0 1px ${rgba(p.surface, 0.9)}}
.v-classic .medal svg{width:44%;height:44%;stroke-width:1.4}
.v-classic .chips .chip{position:absolute;display:inline-flex;align-items:center;gap:7px;max-width:72%;padding:8px 13px;border-radius:999px;background:${rgba(p.surface, 0.95)};box-shadow:0 6px 20px ${rgba(p.ink, 0.12)};font-size:.84rem;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v-classic .chips .chip svg{width:16px;height:16px;color:var(--primary-text);flex:none}
.v-classic .chips .chip:nth-child(1){top:7%;left:5%}
.v-classic .chips .chip:nth-child(2){bottom:8%;right:5%}
.v-classic .chips .chip:nth-child(3){top:44%;right:4%;display:none}
.v-classic .stars.sm svg{width:13px;height:13px}
.v-classic .photo-badge{position:absolute;left:-6px;bottom:22px;display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:16px;background:var(--surface);box-shadow:var(--shadow-lg);font-size:.9rem}
.v-classic .photo-badge b{font-size:1.25rem;font-family:var(--font-h)}
.v-classic .trust{background:var(--surface);border-block:1px solid var(--border)}
.v-classic .trust-grid{display:grid}
.v-classic .trust-item{display:flex;gap:14px;align-items:flex-start;padding:20px 0;border-top:1px solid var(--border)}
.v-classic .trust-item:first-child{border-top:0}
.v-classic .trust-item .ti{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--primary);color:var(--primary-ink)}
.v-classic .trust-item .ti svg{width:18px;height:18px}
.v-classic .trust-item b{display:block;font-weight:700;line-height:1.3}
.v-classic .trust-item span{display:block;color:var(--muted);font-size:.94rem}
.v-classic .svc-grid{display:grid;gap:14px}
.v-classic .svc-card{display:flex;gap:18px;align-items:flex-start;padding:24px 22px;background:var(--surface);border:1px solid var(--border);border-radius:18px;transition:border-color .2s ease,box-shadow .2s ease}
.v-classic .svc-card:hover{border-color:var(--primary-line);box-shadow:var(--shadow)}
.v-classic .svc-card .svc-icon{border-radius:12px}
.v-classic .svc-card h3{font-size:calc(var(--h-scale) * 1.2rem);line-height:1.25}
.v-classic .svc-card p{color:var(--muted);margin-top:6px;font-size:.98rem}
.v-classic .about{background:var(--surface);border-block:1px solid var(--border)}
.v-classic .about-grid{display:grid;gap:32px;align-items:start}
.v-classic .about h2{font-size:calc(var(--h-scale) * clamp(1.9rem,5.6vw,3rem));margin-top:12px}
.v-classic .about-body{margin-top:18px;font-size:1.08rem;line-height:1.75;color:var(--muted);max-width:40rem}
.v-classic .link-arrow{display:inline-flex;align-items:center;gap:8px;margin-top:22px;font-weight:700;color:var(--primary-text);text-decoration:none}
.v-classic .glance{background:var(--soft);border-radius:20px;padding:24px}
.v-classic .glance h3{font-size:1.15rem}
.v-classic .glance dl{margin:14px 0 0;display:grid}
.v-classic .glance .row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid ${rgba(p.ink, 0.08)}}
.v-classic .glance dt{color:var(--muted)}
.v-classic .glance dd{margin:0;font-weight:700;text-align:right;overflow-wrap:anywhere}
.v-classic .reviews{background:var(--soft)}
.v-classic .rev-grid{display:grid;gap:16px}
.v-classic .rev{position:relative;margin:0;display:flex;flex-direction:column;gap:14px;background:var(--surface);border-radius:18px;padding:28px 24px 22px;box-shadow:var(--shadow)}
.v-classic .rev::before{content:"\\201C";position:absolute;top:6px;right:18px;font-family:Georgia,serif;font-size:4.6rem;line-height:1;color:${rgba(p.primary, 0.16)}}
.v-classic .rev blockquote{margin:0;font-size:1.04rem;line-height:1.65}
.v-classic .rev figcaption{display:flex;justify-content:space-between;gap:12px;font-size:.9rem;color:var(--muted);margin-top:auto;padding-top:14px;border-top:1px solid var(--border)}
.v-classic .rev .who{font-weight:700;color:var(--ink)}
.v-classic .rev-sum{display:flex;align-items:center;gap:10px;margin-top:16px;color:var(--muted)}
.v-classic .visit-card{display:grid;gap:28px;background:var(--surface);border:1px solid var(--border);border-radius:24px;padding:28px 24px;box-shadow:var(--shadow)}
.v-classic .visit-card h2{font-size:calc(var(--h-scale) * clamp(1.8rem,5vw,2.6rem));margin:12px 0 20px}
.v-classic .visit-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.v-classic .hours-box h3{font-size:1.1rem;margin-bottom:6px}
.v-classic .faq-grid{display:grid;gap:8px}
.v-classic .cta-band{background:var(--primary);color:var(--primary-ink);padding:64px 0}
.v-classic .cta-in{display:grid;gap:24px;align-items:center}
.v-classic .cta-band h2{font-size:calc(var(--h-scale) * clamp(1.9rem,6vw,3rem))}
.v-classic .cta-band p{margin-top:10px;font-size:1.08rem;opacity:.92;max-width:38rem}
.v-classic .btn-light{background:var(--surface);color:var(--primary-text);min-height:56px;padding:1em 1.6em}
.v-classic .ftr{background:var(--deep);color:var(--deep-ink);padding:60px 0 26px}
.v-classic .ftr-grid{display:grid;gap:28px}
.v-classic .ftr h4{font-family:var(--font-b);font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--deep-accent);margin-bottom:14px}
.v-classic .ftr-name{display:block;font-family:var(--font-h);font-weight:var(--h-weight);font-size:calc(var(--h-scale) * 1.45rem);line-height:1.2;overflow-wrap:break-word}
.v-classic .ftr p{color:var(--deep-muted);margin-top:8px}
.v-classic .ftr .contact-lines svg{color:var(--deep-accent)}
.v-classic .ftr .hours li{border-color:var(--deep-line)}
.v-classic .ftr .hours .t{color:var(--deep-muted)}
.v-classic .ftr-base{margin-top:40px;padding-top:20px;border-top:1px solid var(--deep-line);color:var(--deep-muted);font-size:.9rem}
@media (min-width:520px){.v-classic .chips .chip:nth-child(3){display:inline-flex}}
@media (min-width:760px){
  .v-classic .trust-grid{grid-template-columns:repeat(var(--trust-cols,3),1fr);gap:28px}
  .v-classic .trust-item{border-top:0;padding:26px 0}
  .v-classic .svc-grid{grid-template-columns:repeat(2,1fr)}
  .v-classic .rev-grid{grid-template-columns:repeat(2,1fr)}
  .v-classic .visit-card{grid-template-columns:1.1fr .9fr;padding:40px}
  .v-classic .cta-in{grid-template-columns:1fr auto}
}
@media (min-width:980px){
  .v-classic .topbar{display:block}
  .v-classic .hero{padding:72px 0 96px}
  .v-classic .hero-grid{grid-template-columns:1.05fr .95fr;gap:64px}
  .v-classic .svc-grid{grid-template-columns:repeat(3,1fr)}
  .v-classic .rev-grid{grid-template-columns:repeat(3,1fr)}
  .v-classic .about-grid{grid-template-columns:1.3fr .9fr;gap:64px}
  .v-classic .faq-grid{grid-template-columns:.8fr 1.2fr;gap:56px}
  .v-classic .ftr-grid{grid-template-columns:1.3fr 1fr 1fr}
}
`;

  const topbar = `<div class="topbar"><div class="wrap">${
    c.address ? (c.directions ? `<a href="${esc(c.directions)}" target="_blank" rel="noopener">${icon("map")}${esc(c.address)}</a>` : `<span>${icon("map")}${esc(c.address)}</span>`) : c.location ? `<span>${icon("map")}${esc(c.location)}</span>` : ""
  }${c.openDays >= 5 ? `<span>${icon("clock")}Open ${c.openDays} days a week</span>` : ""}${c.phoneHref ? `<a class="push" href="${esc(c.phoneHref)}">${icon("phone")}${esc(c.phoneLabel)}</a>` : ""}</div></div>`;

  const chips = c.heroImage ? [] : factChips(c, 3);
  const mediaInner = c.heroImage
    ? ""
    : `${artDecor(c, "light")}<div class="medal" aria-hidden="true">${icon(c.icon)}</div>${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}`;
  const photoBadge =
    c.heroImage && c.rating ? `<div class="photo-badge">${stars(c.rating.stars)}<span><b>${esc(c.rating.value)}</b> · ${esc(c.rating.count)} reviews</span></div>` : "";

  const eyebrow = [c.nicheLabel, c.location].filter(Boolean).join(" in ") || tagline;
  const hero = `<section class="hero"><div class="wrap hero-grid">
  <div class="hero-copy">
    ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ""}
    <h1>${esc(txt(spec.heroHeadline) || c.name)}</h1>
    ${txt(spec.heroSubheadline) ? `<p class="lede">${esc(txt(spec.heroSubheadline))}</p>` : ""}
    <div class="ctas"><a class="btn btn-primary" href="${esc(c.primary.href)}">${primaryIcon}<span>${esc(c.primary.label)}</span></a><a class="btn btn-outline" href="${esc(c.secondary.href)}"${c.secondary.href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(c.secondary.label)}</a></div>
    <div class="hero-trust">${ratingLine(c)}${c.location ? `<span class="loc">${icon("map")}Serving ${esc(c.location)}</span>` : ""}</div>
  </div>
  <div class="hero-media"><div class="frame" role="img" aria-label="${esc(`${c.name}${c.location ? `, ${c.location}` : ""}`)}">${mediaInner}</div><div class="frame-accent" aria-hidden="true"></div>${photoBadge}</div>
</div></section>`;

  const trust = c.highlights.length
    ? `<section class="trust" aria-label="Why ${esc(c.name)}"><div class="wrap trust-grid" style="--trust-cols:${Math.min(c.highlights.length, 4)}">${c.highlights
        .map((h) => `<div class="trust-item"><span class="ti">${icon("check")}</span><div><b>${esc(h.label)}</b>${h.detail ? `<span>${esc(h.detail)}</span>` : ""}</div></div>`)
        .join("")}</div></section>`
    : "";

  const services = c.services.length
    ? `<section id="services" class="sec svc"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Our services</span><h2>How we can help</h2>${tagline ? `<p>${esc(tagline)}</p>` : ""}</div>
  <div class="svc-grid" data-n="${c.services.length}">${c.services
    .map((s) => `<article class="svc-card"><span class="svc-icon">${icon(s.icon)}</span><div><h3>${esc(s.name)}</h3>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}</div></article>`)
    .join("")}</div>
</div></section>`
    : "";

  const glanceRows: string[] = [];
  if (c.rating) glanceRows.push(`<div class="row"><dt>Google rating</dt><dd>${esc(c.rating.value)} ★ (${esc(c.rating.count)})</dd></div>`);
  if (c.location) glanceRows.push(`<div class="row"><dt>Location</dt><dd>${esc(c.location)}</dd></div>`);
  if (c.openDays) glanceRows.push(`<div class="row"><dt>Open</dt><dd>${c.openDays} days a week</dd></div>`);
  if (c.phoneHref) glanceRows.push(`<div class="row"><dt>Phone</dt><dd><a href="${esc(c.phoneHref)}">${esc(c.phoneLabel)}</a></dd></div>`);
  if (c.services.length) glanceRows.push(`<div class="row"><dt>Services</dt><dd>${c.services.length}</dd></div>`);
  const aboutHeading = txt(spec.about?.heading) || `About ${c.name}`;
  const about = `<section id="about" class="sec about"><div class="wrap about-grid">
  <div><span class="eyebrow">About us</span><h2>${esc(aboutHeading)}</h2>${txt(spec.about?.body) ? `<p class="about-body">${esc(txt(spec.about?.body))}</p>` : ""}<a class="link-arrow" href="${esc(c.primary.href)}">${esc(c.primary.label)} <span aria-hidden="true">→</span></a></div>
  ${glanceRows.length ? `<aside class="glance"><h3>${esc(c.name)} at a glance</h3><dl>${glanceRows.join("")}</dl></aside>` : ""}
</div></section>`;

  const reviews = c.testimonials.length
    ? `<section id="reviews" class="sec reviews"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Google reviews</span><h2>Trusted by our ${esc(c.audience)}</h2>${c.rating ? `<div class="rev-sum">${stars(c.rating.stars)}<span><b>${esc(c.rating.value)}</b> average from ${esc(c.rating.count)} Google reviews</span></div>` : ""}</div>
  <div class="rev-grid">${testimonialCards(c, "rev")}</div>
</div></section>`
    : "";

  const visit = c.hasVisit
    ? `<section id="contact" class="sec visit"><div class="wrap"><div class="visit-card">
  <div><span class="eyebrow">${c.hours.length ? "Visit us" : "Contact"}</span><h2>${c.hours.length ? "Hours &amp; location" : `Get in touch with ${esc(c.name)}`}</h2>${contactLines(c)}${visitButtons(c, "btn-primary", "btn-outline")}</div>
  ${c.hours.length ? `<div class="hours-box"><h3>Opening hours</h3>${hoursList(c)}</div>` : ""}
</div></div></section>`
    : "";

  const faq = c.faq.length
    ? `<section id="faq" class="sec faq"><div class="wrap faq-grid"><div class="sec-head"><span class="eyebrow">Questions</span><h2>Frequently asked</h2></div>${faqList(c)}</div></section>`
    : "";

  const band = spec.ctaBand ?? { heading: "", body: "", button: "" };
  const cta = `<section class="cta-band"${c.hasVisit ? "" : ' id="contact"'}><div class="wrap cta-in">
  <div><h2>${esc(txt(band.heading) || "Ready when you are")}</h2>${txt(band.body) ? `<p>${esc(txt(band.body))}</p>` : ""}</div>
  <a class="btn btn-light" href="${esc(ctaHref(c))}">${c.phoneHref ? icon("phone") : ""}<span>${esc(txt(band.button) || c.primary.label)}</span></a>
</div></section>`;

  const footer = `<footer class="ftr"><div class="wrap ftr-grid">
  <div><b class="ftr-name">${esc(c.name)}</b>${tagline ? `<p>${esc(tagline)}</p>` : ""}</div>
  <div><h4>Contact</h4>${contactLines(c) || (c.location ? `<p>${esc(c.location)}</p>` : "")}</div>
  ${c.hours.length ? `<div class="ftr-hours"><h4>Hours</h4>${hoursList(c)}</div>` : ""}
</div><div class="wrap ftr-base">© ${c.year} ${esc(c.name)}</div></footer>`;

  const body = `<a id="top"></a>
${topbar}
${header(c, { callClass: "btn-primary" })}
<main>
${hero}
${trust}
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
