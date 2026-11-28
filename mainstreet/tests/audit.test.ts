import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeHtml, demoAudit, findEmails, websiteStateFor } from "../src/site/audit.ts";
import { scoreLead } from "../src/site/score.ts";

const now = new Date("2026-11-27T12:00:00Z");

const OLD = `<html><head><title>Hayes Plumbing - Home</title><meta name="generator" content="Microsoft FrontPage 4.0">
<script src="js/jquery-1.4.2.min.js"></script></head><body bgcolor="#ffffff">
<table cellpadding="0"><tr><td><font face="Arial">Welcome to Hayes Plumbing!</font></td></tr></table>
<table><tr><td><font>Call us</font></td></tr></table><table></table><table></table><table></table><table></table>
<font>Serving the valley since 1998</font><p>Email: office@hayesplumbing.com</p>
<p>Copyright &copy; 2014 Hayes Plumbing. Best viewed in Internet Explorer.</p></body></html>`;

const MODERN = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Family dentistry in Bend"><title>Cascade Dental</title>
<style>:root{--brand:#0e7c86}.btn{background:#0e7c86}.x{color:#0e7c86}</style></head>
<body><a href="tel:+15415550134">Call</a><a href="https://calendly.com/cascade">Book online</a>
<form><input type="email" name="email"></form><footer>© 2025 Cascade Dental</footer></body></html>`;

test("an old FrontPage site is outdated, with plain-English findings", () => {
  const a = analyzeHtml({ html: OLD, url: "http://hayesplumbing.com", finalUrl: "http://hayesplumbing.com/", status: 200, responseMs: 5200, niche: "plumber", now });
  assert.equal(a.copyrightYear, 2014);
  assert.equal(a.mobileViewport, false);
  assert.equal(a.https, false);
  assert.ok(a.oldTech.some((t) => t.startsWith("jQuery 1.4")));
  assert.ok(a.oldTech.includes("<font> tags"));
  assert.ok(a.oldTech.includes("table layout"));
  assert.deepEqual(a.emails, ["office@hayesplumbing.com"]);
  assert.ok(a.findings.some((f) => f.includes("No mobile layout")));
  assert.ok(a.findings.some((f) => f.includes("© 2014")));
  assert.equal(websiteStateFor(a, now), "outdated");
});

test("a modern site with booking and tap-to-call is modern", () => {
  const a = analyzeHtml({ html: MODERN, url: "https://cascadedental.com", finalUrl: "https://cascadedental.com/", status: 200, responseMs: 600, niche: "dentist", now });
  assert.equal(a.mobileViewport, true);
  assert.ok(a.booking.length > 0);
  assert.equal(a.hasClickToCall, true);
  assert.equal(a.hasContactForm, true);
  assert.deepEqual(a.brandColors, ["#0e7c86"]);
  assert.equal(websiteStateFor(a, now), "modern");
});

test("parked domains are dead and no-solicitation notices are caught", () => {
  const parked = analyzeHtml({ html: "<html><body>This domain is for sale! Buy this domain today.</body></html>", url: "http://x.com", status: 200, now });
  assert.equal(parked.parked, true);
  assert.equal(websiteStateFor(parked, now), "dead");
  const ns = analyzeHtml({ html: "<p>Please, no solicitation. Unsolicited emails will not be answered.</p>", url: "https://y.com", status: 200, now });
  assert.equal(ns.noSolicitation, true);
});

test("email finder ignores image names and placeholders", () => {
  assert.deepEqual(findEmails(`<a href="mailto:Hi@Shop.com?subject=x">mail</a> logo@2x.png you@example.com sales@shop.com`), ["hi@shop.com", "sales@shop.com"]);
});

test("demo audits match their state", () => {
  assert.equal(demoAudit({ state: "none" }, undefined, "dentist", now).state, "none");
  const o = demoAudit({ state: "outdated", copyrightYear: 2012, email: "hello@x.example" }, "http://www.x.example", "dentist", now);
  assert.equal(o.state, "outdated");
  assert.ok(o.audit!.findings.length >= 3);
  assert.equal(demoAudit({ state: "social_only" }, "https://facebook.com/x", "roofer", now).state, "social_only");
});

test("scores: no-website dentist with great reviews is hot; chains and modern sites are not", () => {
  const hot = scoreLead({ state: "none", niche: "dentist", rating: 4.8, reviewCount: 120, hasEmail: false, hasPhone: true, chain: false, closed: false });
  assert.ok(hot.score >= 70, `hot score ${hot.score}`);
  const chain = scoreLead({ state: "none", niche: "dentist", rating: 4.8, reviewCount: 120, hasEmail: false, hasPhone: true, chain: true, closed: false });
  assert.ok(chain.score < 30);
  const modern = scoreLead({ state: "modern", niche: "dentist", rating: 4.8, reviewCount: 120, hasEmail: true, hasPhone: true, chain: false, closed: false });
  assert.ok(modern.score < 55);
  const unreachable = scoreLead({ state: "none", niche: "cafe", reviewCount: 0, hasEmail: false, hasPhone: false, chain: false, closed: false });
  assert.ok(unreachable.score < 30);
});
