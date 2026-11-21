import { test } from "node:test";
import assert from "node:assert/strict";
import { distinctiveWords, domainCandidates, extractContacts, formatPhone, pageIsBusiness, robotsAllows } from "../src/lib/prospecting/crawl-parse.ts";

test("robots.txt: our group if named, else *, longest rule wins, Allow wins ties", () => {
  const txt = ["User-agent: *", "Disallow: /private/", "Allow: /private/contact", "", "User-agent: BadBot", "Disallow: /"].join("\n");
  assert.ok(robotsAllows(txt, "/"));
  assert.ok(!robotsAllows(txt, "/private/notes"));
  assert.ok(robotsAllows(txt, "/private/contact-us"), "the longer Allow wins");
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /", "/"), "a site that bars everyone");
  assert.ok(robotsAllows("User-agent: *\nDisallow: /\n\nUser-agent: RainmakerAudit\nAllow: /", "/"), "a group naming us beats *");
  assert.ok(robotsAllows("User-agent: *\nDisallow:", "/"), "an empty Disallow allows all");
  assert.ok(!robotsAllows("User-agent: *\nDisallow: /*.php$", "/index.php"));
  assert.ok(robotsAllows("User-agent: *\nDisallow: /*.php$", "/index.php?x=1"), "$ anchors the end");
  assert.ok(robotsAllows("", "/"), "no rules, no limits");
});

test("phones, emails, address and the contact page from a business's homepage", () => {
  const html = `<html><head><title>Coverall Roofing</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"RoofingContractor","telephone":"+1-780-555-0101",
      "address":{"@type":"PostalAddress","streetAddress":"12 Main St","addressLocality":"Edmonton","addressRegion":"AB","postalCode":"T5J 0N3"}}</script>
    </head><body>
    <a href="tel:7805550101">Call</a> <a href="mailto:info@coverallroofing.ca">Email us</a>
    <p>Office: (780) 555-0199. Write to jobs&#64;coverallroofing.ca or noreply@sentry.io.</p>
    <img src="logo@2x.png"><a href="/contact-us">Contact</a></body></html>`;
  const c = extractContacts(html, "https://coverallroofing.ca/");
  assert.deepEqual(c.phones, ["(780) 555-0101", "(780) 555-0199"]);
  assert.deepEqual(c.emails, ["info@coverallroofing.ca", "jobs@coverallroofing.ca"]);
  assert.equal(c.address, "12 Main St, Edmonton, AB, T5J 0N3");
  assert.equal(c.contactUrl, "https://coverallroofing.ca/contact-us");
  assert.equal(extractContacts('<a href="https://other.com/contact">Contact</a>', "https://a.ca/").contactUrl, undefined, "another site's contact page isn't followed");
  assert.equal(formatPhone("1 (403) 555 0100"), "(403) 555-0100");
  assert.equal(formatPhone("12"), undefined);
});

test("domain guesses come from the distinctive part of the name", () => {
  assert.deepEqual(distinctiveWords("Coverall Roofing Ltd."), ["coverall"]);
  assert.deepEqual(domainCandidates("Coverall Roofing Ltd."), ["coverallroofing.ca", "coverallroofing.com", "coverall-roofing.ca", "coverall-roofing.com"]);
  assert.deepEqual(domainCandidates("MT Plumbing and Heating", ["com"]), ["mtplumbingandheating.com", "mt-plumbing-and-heating.com", "mtplumbingheating.com"]);
  assert.deepEqual(domainCandidates("Roofing Services Ltd."), [], "too generic to guess");
  assert.ok(domainCandidates("A Very Long Business Name That Goes On And On Forever Inc").every((d) => d.split(".")[0].length <= 40));
});

test("a guessed site counts only if it's the business's own, live page", () => {
  const body = "Coverall Roofing has fixed Edmonton roofs since 1998. ".repeat(8);
  assert.ok(pageIsBusiness(`<title>Coverall Roofing</title><p>${body}</p>`, "Coverall Roofing Ltd."));
  assert.ok(!pageIsBusiness(`<p>This domain is for sale! ${body}</p>`, "Coverall Roofing Ltd."), "parked domain");
  assert.ok(!pageIsBusiness(`<p>${"Another company does roofing here. ".repeat(10)}</p>`, "Coverall Roofing Ltd."), "a different business");
  assert.ok(pageIsBusiness(`<p>${"Call us any time for roofing. ".repeat(8)} 780-555-0101</p>`, "Coverall Roofing", { phone: "(780) 555-0101" }), "matched by phone");
  assert.ok(!pageIsBusiness("<p>Coverall</p>", "Coverall Roofing"), "too short to be a real site");
  const indy = `<p>${"Elite Shield Roofing serves Indianapolis, Indiana. ".repeat(8)}</p>`;
  const places = ["Edmonton", "Alberta", "AB"];
  assert.ok(!pageIsBusiness(indy, "Elite Shield Roofing Ltd.", { places }), "same name, another city");
  assert.ok(pageIsBusiness(indy.replace(/Indianapolis, Indiana/g, "Edmonton, AB"), "Elite Shield Roofing Ltd.", { places }), "names the business and its city");
  assert.ok(pageIsBusiness(`<p>${"Roofing in Indianapolis. ".repeat(12)} (780) 555-0101</p>`, "Elite Shield Roofing", { places, phone: "780-555-0101" }), "the phone alone is enough");
  assert.ok(pageIsBusiness(`<p>${"Plumbing in St. John's, NL. ".repeat(10)} Coverall</p>`, "Coverall Plumbing", { places: ["St. John's"] }), "place names with punctuation");
});
