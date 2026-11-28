// "Bold": full-bleed hero, huge headline, strong accent buttons, dark/light rhythm.

import {
  ART_CSS,
  artDecor,
  artLayers,
  contactLines,
  ctaHref,
  esc,
  faqList,
  header,
  hoursList,
  icon,
  ratingLine,
  rgba,
  testimonialCards,
  txt,
  visitButtons,
  type Ctx,
  type LayoutOutput,
} from "./common.ts";

export function renderBold(c: Ctx): LayoutOutput {
  const { p, spec } = c;
  const heroLayers = c.heroImage
    ? `linear-gradient(180deg, ${rgba(p.deep, 0.42)} 0%, ${rgba(p.deep, 0.5)} 40%, ${rgba(p.deep, 0.94)} 100%), ${c.heroImage} center / cover no-repeat, ${artLayers(c, "dark")}`
    : artLayers(c, "dark");
  const eyebrow = [c.nicheLabel, c.location].filter(Boolean).join(" · ");
  const tagline = txt(spec.tagline);
  const primaryIcon = c.primary.href.startsWith("tel:") ? icon("phone") : "";

  const css = `
${ART_CSS}
.v-bold .hdr{position:sticky;top:0;z-index:60;color:var(--deep-ink);background:${rgba(p.deep, 0.78)};-webkit-backdrop-filter:saturate(1.4) blur(14px);backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--deep-line)}
.v-bold .hdr .mark{background:var(--accent);color:var(--accent-ink)}
.v-bold .hdr .btn-call{background:var(--accent);color:var(--accent-ink)}
.v-bold .hdr.open .nav{color:var(--ink)}
.v-bold .hero{position:relative;isolation:isolate;overflow:hidden;color:var(--deep-ink);min-height:min(94svh,880px);display:flex;align-items:flex-end;margin-top:-69px;padding:150px 0 96px}
.v-bold .hero-bg{position:absolute;inset:0;z-index:-2;background:${heroLayers}}
.v-bold .hero .ms-art{z-index:-1}
.v-bold .hero-in{position:relative}
.v-bold .eyebrow{color:var(--primary-text)}
.v-bold .hero .eyebrow,.v-bold .about .eyebrow{color:var(--deep-accent)}
.v-bold .pip{width:8px;height:8px;border-radius:50%;background:var(--deep-accent);box-shadow:0 0 0 5px ${rgba(p.deepAccent, 0.2)}}
.v-bold .hero h1{font-size:calc(var(--h-scale) * clamp(2.7rem,11vw,5.9rem));line-height:.98;max-width:15ch;margin-top:18px}
.v-bold .lede{font-size:clamp(1.08rem,3.8vw,1.32rem);line-height:1.55;color:${rgba(p.deepInk, 0.88)};max-width:36rem;margin-top:22px}
.v-bold .ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px;max-width:560px}
.v-bold .ctas .btn{flex:1 1 auto}
.v-bold .btn-lg{min-height:58px;padding:1em 1.6em;font-size:1.05rem;border-radius:14px}
.v-bold .btn-accent{box-shadow:0 10px 30px ${rgba(p.accent, 0.35)}}
.v-bold .btn-ghost{border-color:${rgba(p.deepInk, 0.42)};color:var(--deep-ink);background:${rgba(p.deepInk, 0.07)}}
.v-bold .hero .rating{display:inline-flex;align-items:center;gap:10px;margin-top:30px;padding:9px 16px 9px 12px;border-radius:999px;background:${rgba(p.deepInk, 0.1)};border:1px solid ${rgba(p.deepInk, 0.18)};font-size:.95rem;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.v-bold .stats{position:relative;z-index:3;margin-top:-46px}
.v-bold .stats-card{display:grid;background:var(--surface);border-radius:22px;box-shadow:var(--shadow-lg);border:1px solid var(--border);overflow:hidden}
.v-bold .stat{display:flex;gap:14px;align-items:flex-start;padding:20px 22px;border-top:1px solid var(--border)}
.v-bold .stat:first-child{border-top:0}
.v-bold .stat .si{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--primary);color:var(--primary-ink)}
.v-bold .stat .si svg{width:20px;height:20px}
.v-bold .stat b{display:block;font-family:var(--font-h);font-weight:var(--h-weight);letter-spacing:var(--h-track);font-size:calc(var(--h-scale) * 1.18rem);line-height:1.2}
.v-bold .stat span{display:block;color:var(--muted);font-size:.95rem;margin-top:2px}
.v-bold .svc .sec-head h2{max-width:18ch}
.v-bold .svc-grid{display:grid;gap:14px}
.v-bold .svc-card{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:26px 24px 28px;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
.v-bold .svc-card:hover{transform:translateY(-3px);border-color:var(--primary-line);box-shadow:var(--shadow)}
.v-bold .svc-card .num{position:absolute;top:20px;right:22px;font-family:var(--font-h);font-weight:var(--h-weight);font-size:2.6rem;line-height:1;color:${rgba(p.primary, 0.16)}}
.v-bold .svc-card .svc-icon{background:var(--primary);color:var(--primary-ink);border-radius:15px}
.v-bold .svc-card h3{font-size:calc(var(--h-scale) * 1.32rem);margin-top:20px;padding-right:46px}
.v-bold .svc-card p{color:var(--muted);margin-top:8px}
.v-bold .about{position:relative;isolation:isolate;overflow:hidden;background:var(--deep);color:var(--deep-ink);padding:120px 0 128px;clip-path:polygon(0 0,100% 44px,100% 100%,0 calc(100% - 44px));margin:-20px 0}
.v-bold .about::before{content:"";position:absolute;z-index:-1;inset:auto -10% -40% auto;width:70vmax;height:70vmax;border-radius:50%;background:radial-gradient(closest-side,${rgba(p.primary, 0.55)},${rgba(p.primary, 0)})}
.v-bold .about-grid{display:grid;gap:26px}
.v-bold .about h2{font-size:calc(var(--h-scale) * clamp(2rem,7vw,3.6rem));margin-top:14px;max-width:16ch}
.v-bold .about-body{font-size:1.12rem;line-height:1.7;color:${rgba(p.deepInk, 0.86)};max-width:38rem}
.v-bold .about .btn{margin-top:28px}
.v-bold .about .rating{display:flex;align-items:center;gap:10px;margin-top:22px;color:${rgba(p.deepInk, 0.9)}}
.v-bold .rev-head{display:flex;flex-direction:column;gap:12px}
.v-bold .rev-head .rating{display:flex;align-items:center;gap:10px;color:var(--muted)}
.v-bold .rev-grid{display:grid;gap:16px}
.v-bold .rev{margin:0;display:flex;flex-direction:column;gap:16px;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:26px 24px;box-shadow:var(--shadow)}
.v-bold .rev blockquote{margin:0;font-size:1.06rem;line-height:1.6}
.v-bold .rev figcaption{display:flex;justify-content:space-between;gap:12px;margin-top:auto;font-size:.9rem;color:var(--muted)}
.v-bold .rev .who{font-weight:700;color:var(--ink)}
.v-bold .visit{background:var(--soft)}
.v-bold .visit-grid{display:grid;gap:28px;align-items:start}
.v-bold .visit h2{font-size:calc(var(--h-scale) * clamp(1.9rem,5.6vw,3rem));margin:12px 0 22px}
.v-bold .visit-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
.v-bold .btn-outline{border-color:var(--border);background:var(--surface);color:var(--ink)}
.v-bold .hours-card{background:var(--surface);border-radius:22px;padding:24px 24px 14px;border:1px solid var(--border);box-shadow:var(--shadow)}
.v-bold .hours-card h3{display:flex;align-items:center;gap:10px;font-size:1.2rem;margin-bottom:8px}
.v-bold .hours-card h3 svg{width:22px;height:22px;color:var(--primary-text)}
.v-bold .faq-grid{display:grid;gap:8px}
.v-bold .cta-band{position:relative;isolation:isolate;overflow:hidden;background:var(--primary);color:var(--primary-ink);padding:84px 0}
.v-bold .cta-band::after{content:"";position:absolute;z-index:-1;inset:-30% -20% auto auto;width:60vmax;height:60vmax;border-radius:50%;background:radial-gradient(closest-side,${rgba(p.accent, 0.4)},${rgba(p.accent, 0)})}
.v-bold .cta-band h2{font-size:calc(var(--h-scale) * clamp(2.1rem,8vw,4.4rem));line-height:1;max-width:16ch}
.v-bold .cta-band p{margin-top:16px;font-size:1.12rem;max-width:36rem;opacity:.92}
.v-bold .btn-dark{background:var(--deep);color:var(--deep-ink);margin-top:30px}
.v-bold .ftr{background:var(--deep-2);color:var(--deep-ink);padding:64px 0 28px}
.v-bold .ftr-grid{display:grid;gap:28px}
.v-bold .ftr-name{display:block;font-family:var(--font-h);font-weight:var(--h-weight);letter-spacing:var(--h-track);font-size:calc(var(--h-scale) * 1.5rem);line-height:1.15;overflow-wrap:break-word}
.v-bold .ftr p{color:var(--deep-muted);margin-top:8px}
.v-bold .ftr .contact-lines svg{color:var(--deep-accent)}
.v-bold .ftr .hours li{border-color:var(--deep-line)}
.v-bold .ftr .hours .t{color:var(--deep-muted)}
.v-bold .ftr-base{margin-top:44px;padding-top:22px;border-top:1px solid var(--deep-line);color:var(--deep-muted);font-size:.9rem}
@media (min-width:760px){
  .v-bold .stats-card{grid-template-columns:repeat(var(--stat-cols,3),1fr)}
  .v-bold .stat{border-top:0;border-left:1px solid var(--border);padding:26px 26px}
  .v-bold .stat:first-child{border-left:0}
  .v-bold .svc-grid{grid-template-columns:repeat(2,1fr)}
  .v-bold .rev-grid{grid-template-columns:repeat(2,1fr)}
  .v-bold .about-grid{grid-template-columns:1fr 1fr;align-items:end;gap:56px}
  .v-bold .rev-head{flex-direction:row;align-items:flex-end;justify-content:space-between}
}
@media (min-width:980px){
  .v-bold .hero{padding:180px 0 140px}
  .v-bold .svc-grid{grid-template-columns:repeat(3,1fr)}
  .v-bold .rev-grid{grid-template-columns:repeat(3,1fr)}
  .v-bold .visit-grid{grid-template-columns:1.1fr .9fr;gap:56px}
  .v-bold .faq-grid{grid-template-columns:.8fr 1.2fr;gap:56px}
  .v-bold .ftr-grid{grid-template-columns:1.2fr 1fr 1fr}
}
`;

  const stats = c.highlights.slice(0, 3);
  const statIcons = ["star", "shield", "clock"] as const;
  const statsHtml = stats.length
    ? `<section class="stats" aria-label="Highlights"><div class="wrap"><div class="stats-card" style="--stat-cols:${stats.length}">${stats
        .map(
          (h, i) =>
            `<div class="stat"><span class="si">${icon(statIcons[i] ?? "check")}</span><div><b>${esc(h.label)}</b>${h.detail ? `<span>${esc(h.detail)}</span>` : ""}</div></div>`
        )
        .join("")}</div></div></section>`
    : "";

  const services = c.services.length
    ? `<section id="services" class="sec svc"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">What we do</span><h2>${esc(tagline || `How we help our ${c.audience}`)}</h2></div>
  <div class="svc-grid" data-n="${c.services.length}">${c.services
    .map(
      (s, i) =>
        `<article class="svc-card"><span class="num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><span class="svc-icon">${icon(s.icon)}</span><h3>${esc(s.name)}</h3>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ""}</article>`
    )
    .join("")}</div>
</div></section>`
    : "";

  const aboutHeading = txt(spec.about?.heading) || `About ${c.name}`;
  const aboutBody = txt(spec.about?.body);
  const about = `<section id="about" class="about"><div class="wrap about-grid">
  <div><span class="eyebrow">About us</span><h2>${esc(aboutHeading)}</h2></div>
  <div>${aboutBody ? `<p class="about-body">${esc(aboutBody)}</p>` : ""}${c.testimonials.length ? "" : ratingLine(c)}<a class="btn btn-accent btn-lg" href="${esc(c.primary.href)}">${primaryIcon}<span>${esc(c.primary.label)}</span></a></div>
</div></section>`;

  const reviews = c.testimonials.length
    ? `<section id="reviews" class="sec reviews"><div class="wrap">
  <div class="sec-head rev-head"><div><span class="eyebrow">Google reviews</span><h2>What our ${esc(c.audience)} say</h2></div>${ratingLine(c)}</div>
  <div class="rev-grid">${testimonialCards(c, "rev")}</div>
</div></section>`
    : "";

  const visit = c.hasVisit
    ? `<section id="contact" class="sec visit"><div class="wrap visit-grid">
  <div><span class="eyebrow">${c.hours.length ? "Visit us" : "Get in touch"}</span><h2>${c.hours.length ? "Hours &amp; location" : `Talk to ${esc(c.name)}`}</h2>${contactLines(c)}${visitButtons(c, "btn-primary", "btn-outline")}</div>
  ${c.hours.length ? `<div class="hours-card"><h3>${icon("clock")}Opening hours</h3>${hoursList(c)}</div>` : ""}
</div></section>`
    : "";

  const faq = c.faq.length
    ? `<section id="faq" class="sec faq"><div class="wrap faq-grid"><div class="sec-head"><span class="eyebrow">FAQ</span><h2>Good to know</h2></div>${faqList(c)}</div></section>`
    : "";

  const band = spec.ctaBand ?? { heading: "", body: "", button: "" };
  const cta = `<section class="cta-band"${c.hasVisit ? "" : ' id="contact"'}><div class="wrap">
  <h2>${esc(txt(band.heading) || `Ready when you are`)}</h2>
  ${txt(band.body) ? `<p>${esc(txt(band.body))}</p>` : ""}
  <a class="btn btn-dark btn-lg" href="${esc(ctaHref(c))}">${c.phoneHref ? icon("phone") : ""}<span>${esc(txt(band.button) || c.primary.label)}</span></a>
</div></section>`;

  const footer = `<footer class="ftr"><div class="wrap ftr-grid">
  <div><b class="ftr-name">${esc(c.name)}</b>${tagline ? `<p>${esc(tagline)}</p>` : c.location ? `<p>${esc(c.location)}</p>` : ""}</div>
  <div>${contactLines(c)}</div>
  ${c.hours.length ? `<div class="ftr-hours">${hoursList(c)}</div>` : ""}
</div><div class="wrap ftr-base">© ${c.year} ${esc(c.name)}</div></footer>`;

  const body = `<a id="top"></a>
${header(c, { callClass: "" })}
<main>
<section class="hero"><div class="hero-bg" aria-hidden="true"></div>${c.heroImage ? "" : artDecor(c, "dark")}<div class="wrap hero-in">
  ${eyebrow ? `<p class="eyebrow"><span class="pip" aria-hidden="true"></span>${esc(eyebrow)}</p>` : ""}
  <h1>${esc(txt(spec.heroHeadline) || c.name)}</h1>
  ${txt(spec.heroSubheadline) ? `<p class="lede">${esc(txt(spec.heroSubheadline))}</p>` : ""}
  <div class="ctas"><a class="btn btn-accent btn-lg" href="${esc(c.primary.href)}">${primaryIcon}<span>${esc(c.primary.label)}</span></a><a class="btn btn-ghost btn-lg" href="${esc(c.secondary.href)}"${c.secondary.href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}>${esc(c.secondary.label)}</a></div>
  ${ratingLine(c)}
</div></section>
${statsHtml}
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
