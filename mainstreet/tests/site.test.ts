import { test } from "node:test";
import assert from "node:assert/strict";
import { FONT_PAIRS, ICONS, PALETTES } from "../src/site/design.ts";
import { renderProposal, type ProposalInput } from "../src/site/proposal.ts";
import { renderSite, VARIANTS, type RenderInput } from "../src/site/render.ts";
import type { BusinessFacts, FontPairId, PaletteId, SiteSpec, VariantId } from "../src/types.ts";

const BAD = /undefined|NaN|\[object Object\]|\bnull\b/;

const spec: SiteSpec = {
  businessName: "Bright Smile Family Dental",
  tagline: "Gentle, modern dentistry for the whole family",
  heroHeadline: "Gentle dental care for the whole family in Bend",
  heroSubheadline: "Cleanings, fillings, crowns and same-week emergency visits, with early mornings and Saturdays.",
  primaryCta: "Book an appointment",
  secondaryCta: "Call us",
  services: [
    { name: "Cleanings & check-ups", blurb: "Thorough, gentle cleanings.", icon: "tooth" },
    { name: "Fillings & crowns", blurb: "Tooth-coloured fillings and crowns.", icon: "shield" },
    { name: "Emergency visits", blurb: "Call and we'll fit you in fast.", icon: "clock" },
  ],
  about: { heading: "A dental office that feels like family", body: "Calm, unhurried appointments and clear explanations." },
  highlights: [
    { label: "Open 6 days", detail: "Early mornings and Saturdays" },
    { label: "All ages welcome", detail: "Kids, parents and grandparents" },
    { label: "Same-week emergencies", detail: "Call us first" },
  ],
  testimonials: [{ quote: "The whole team is so kind.", author: "Megan R.", rating: 5 }],
  faq: [
    { q: "Are you taking new patients?", a: "Yes. Call us to book your first visit." },
    { q: "Do you see children?", a: "Absolutely, patients of all ages." },
    { q: "What if I have an emergency?", a: "Call us right away." },
  ],
  ctaBand: { heading: "Ready for a brighter smile?", body: "New patients are always welcome.", button: "Call today" },
  seo: { title: "Bright Smile Family Dental | Dentist in Bend, OR", description: "Gentle family dentistry in Bend, OR." },
  palette: "clinic",
  fontPair: "modern",
  mood: "clinical",
  imagePrompt: "bright modern dental treatment room",
};

const facts: BusinessFacts = {
  name: "Bright Smile Family Dental",
  niche: "dentist",
  nicheLabel: "Family dentist",
  city: "Bend",
  region: "OR",
  phone: "(541) 555-0134",
  email: "hello@brightsmilebend.com",
  address: "1450 NE Cushing Dr, Bend, OR 97701",
  hours: ["Monday: 7:30 AM – 5:00 PM", "Tuesday: 7:30 AM – 5:00 PM", "Sunday: Closed"],
  mapsUrl: "https://maps.google.com/?cid=123",
  rating: 4.9,
  reviewCount: 212,
};

const bareFacts: BusinessFacts = { name: "Summit Ridge Roofing", niche: "roofer", nicheLabel: "Roofing contractor", city: "Boise", region: "ID" };

const preview = { agencyName: "Mainstreet Studio", claimUrl: "/p/tok123/claim", priceLabel: "$500" };

function site(over: Partial<RenderInput> = {}): string {
  return renderSite({ spec, facts, variant: "bold", mode: "preview", preview, ...over });
}

test("every variant renders a full document with every palette and several font pairs", () => {
  const fonts: FontPairId[] = ["modern", "editorial", "strong", "elegant"];
  for (const v of VARIANTS) {
    for (const palette of Object.keys(PALETTES) as PaletteId[]) {
      for (const fontPair of fonts) {
        const html = renderSite({ spec: { ...spec, palette, fontPair }, facts, variant: v.id, mode: "preview", preview });
        assert.match(html, /^<!doctype html>/);
        assert.match(html, /<\/html>\s*$/);
        assert.ok(html.includes(`class="v-${v.id}`), `${v.id} body class`);
        assert.doesNotMatch(html, BAD, `${v.id}/${palette}/${fontPair} leaked a bad token`);
      }
    }
  }
});

test("sparse facts render cleanly in every variant", () => {
  for (const v of VARIANTS) {
    const html = renderSite({ spec: { ...spec, testimonials: [], faq: [], highlights: [] }, facts: bareFacts, variant: v.id, mode: "live" });
    assert.doesNotMatch(html, BAD);
    assert.ok(!html.includes('id="reviews"'));
    assert.ok(html.includes('id="contact"'), "something carries the #contact anchor");
  }
});

test("all text is escaped", () => {
  const evil = `Joe's <script>alert(1)</script> Plumbing`;
  const html = renderSite({
    spec: { ...spec, heroHeadline: `<img src=x onerror=alert(1)>`, services: [{ name: evil, blurb: `"quoted" & <b>bold</b>`, icon: "wrench" }] },
    facts: { ...facts, name: evil },
    variant: "classic",
    mode: "preview",
    preview,
  });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<b>bold</b>"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Joe&#39;s"));
  const p = renderProposal(proposal({ business: { name: evil, city: "Bend, OR", nicheLabel: "Plumber" } }));
  assert.ok(!p.includes("<script>alert(1)"));
  assert.ok(p.includes("Joe&#39;s &lt;script&gt;"));
});

test("testimonials section only when there are testimonials", () => {
  for (const v of VARIANTS) {
    const withT = site({ variant: v.id });
    assert.ok(withT.includes('id="reviews"'), `${v.id} has reviews`);
    assert.ok(withT.includes("Google review"));
    const without = site({ variant: v.id, spec: { ...spec, testimonials: [] } });
    assert.ok(!without.includes('id="reviews"'), `${v.id} has no reviews section`);
    assert.ok(!without.includes('href="#reviews"'), `${v.id} has no reviews nav link`);
  }
});

test("tap-to-call only when there is a phone number", () => {
  for (const v of VARIANTS) {
    assert.ok(site({ variant: v.id }).includes('href="tel:+15415550134"'), `${v.id} tel`);
    const noPhone = site({ variant: v.id, facts: { ...facts, phone: undefined } });
    assert.ok(!noPhone.includes("tel:"), `${v.id} no tel`);
    assert.ok(noPhone.includes('href="#contact"'), `${v.id} primary CTA falls back to #contact`);
  }
});

test("the secondary CTA never duplicates the tel: primary", () => {
  const html = site({ variant: "bold" });
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf("</section>", html.indexOf('<section class="hero"')));
  const tels = hero.match(/href="tel:/g) ?? [];
  assert.equal(tels.length, 1);
  assert.ok(hero.includes("Get directions"));
});

test("rating badge only with both a rating and a review count", () => {
  const plain = { ...spec, highlights: [], testimonials: [] };
  assert.ok(site({ spec: plain }).includes("212 Google reviews"));
  assert.ok(!site({ spec: plain, facts: { ...facts, reviewCount: undefined } }).includes("Google reviews"));
  assert.ok(!site({ spec: plain, facts: { ...facts, rating: undefined } }).includes("Google reviews"));
});

test("preview bar only in preview mode; live mode has SEO tags", () => {
  for (const v of VARIANTS) {
    const p = site({ variant: v.id });
    assert.ok(p.includes('class="ms-preview-bar"'), `${v.id} preview bar`);
    assert.ok(p.includes('href="/p/tok123/claim"'));
    assert.ok(p.includes('name="robots" content="noindex'));
    const live = site({ variant: v.id, mode: "live", preview: undefined });
    assert.ok(!live.includes('class="ms-preview-bar"'), `${v.id} no bar when live`);
    assert.ok(live.includes(`<title>${spec.seo.title}</title>`));
    assert.ok(live.includes(`<meta name="description" content="${spec.seo.description}">`));
    assert.ok(live.includes('"@type":"LocalBusiness"'));
    assert.ok(!live.includes("noindex"));
  }
});

test("hero uses generated art without a photo, and never an <img> that could break", () => {
  for (const v of VARIANTS) {
    const art = site({ variant: v.id });
    assert.ok(art.includes('class="ms-art"'), `${v.id} art`);
    const photo = site({ variant: v.id, heroImageUrl: "../../hero.jpg" });
    assert.ok(photo.includes("url('../../hero.jpg')"), `${v.id} photo layer`);
    assert.ok(!/<img\b/i.test(photo));
  }
});

test("unknown palette, font pair and variant fall back instead of breaking", () => {
  const html = renderSite({
    spec: { ...spec, palette: "neon" as PaletteId, fontPair: "comic" as FontPairId },
    facts,
    variant: "retro" as VariantId,
    mode: "preview",
    preview,
  });
  assert.doesNotMatch(html, BAD);
  assert.ok(html.includes('class="v-bold'));
});

// WCAG relative luminance contrast
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

test("every palette passes WCAG AA for text", () => {
  for (const [id, p] of Object.entries(PALETTES)) {
    const pairs: [string, string, string][] = [
      ["primaryInk/primary", p.primaryInk, p.primary],
      ["ink/bg", p.ink, p.bg],
      ["ink/surface", p.ink, p.surface],
      ["muted/bg", p.muted, p.bg],
      ["muted/surface", p.muted, p.surface],
      ["primaryText/bg", p.primaryText, p.bg],
      ["primaryText/soft", p.primaryText, p.soft],
      ["accentInk/accent", p.accentInk, p.accent],
      ["deepInk/deep", p.deepInk, p.deep],
      ["deepMuted/deep", p.deepMuted, p.deep],
    ];
    for (const [name, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${id} ${name} = ${contrast(fg, bg).toFixed(2)}`);
  }
});

test("icons and font pairs are complete", () => {
  for (const [name, svg] of Object.entries(ICONS)) {
    assert.ok(svg.startsWith("<svg"), name);
    assert.ok(svg.includes('stroke="currentColor"'), name);
    assert.ok(svg.includes('viewBox="0 0 24 24"'), name);
  }
  for (const [id, f] of Object.entries(FONT_PAIRS)) {
    assert.ok(f.googleHref.startsWith("https://fonts.googleapis.com/css2?"), id);
    assert.ok(f.googleHref.includes("display=swap"), id);
  }
});

function proposal(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    token: "tok123",
    business: { name: "Bright Smile Family Dental", city: "Bend, OR", nicheLabel: "Family dentist" },
    agency: { name: "Mainstreet Studio", ownerName: "Craig", email: "craig@example.com", phone: "(905) 555-0100", postalAddress: "100 Queen St W\nBrampton, ON L6X 1A4", bookingUrl: "https://cal.com/craig/10min" },
    variants: VARIANTS.map((v) => ({ id: v.id, label: v.label, url: `/p/tok123/site/${v.id}/` })),
    video: { url: "/p/tok123/video.mp4", poster: "/p/tok123/poster.jpg" },
    noticed: ["There is no website on the Google listing.", "Nowhere to book online."],
    priceLabel: "$500",
    hostingLabel: "then $29/mo hosting (optional)",
    deliveryDays: 5,
    guarantee: "Love it, or you don't pay",
    claimUrl: "/p/tok123/claim",
    unsubscribeUrl: "/u/tok123",
    state: "open",
    ...over,
  };
}

test("proposal: open state sells", () => {
  const html = renderProposal(proposal());
  assert.doesNotMatch(html, BAD);
  assert.ok(html.includes("We built <em>Bright Smile Family Dental</em> a new website"));
  assert.ok(html.includes('href="/p/tok123/claim"'));
  assert.ok(html.includes("Claim this website — $500"));
  assert.equal((html.match(/<iframe /g) ?? []).length, 3);
  assert.ok(html.includes('<video controls playsinline'));
  assert.ok(html.includes('poster="/p/tok123/poster.jpg"'));
  assert.ok(html.includes("What we noticed"));
  assert.ok(html.includes("Book a 10-minute call"));
  assert.ok(html.includes('href="/u/tok123"'));
  assert.ok(html.includes("Brampton, ON L6X 1A4"));
});

test("proposal: optional parts are omitted cleanly", () => {
  const html = renderProposal(proposal({ video: undefined, noticed: [], hostingLabel: undefined, agency: { name: "Studio", ownerName: "", email: "a@b.co", postalAddress: "1 Main St" } }));
  assert.doesNotMatch(html, BAD);
  assert.ok(!html.includes("<video"));
  assert.ok(!html.includes("What we noticed"));
  assert.ok(!html.includes("Book a 10-minute call"));
});

test("proposal: paid and closed states", () => {
  const paid = renderProposal(proposal({ state: "paid" }));
  assert.doesNotMatch(paid, BAD);
  assert.ok(paid.includes("Thank you!"));
  assert.ok(!paid.includes("Claim this website"));
  const closed = renderProposal(proposal({ state: "closed" }));
  assert.doesNotMatch(closed, BAD);
  assert.ok(closed.includes("This offer has ended"));
  assert.ok(!closed.includes("Claim this website"));
  assert.ok(!closed.includes("<iframe"));
  assert.ok(closed.includes('href="/u/tok123"'));
});
