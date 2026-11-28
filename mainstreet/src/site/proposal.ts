// The page a business owner opens from our email or DM, usually on a phone.
// It shows the video, the three mockups in phone frames, what we noticed,
// what's included and the price, with one obvious button: claim it.

import type { VariantId } from "../types.ts";
import { esc, icon, safeHref, txt } from "./templates/common.ts";

export interface ProposalInput {
  token: string;
  business: { name: string; city: string; nicheLabel: string };
  agency: { name: string; ownerName: string; email: string; phone?: string; postalAddress: string; bookingUrl?: string };
  variants: { id: VariantId; label: string; url: string; thumbUrl?: string }[];
  video?: { url: string; poster: string };
  /** "What we noticed" bullets (diagnosis evidence, plain words). */
  noticed: string[];
  /** "$500" */
  priceLabel: string;
  /** "then $29/mo hosting (optional)" */
  hostingLabel?: string;
  deliveryDays: number;
  guarantee: string;
  /** "/p/<token>/claim" */
  claimUrl: string;
  /** "/u/<token>" */
  unsubscribeUrl: string;
  state: "open" | "paid" | "closed";
}

const FONTS = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap";

const CSS = `
:root{--bg:#F8F7F3;--surface:#FFFFFF;--ink:#15171B;--muted:#5A5F67;--line:#E6E3DC;--accent:#0B7A55;--accent-ink:#FFFFFF;--accent-soft:#E6F3EC;--warm:#F1EEE6}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.6 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,h3{font-family:"Fraunces",Georgia,serif;font-weight:600;letter-spacing:-.015em;line-height:1.08;margin:0;text-wrap:balance;overflow-wrap:break-word}
p{margin:0}
ul{margin:0;padding:0;list-style:none}
a{color:inherit;text-underline-offset:3px}
img,svg,video,iframe{display:block;max-width:100%}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:6px}
.wrap{width:min(1080px,calc(100% - 36px));margin-inline:auto}
.top{border-bottom:1px solid var(--line);background:var(--surface)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:58px}
.agency{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;min-width:0}
.agency .dot{flex:none;width:28px;height:28px;border-radius:9px;background:var(--ink);color:#fff;display:grid;place-items:center;font-size:.8rem;font-weight:800}
.agency span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.for{flex:none;max-width:52%;font-size:.8rem;font-weight:600;color:var(--accent);background:var(--accent-soft);padding:6px 11px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:52px;padding:.85em 1.4em;border-radius:14px;border:1.5px solid transparent;font:700 1rem/1.15 "Inter",system-ui,sans-serif;text-decoration:none;cursor:pointer;text-align:center;transition:transform .15s ease,box-shadow .15s ease}
.btn:hover{transform:translateY(-1px)}
.btn svg{width:19px;height:19px;flex:none}
.btn-claim{background:var(--accent);color:var(--accent-ink);box-shadow:0 12px 28px rgba(11,122,85,.28);min-height:58px;font-size:1.06rem;padding:1em 1.6em}
.btn-ghost{background:var(--surface);color:var(--ink);border-color:var(--line)}
.hero{padding:48px 0 34px;text-align:center}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.kicker .live{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px rgba(11,122,85,.15)}
.hero h1{font-size:clamp(2.35rem,9.6vw,4.4rem);margin:18px auto 0;max-width:16ch}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero .sub{margin:18px auto 0;max-width:34rem;font-size:clamp(1.05rem,3.6vw,1.2rem);color:var(--muted)}
.hero-cta{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:28px}
.fine{margin-top:12px;font-size:.88rem;color:var(--muted)}
.sec{padding:44px 0}
.sec-h{text-align:center;max-width:40rem;margin:0 auto 26px}
.sec-h h2{font-size:clamp(1.8rem,6.6vw,2.7rem)}
.sec-h p{margin-top:10px;color:var(--muted)}
.intro{display:grid;gap:26px;align-items:center}
.vframe{width:min(100%,340px);margin-inline:auto;aspect-ratio:9/16;border-radius:28px;overflow:hidden;background:#0d0f12;box-shadow:0 30px 70px rgba(21,23,27,.22);border:6px solid #0d0f12}
.vframe video{width:100%;height:100%;object-fit:cover;background:#0d0f12}
.vcap{margin-top:12px;text-align:center;font-size:.9rem;color:var(--muted)}
.noticed{background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:26px 22px}
.noticed h2{font-size:clamp(1.6rem,5.4vw,2.1rem)}
.noticed .lead{margin-top:8px;color:var(--muted)}
.noticed ul{display:grid;gap:12px;margin-top:20px}
.noticed li{display:flex;gap:12px;align-items:flex-start}
.noticed li .n{flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--warm);font-size:.8rem;font-weight:800;margin-top:1px}
.phones{display:flex;gap:18px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 18px 18px;margin:0 -18px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.phones::-webkit-scrollbar{display:none}
.phone-card{flex:none;margin:0;scroll-snap-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}
.phone{position:relative;display:block;width:260px;padding:9px;border-radius:40px;background:#111317;box-shadow:0 24px 60px rgba(21,23,27,.22),inset 0 0 0 1.5px #2a2d33;text-decoration:none}
.phone .notch{position:absolute;z-index:2;top:13px;left:50%;width:76px;height:20px;margin-left:-38px;border-radius:999px;background:#111317}
.screen{position:relative;display:block;width:242px;height:484px;border-radius:31px;overflow:hidden;background:#f2f1ed center 26px / cover no-repeat}
.screen::before{content:"";position:absolute;z-index:1;top:0;left:0;right:0;height:26px;background:#111317}
.screen iframe{position:absolute;top:26px;left:0;width:390px;max-width:none;height:780px;border:0;transform:scale(.62051);transform-origin:0 0;pointer-events:none;background:#fff}
.phone:hover{transform:translateY(-3px)}
.phone{transition:transform .2s ease}
.phone-card figcaption{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}
.phone-card figcaption b{font-size:1.02rem}
.phone-card figcaption a{font-size:.92rem;font-weight:600;color:var(--accent);text-decoration:none}
.swipe{margin-top:4px;text-align:center;font-size:.85rem;color:var(--muted)}
.deal{display:grid;gap:22px;align-items:start}
.included{background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:26px 22px}
.included h2{font-size:clamp(1.6rem,5.4vw,2.1rem)}
.checks{display:grid;gap:14px;margin-top:20px}
.checks li{display:flex;gap:12px;align-items:flex-start}
.checks svg{flex:none;width:22px;height:22px;padding:3px;border-radius:50%;background:var(--accent-soft);color:var(--accent);margin-top:1px;stroke-width:2.4}
.price-card{position:relative;background:var(--ink);color:#fff;border-radius:26px;padding:30px 24px;box-shadow:0 30px 70px rgba(21,23,27,.25);overflow:hidden;isolation:isolate}
.price-card::after{content:"";position:absolute;z-index:-1;width:360px;height:360px;right:-160px;top:-160px;border-radius:50%;background:radial-gradient(closest-side,rgba(46,196,138,.35),rgba(46,196,138,0))}
.price-card .label{font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9fd9c1}
.price-card .amount{font-family:"Fraunces",Georgia,serif;font-size:clamp(3rem,13vw,4.2rem);font-weight:600;line-height:1;margin-top:10px;letter-spacing:-.02em}
.price-card .hosting{margin-top:8px;color:rgba(255,255,255,.72)}
.price-card .facts{display:grid;gap:10px;margin:22px 0 24px}
.price-card .facts li{display:flex;gap:10px;align-items:flex-start;color:rgba(255,255,255,.9)}
.price-card .facts svg{flex:none;width:20px;height:20px;color:#7fd6b2;margin-top:2px}
.price-card .btn-claim{width:100%;background:#2EC48A;color:#0B1B14;box-shadow:0 12px 30px rgba(46,196,138,.3)}
.price-card .alt{display:grid;gap:10px;margin-top:12px}
.price-card .btn-ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.24)}
.faq-list{display:grid;gap:10px;max-width:760px;margin:0 auto}
.faq-item{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.faq-item summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:17px 18px;cursor:pointer;list-style:none;font-weight:700}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item .pm{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--warm);font-size:1.1rem;transition:transform .2s ease}
.faq-item[open] .pm{transform:rotate(45deg)}
.faq-item .a{padding:0 18px 18px;color:var(--muted)}
.steps{display:grid;gap:14px;max-width:640px;margin:0 auto}
.step{display:flex;gap:16px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:20px}
.step .num{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800}
.step b{display:block}
.step span{display:block;color:var(--muted);margin-top:2px}
.contact-row{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:22px}
.foot{padding:40px 0 30px;margin-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem;text-align:center}
.foot b{color:var(--ink)}
.foot p+p{margin-top:6px}
.foot .addr{white-space:pre-line}
.foot .unsub{display:inline-block;margin-top:14px;color:var(--muted)}
.sticky{position:sticky;bottom:0;z-index:40;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:rgba(248,247,243,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid var(--line)}
.sticky .btn{width:100%;min-height:52px}
@media (min-width:860px){
  .hero{padding:76px 0 44px}
  .sec{padding:60px 0}
  .intro{grid-template-columns:340px minmax(0,1fr);gap:48px}
  .intro.solo{grid-template-columns:1fr;max-width:760px;margin-inline:auto}
  .phones{justify-content:center;overflow:visible;margin:0;padding:6px 0 18px;gap:28px}
  .swipe{display:none}
  .deal{grid-template-columns:1.15fr .85fr;gap:28px}
  .noticed,.included{padding:34px 32px}
  .price-card{padding:36px 32px;position:sticky;top:24px}
  .sticky{display:none}
}
`;

function stripThen(s: string): string {
  return s.replace(/^\s*then\s+/i, "").trim();
}

export function renderProposal(input: ProposalInput): string {
  const name = txt(input.business?.name) || "your business";
  const city = txt(input.business?.city);
  const niche = txt(input.business?.nicheLabel);
  const agency = input.agency;
  const agencyName = txt(agency?.name) || "Our studio";
  const owner = txt(agency?.ownerName);
  const email = txt(agency?.email);
  const phone = txt(agency?.phone);
  const booking = safeHref(agency?.bookingUrl);
  const address = (typeof agency?.postalAddress === "string" ? agency.postalAddress : "")
    .split(/\r?\n/)
    .map(txt)
    .filter(Boolean)
    .join("\n");
  const price = txt(input.priceLabel) || "Ask us";
  const hosting = txt(input.hostingLabel);
  const days = Number.isFinite(input.deliveryDays) && input.deliveryDays > 0 ? Math.round(input.deliveryDays) : 7;
  const guarantee = txt(input.guarantee);
  const claim = safeHref(input.claimUrl) ?? "#";
  const unsub = safeHref(input.unsubscribeUrl) ?? "#";
  const mail = email ? `mailto:${email}?subject=${encodeURIComponent(`New website for ${name}`)}` : undefined;
  const tel = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined;
  const noticed = (input.noticed ?? []).map(txt).filter(Boolean).slice(0, 6);
  const variants = (input.variants ?? []).filter((v) => safeHref(v?.url));
  const video = input.video && safeHref(input.video.url) ? { url: safeHref(input.video.url)!, poster: safeHref(input.video.poster) } : undefined;
  const kickerText = [niche, city].filter(Boolean).join(" · ");
  const initial = agencyName.trim()[0]?.toUpperCase() ?? "•";

  const top = `<header class="top"><div class="wrap"><span class="agency"><span class="dot" aria-hidden="true">${esc(initial)}</span><span>${esc(agencyName)}</span></span><span class="for">Made for ${esc(name)}</span></div></header>`;

  const designs = variants.length
    ? `<section class="sec" id="designs"><div class="wrap">
  <div class="sec-h"><h2>${input.state === "paid" ? "Your designs" : "Pick your favourite"}</h2><p>${input.state === "paid" ? "For reference while we finish your site." : "Each one is a real, working page. Tap a phone to open it full screen."}</p></div>
  <div class="phones">${variants
    .map((v) => {
      const url = safeHref(v.url)!;
      const thumb = safeHref(v.thumbUrl);
      const label = txt(v.label) || v.id;
      return `<figure class="phone-card"><a class="phone" href="${esc(url)}" target="_blank" rel="noopener" aria-label="Open the ${esc(label)} design for ${esc(name)}"><span class="notch" aria-hidden="true"></span><span class="screen"${thumb ? ` style="background-image:url('${esc(thumb.replace(/'/g, "%27"))}')"` : ""}><iframe src="${esc(url)}" loading="lazy" title="${esc(label)} design for ${esc(name)}" tabindex="-1" scrolling="no" aria-hidden="true"></iframe></span></a><figcaption><b>${esc(label)}</b><a href="${esc(url)}" target="_blank" rel="noopener">Open full preview →</a></figcaption></figure>`;
    })
    .join("")}</div>
  ${variants.length > 1 ? `<p class="swipe">Swipe to see all ${variants.length} designs →</p>` : ""}
</div></section>`
    : "";

  const foot = (withUnsub: boolean) => `<footer class="foot"><div class="wrap">
  <p><b>${esc(agencyName)}</b>${owner ? ` · ${esc(owner)}` : ""}</p>
  ${address ? `<p class="addr">${esc(address)}</p>` : ""}
  <p>${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : ""}${email && phone ? " · " : ""}${phone && tel ? `<a href="${esc(tel)}">${esc(phone)}</a>` : ""}</p>
  ${withUnsub ? `<a class="unsub" href="${esc(unsub)}">Not interested? Remove me from your list</a>` : ""}
</div></footer>`;

  const doc = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F8F7F3">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
</head>
<body class="state-${input.state}">
${body}
</body>
</html>
`;

  if (input.state === "closed") {
    return doc(
      `${name}: offer ended`,
      `${top}
<main><section class="hero"><div class="wrap">
  <p class="kicker">${esc(kickerText || "Website proposal")}</p>
  <h1>This offer has ended</h1>
  <p class="sub">The designs we made for ${esc(name)} aren't available any more. If you'd still like a new website, we'd be glad to help.</p>
  <div class="hero-cta">${mail ? `<a class="btn btn-claim" href="${esc(mail)}">Email ${esc(agencyName)}</a>` : ""}${tel ? `<a class="btn btn-ghost" href="${esc(tel)}">${icon("phone")}<span>Call ${esc(phone)}</span></a>` : ""}</div>
</div></section></main>
${foot(true)}`
    );
  }

  if (input.state === "paid") {
    return doc(
      `Thank you, ${name}`,
      `${top}
<main>
<section class="hero"><div class="wrap">
  <p class="kicker"><span class="live" aria-hidden="true"></span>Payment received</p>
  <h1>Thank you! ${esc(name)}'s new website is on its way</h1>
  <p class="sub">Here's what happens next. You don't need to do anything until you hear from us.</p>
</div></section>
<section class="sec" style="padding-top:8px"><div class="wrap"><div class="steps">
  <div class="step"><span class="num">1</span><div><b>We'll be in touch within one business day</b><span>To confirm the design you like best and check your details.</span></div></div>
  <div class="step"><span class="num">2</span><div><b>Send us anything you'd like added</b><span>Your logo, photos, new services or wording. Just reply to our email.</span></div></div>
  <div class="step"><span class="num">3</span><div><b>You're live in ${days} days</b><span>We connect your domain and send you the link.</span></div></div>
</div>
<div class="contact-row">${mail ? `<a class="btn btn-ghost" href="${esc(mail)}">Email ${esc(agencyName)}</a>` : ""}${tel ? `<a class="btn btn-ghost" href="${esc(tel)}">${icon("phone")}<span>Call ${esc(phone)}</span></a>` : ""}</div>
</div></section>
${designs}
</main>
${foot(false)}`
    );
  }

  // ── open ──
  const videoBlock = video
    ? `<div><div class="vframe"><video controls playsinline preload="metadata"${video.poster ? ` poster="${esc(video.poster)}"` : ""}><source src="${esc(video.url)}" type="video/mp4">Your browser can't play this video. <a href="${esc(video.url)}">Download it</a>.</video></div><p class="vcap">A quick walkthrough of your new site</p></div>`
    : "";
  const noticedBlock = noticed.length
    ? `<div class="noticed"><h2>What we noticed</h2><p class="lead">We looked at how ${esc(name)} shows up online today.</p><ul>${noticed
        .map((n, i) => `<li><span class="n">${i + 1}</span><span>${esc(n)}</span></li>`)
        .join("")}</ul></div>`
    : "";
  const intro =
    videoBlock || noticedBlock ? `<section class="sec" style="padding-top:12px"><div class="wrap intro${videoBlock && noticedBlock ? "" : " solo"}">${videoBlock}${noticedBlock}</div></section>` : "";

  const hostingShort = hosting ? stripThen(hosting) : "";
  const included = [
    "A fast, mobile-first website in the design you pick (we can mix and match)",
    "Your real details: hours, phone number and address, kept accurate",
    "Tap-to-call and directions buttons, so phone visitors become customers",
    "Your own domain: we connect the one you have, or help you register one",
    hosting ? "Hosting, SSL security and backups handled for you" : "Hosting set up for you, or the files handed over to your own host",
    "Changes before launch: photos, wording, colours, until you're happy",
    "Found on Google: page titles, descriptions and local business markup",
  ];
  const facts = [`<li>${icon("clock")}<span>Live within ${days} days of your yes</span></li>`];
  if (guarantee) facts.push(`<li>${icon("shield")}<span>${esc(guarantee)}</span></li>`);
  facts.push(`<li>${icon("check")}<span>One-time price, no contract</span></li>`);

  const deal = `<section class="sec" id="claim"><div class="wrap deal">
  <div class="included"><h2>What's included</h2><ul class="checks">${included.map((t) => `<li>${icon("check")}<span>${esc(t)}</span></li>`).join("")}</ul></div>
  <div class="price-card">
    <p class="label">Your new website</p>
    <p class="amount">${esc(price)}</p>
    ${hosting ? `<p class="hosting">${esc(hosting)}</p>` : ""}
    <ul class="facts">${facts.join("")}</ul>
    <a class="btn btn-claim" href="${esc(claim)}">Claim this website — ${esc(price)}</a>
    <div class="alt">${booking ? `<a class="btn btn-ghost" href="${esc(booking)}" target="_blank" rel="noopener">Book a 10-minute call</a>` : ""}${mail ? `<a class="btn btn-ghost" href="${esc(mail)}">Reply by email</a>` : ""}</div>
  </div>
</div></section>`;

  const hostingAnswer = hosting
    ? `After launch, hosting is ${hostingShort.replace(/\s*hosting\s*/i, " ").replace(/\s+/g, " ").trim()}: fast servers, SSL security and backups, handled for you.`
    : "We'll set up hosting for you, or hand the finished site to your own host. Your choice.";
  const faqs: [string, string][] = [
    ["Do I need a domain name?", "If you already have one, we'll connect it. If not, we'll help you pick and register one in your name, so you always own it."],
    ["What about hosting?", hostingAnswer],
    ["Can I change things?", "Yes. Tell us what to change (photos, wording, colours, services) and we'll update it before it goes live."],
    ["How long does it take?", `Your site goes live within ${days} days of your yes. Most of the work is already done: you're looking at it.`],
    ["What if I don't want it?", "No problem, and no hard feelings. Ignore this page, or use the link at the bottom and we won't contact you again."],
  ];
  const faq = `<section class="sec"><div class="wrap"><div class="sec-h"><h2>Questions</h2></div><div class="faq-list">${faqs
    .map(([q, a]) => `<details class="faq-item"><summary><span>${esc(q)}</span><span class="pm" aria-hidden="true">+</span></summary><div class="a"><p>${esc(a)}</p></div></details>`)
    .join("")}</div></div></section>`;

  const body = `${top}
<main>
<section class="hero"><div class="wrap">
  ${kickerText ? `<p class="kicker"><span class="live" aria-hidden="true"></span>${esc(kickerText)}</p>` : ""}
  <h1>We built <em>${esc(name)}</em> a new website</h1>
  <p class="sub">${variants.length > 1 ? `${variants.length} designs` : "A design"}, made from your public listing and ready to go live in ${days} days. Tap one to look around.</p>
  <div class="hero-cta"><a class="btn btn-claim" href="${esc(claim)}">Claim this website — ${esc(price)}</a>${variants.length ? `<a class="btn btn-ghost" href="#designs">See the designs</a>` : ""}</div>
  ${hosting ? `<p class="fine">${esc(price)} one-time, ${esc(hosting)}</p>` : `<p class="fine">${esc(price)} one-time. No contract.</p>`}
</div></section>
${intro}
${designs}
${deal}
${faq}
</main>
${foot(true)}
<div class="sticky"><a class="btn btn-claim" href="${esc(claim)}">Claim this website — ${esc(price)}</a></div>`;

  return doc(`A new website for ${name}`, body);
}
