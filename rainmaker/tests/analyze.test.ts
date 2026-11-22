import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml, brandColors } from "../src/lib/prospecting/analyze.ts";

const NOW = new Date("2026-11-20T12:00:00Z");

const MODERN = `<!doctype html><html><head>
<title>Brightside Family Dental | Austin Dentist</title>
<meta name="description" content="Gentle family dentistry in Austin &amp; Round Rock.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:image" content="https://x/og.png">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<script>!function(f,b,e,v,n,t,s){}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '123');</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Brightside"}</script>
</head><body><h1>Smile <em>brighter</em> in Austin</h1>
<a href="https://www.zocdoc.com/practice/brightside">Book online</a>
<a href="tel:+15125550142">Call us</a><a href="mailto:Hello@Brightside.example">Email</a>
<form><input type="email" name="email"><textarea name="message"></textarea></form>
<a href="https://www.facebook.com/brightsidedental">fb</a><a href="https://instagram.com/brightside">ig</a>
<script src="https://widgets.leadconnectorhq.com/loader.js"></script>
<footer>&copy; 2024–2026 Brightside</footer></body></html>`;

const OLD = `<html><head><title>Joe's Roofing</title></head><body>
<table><tr><td>Call 555-0188</td></tr></table>
<p>Copyright 2016 Joe's Roofing. All rights reserved.</p></body></html>`;

test("detects what a modern site has", () => {
  const a = analyzeHtml({ html: MODERN, url: "https://brightside.example", finalUrl: "https://brightside.example/", status: 200, responseMs: 800, now: NOW });
  assert.equal(a.reachable, true);
  assert.equal(a.https, true);
  assert.equal(a.mobileViewport, true);
  assert.equal(a.title, "Brightside Family Dental | Austin Dentist");
  assert.equal(a.description, "Gentle family dentistry in Austin & Round Rock.");
  assert.equal(a.h1, "Smile brighter in Austin");
  assert.deepEqual(a.analytics, ["Google Analytics 4"]);
  assert.ok(a.pixels.includes("Meta Pixel"));
  assert.ok(a.booking.includes("Zocdoc"));
  assert.ok(a.chat.includes("LeadConnector (GoHighLevel)"));
  assert.equal(a.cms, "GoHighLevel site");
  assert.equal(a.hasContactForm, true);
  assert.equal(a.hasClickToCall, true);
  assert.equal(a.hasSchema, true);
  assert.equal(a.hasOgImage, true);
  assert.equal(a.copyrightYear, 2026);
  assert.deepEqual(a.emails, ["hello@brightside.example"]);
  assert.ok(a.socials.includes("Facebook") && a.socials.includes("Instagram"));
});

test("flags an old, bare site", () => {
  const a = analyzeHtml({ html: OLD, url: "http://joesroofing.example", status: 200, responseMs: 4200, now: NOW });
  assert.equal(a.https, false);
  assert.equal(a.mobileViewport, false);
  assert.deepEqual(a.analytics, []);
  assert.deepEqual(a.pixels, []);
  assert.deepEqual(a.booking, []);
  assert.equal(a.hasContactForm, false);
  assert.equal(a.hasClickToCall, false);
  assert.equal(a.copyrightYear, 2016);
  assert.equal(a.cms, undefined);
});

test("treats error statuses as unreachable", () => {
  const a = analyzeHtml({ html: "Not found", url: "https://x.example", status: 404, now: NOW });
  assert.equal(a.reachable, false);
});

test("a bare 'book now' link counts as booking when no known widget is found", () => {
  const a = analyzeHtml({ html: "<a href='/contact'>Book an appointment</a>", url: "https://x.example", status: 200, now: NOW });
  assert.deepEqual(a.booking, ["Booking link or form"]);
});

test("ignores Facebook share/plugin links when listing socials", () => {
  const a = analyzeHtml({ html: "<a href='https://www.facebook.com/sharer/sharer.php?u=x'>share</a>", url: "https://x.example", status: 200, now: NOW });
  assert.deepEqual(a.socials, []);
});

test("brand colours: theme-color first, then the most used colourful CSS values, never greys", () => {
  const html = `<meta name="theme-color" content="#0A7">
    <style>.a{color:#ffffff;background:#333}.b{color:#e63946}.c{border-color:#E63946}.d{color:#1d3557}</style>
    <div style="background:#1d3557;color:#f1faee"></div><div style="color:#1d3557"></div>`;
  assert.deepEqual(brandColors(html), ["#00aa77", "#1d3557", "#e63946"]);
  assert.deepEqual(brandColors("<p>plain</p>"), []);
});
