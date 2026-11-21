// A small pretend website for tests: a shop with the things real sites have that make them hard to
// use from a script. A cookie box on top of the page, a search form, results that are links, a
// drop-down menu, a button that buys, a login with a password, a page drawn by its own script, a
// long article, a pop-up message, and a part that comes from another site. Nothing leaves this computer.
import http from "node:http";

const PRODUCTS = [
  { id: "aa-batteries", name: "AA batteries, pack of 12", price: "£6.50", words: "batteries aa power" },
  { id: "aaa-batteries", name: "AAA batteries, pack of 8", price: "£5.25", words: "batteries aaa power" },
  { id: "hdmi-cable", name: "HDMI cable, 2 metres", price: "£7.99", words: "hdmi cable tv lead" },
  { id: "remote", name: "Replacement TV remote", price: "£11.00", words: "remote tv control" },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const page = (title, body, { cookies = false } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
  body { font: 18px/1.5 sans-serif; margin: 0; color: #1c2333; }
  header { background: #20306b; padding: 14px 24px; display: flex; gap: 22px; align-items: center; }
  header a { color: #fff; text-decoration: none; }
  main { padding: 24px; max-width: 900px; }
  .results a { display: block; padding: 10px 0; }
  .cookie { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
  .cookie > div { background: #fff; padding: 24px; border-radius: 10px; max-width: 420px; }
  .hidden { display: none; }
  .tabs button[aria-selected=true] { font-weight: bold; }
  .icon { display: inline-block; width: 28px; height: 28px; background: #ffd23f; border-radius: 50%; }
  .fancy { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 0; }
  .fancy input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .fancy span { width: 22px; height: 22px; border: 2px solid #20306b; border-radius: 4px; }
</style></head>
<body>
<header><a href="/">Corner Shop</a><a href="/offers">Offers</a><a href="/article">Buying guide</a><a href="/account">Your account</a><a href="/basket" aria-label="Basket"><span class="icon"></span></a></header>
<main>${body}</main>
${cookies ? `<div class="cookie" id="cookie"><div><h2>We value your privacy</h2><p>We use cookies to run the shop.</p><button id="accept" onclick="document.cookie='ok=1;path=/';document.getElementById('cookie').remove()">Accept all</button> <button onclick="document.cookie='ok=0;path=/';document.getElementById('cookie').remove()">Only what's needed</button></div></div>` : ""}
</body></html>`;

const searchForm = (q = "") => `<form action="/search" method="get" role="search"><input type="search" name="q" placeholder="Search the shop" aria-label="Search the shop" value="${esc(q)}"> <button>Search</button></form>`;

function route(url, cookie, state) {
  const seen = /\bok=/.test(cookie || "");
  const p = url.pathname;
  if (p === "/") {
    return page(
      "Corner Shop: home",
      `<h1>Welcome to Corner Shop</h1><p>Everything for the living room, delivered tomorrow.</p>${searchForm()}
       <h2>Popular today</h2><div class="results">${PRODUCTS.slice(0, 3).map((x) => `<a href="/product/${x.id}">${esc(x.name)}</a>`).join("")}</div>
       <p><a href="/apps">Opening times</a> · <a href="/signin">Sign in</a></p>`,
      { cookies: !seen },
    );
  }
  if (p === "/search") {
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const hits = PRODUCTS.filter((x) => q && q.split(/\s+/).every((w) => `${x.name} ${x.words}`.toLowerCase().includes(w)));
    state.searches.push(q);
    return page(`Search: ${q}`, `<h1>Results for “${esc(q)}”</h1>${searchForm(q)}<p>${hits.length} found.</p><div class="results">${hits.map((x) => `<a href="/product/${x.id}">${esc(x.name)}</a> <span>${x.price}</span>`).join("<br>")}</div>`);
  }
  const prod = p.match(/^\/product\/([\w-]+)$/);
  if (prod) {
    const x = PRODUCTS.find((y) => y.id === prod[1]);
    if (!x) return null;
    return page(
      x.name,
      `<h1>${esc(x.name)}</h1><p>Price: <strong>${x.price}</strong>. In stock.</p>
       <form action="/basket/add" method="post"><input type="hidden" name="id" value="${x.id}">
         <label for="qty">How many</label> <select id="qty" name="qty"><option value="1">1</option><option value="2">2</option><option value="3">3 (save 10%)</option></select>
         <label class="fancy"><input type="checkbox" name="gift" value="1"><span></span> Gift wrap it</label>
         <button type="submit">Add to basket</button></form>
       <form action="/buy" method="post"><input type="hidden" name="id" value="${x.id}"><button type="submit">Buy now</button></form>
       <p><a href="/">Back to the shop</a></p>`,
    );
  }
  if (p === "/basket") {
    return page("Your basket", `<h1>Your basket</h1>${state.basket.length ? `<ul>${state.basket.map((b) => `<li>${b.qty} × ${esc(PRODUCTS.find((x) => x.id === b.id)?.name || b.id)}${b.gift ? " (gift wrapped)" : ""}</li>`).join("")}</ul>` : "<p>Your basket is empty.</p>"}<p><a href="/">Keep shopping</a></p>`);
  }
  if (p === "/offers") {
    // Drawn by its own script, and changed by its tabs without loading another page.
    return page(
      "Offers",
      `<h1>Offers</h1><div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-tab="week">This week</button><button role="tab" aria-selected="false" data-tab="clearance">Clearance</button></div><div id="panel">Loading…</div>
       <button onclick="alert('Offers end on Sunday.')">When do offers end?</button> <button onclick="if (confirm('Clear your basket?')) location.href='/cleared'">Clear basket</button>
       <script>
         var OFFERS = { week: ["HDMI cable: 20% off", "AA batteries: 3 for 2"], clearance: ["Last year's remote: half price"] };
         function draw(tab) {
           document.getElementById("panel").innerHTML = "<ul>" + OFFERS[tab].map(function (o) { return "<li>" + o + "</li>"; }).join("") + "</ul>";
           document.querySelectorAll("[role=tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === tab)); });
         }
         document.querySelectorAll("[role=tab]").forEach(function (b) { b.addEventListener("click", function () { setTimeout(function () { draw(b.dataset.tab); }, 150); }); });
         setTimeout(function () { draw("week"); }, 100);
       </script>`,
    );
  }
  if (p === "/article") {
    const paras = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}. ${i === 30 ? "The best cable for most people is the two metre HDMI cable. " : ""}Choosing the right cable, batteries and remote is easier than it looks, and this guide explains how.</p>`).join("");
    return page("Buying guide", `<article><h1>The living room buying guide</h1>${paras}<p><a href="/product/hdmi-cable" id="deep">See the HDMI cable</a></p></article>`);
  }
  if (p === "/signin" || p === "/account") {
    return page("Sign in", `<h1>Sign in</h1><form action="/signin" method="post"><label>Email <input type="email" name="email" autocomplete="username"></label><br><label>Password <input type="password" name="password"></label><br><label>Card number <input name="cardnumber" autocomplete="cc-number"></label><br><button>Sign in</button></form>`);
  }
  if (p === "/apps") {
    return page("Opening times", `<h1>Opening times</h1><p>Monday to Saturday, 9 to 6.</p><iframe src="http://127.0.0.1:${state.otherPort}/map" width="500" height="200" title="Map"></iframe>`);
  }
  // Two steps, each a form with its box ready for typing: sending the first must not also send the second.
  if (p === "/delivery") {
    return page("Delivery", `<h1>Where should it go?</h1><form action="/delivery" method="post"><label>Postcode <input name="postcode" autofocus></label> <button>Continue</button></form>`);
  }
  if (p === "/newsletter") {
    return page("One more thing", `<h1>One more thing</h1><p>Your order is going to ${esc(state.steps.filter((x) => x.startsWith("delivery:")).pop()?.slice(9) || "you")}.</p><form action="/newsletter" method="post"><label>Email for offers <input name="email" value="someone@example.com" autofocus></label> <button>Sign me up</button></form>`);
  }
  // A button that jumps away as the pointer reaches it: the click lands on what was underneath.
  if (p === "/tricky") {
    return page("A page that moves", `<h1>A page that moves</h1><div style="position:relative;height:420px"><p id="under" style="position:absolute;left:0;top:10px;margin:0;width:400px;height:60px">Nothing to press here</p><button id="dodge" style="position:absolute;left:0;top:0;width:260px;height:60px" onclick="document.title='Caught'">Catch me</button></div>
      <script>document.getElementById("dodge").addEventListener("mouseover", function () { this.style.top = "330px"; });</script>`);
  }
  if (p === "/cleared") return page("Basket cleared", "<h1>Your basket is empty now</h1>");
  if (p === "/bought") return page("Thank you", "<h1>Thank you for your order</h1>");
  return null;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/** Start the shop. Resolves with { url, state: { searches, basket, bought, steps }, close }. */
export async function startWebsite({ host = "127.0.0.1" } = {}) {
  const state = { searches: [], basket: [], bought: [], steps: [], otherPort: 0 };
  // "Another site", for the part of a page that comes from somewhere else.
  const other = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Map</title><p>Map from another site</p><a href='/directions'>Directions</a>"));
  await new Promise((r) => other.listen(0, "127.0.0.1", r));
  state.otherPort = other.address().port;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://shop");
    if (req.method === "POST") {
      const body = await readBody(req);
      if (url.pathname === "/basket/add") {
        state.basket.push({ id: body.get("id"), qty: Number(body.get("qty") || 1), gift: body.get("gift") === "1" });
        return res.writeHead(303, { location: "/basket" }).end();
      }
      if (url.pathname === "/buy") {
        state.bought.push(body.get("id"));
        return res.writeHead(303, { location: "/bought" }).end();
      }
      if (url.pathname === "/delivery") {
        state.steps.push(`delivery:${body.get("postcode")}`);
        return res.writeHead(303, { location: "/newsletter" }).end();
      }
      if (url.pathname === "/newsletter") {
        state.steps.push(`newsletter:${body.get("email")}`);
        return res.writeHead(303, { location: "/" }).end();
      }
      return res.writeHead(303, { location: "/" }).end();
    }
    const html = route(url, req.headers.cookie, state);
    if (!html) return res.writeHead(404, { "content-type": "text/html" }).end(page("Not found", "<h1>That page isn't here</h1>"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
  });
  await new Promise((r) => server.listen(0, host, r));
  return {
    url: `http://${host}:${server.address().port}`,
    state,
    close: () => Promise.all([new Promise((r) => server.close(r)), new Promise((r) => other.close(r))]),
  };
}
