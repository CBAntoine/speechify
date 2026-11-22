#!/usr/bin/env node
// Used-up ElevenLabs credits, end to end in a real browser: the dashboard talks to a stand-in for
// ElevenLabs (sessions and the account's credits) and to a stand-in for the voice library that
// refuses to start, the way ElevenLabs does when the month's credits are gone. Checks what the
// person is told, in the conversation and in Settings.
// Not part of `npm test`: it needs Playwright and a Chromium, which Patch itself doesn't.
// Usage: node sim/credits-check.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startApp } from "../src/app.mjs";

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("This check needs Playwright (npm install --no-save playwright, then npx playwright install chromium).");
  process.exit(2);
}

const ACCOUNTS = {
  "used-up": { character_count: 40562, character_limit: 40562 },
  plenty: { character_count: 1000, character_limit: 40562 },
  low: { character_count: 38562, character_limit: 40562 },
};
const eleven = http.createServer((req, res) => {
  const a = ACCOUNTS[req.headers["xi-api-key"]];
  res.writeHead(a ? 200 : 401, { "content-type": "application/json" });
  if (!a) return res.end(JSON.stringify({ detail: { status: "invalid_api_key" } }));
  if (req.url === "/v1/user/subscription") return res.end(JSON.stringify({ tier: "starter", ...a, next_character_count_reset_unix: 1796385600 }));
  if (req.url.includes("/conversation/token")) return res.end(JSON.stringify({ token: "lk-token" }));
  return res.end(JSON.stringify({ signed_url: "wss://example.invalid/convai" }));
});
await new Promise((r) => eleven.listen(0, "127.0.0.1", r));
const elevenlabsBase = `http://127.0.0.1:${eleven.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-credits-"));
const app = await startApp({ port: 0, demo: true, dataDir, overrides: { elevenlabsBase }, autoScan: false, log: () => {} });
const base = `http://127.0.0.1:${app.port}`;
const api = async (method, p, body) => (await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || !detail ? "" : `\n     ${detail}`}`); if (!ok) failed++; };

// PATCH_SHOTS=<folder> also saves pictures of what the person sees.
const shots = process.env.PATCH_SHOTS || "";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The stand-in voice library. window.__how says what ElevenLabs does this time.
  await page.addInitScript(() => {
    window.ElevenLabsClient = {
      Conversation: {
        startSession: async (o) => {
          const how = window.__how;
          if (how === "refuse-before-connecting") throw new Error("The AI agent you are trying to reach is not available.");
          const conv = {
            endSession: async () => o.onDisconnect({ reason: "user" }),
            sendUserMessage: () => {}, sendContextualUpdate: () => {}, setMicMuted: () => {},
          };
          o.onConversationCreated?.(conv);
          setTimeout(() => {
            o.onConnect();
            if (how === "refuse-after-connecting") setTimeout(() => o.onDisconnect({ reason: "agent", context: { type: "close", reason: "1" } }), 300);
            if (how === "refuse-with-error") setTimeout(() => {
              o.onError("Server error: The AI agent you are trying to reach is not available.", { errorType: "call_initialization_error", code: 3000 });
              o.onDisconnect({ reason: "error", message: "The connection was closed by the server.", closeCode: 3000 });
            }, 300);
            if (how === "talk") setTimeout(() => o.onMessage({ message: "Hi, I'm Patch.", role: "agent" }), 200);
          }, 50);
          return conv;
        },
      },
    };
  });
  await page.goto(base);
  await page.waitForSelector("#voiceFab");
  const log = () => page.$$eval("#voiceLog > *", (els) => els.map((e) => e.textContent.trim()));
  const notice = () => page.$eval("#voiceNotice", (e) => (e.hidden ? "" : e.textContent.trim()));
  const noticeLink = () => page.$eval("#voiceNotice", (e) => e.querySelector("a")?.href || "");
  const talk = async (how) => {
    await page.evaluate((h) => { window.__how = h; }, how);
    await page.click('#voiceControls [data-voice="talk"]');
  };
  await page.click("#voiceFab");

  // 1. Voice: ElevenLabs connects, then ends at once (what the phone showed as "Conversation ended").
  await api("POST", "/api/settings", { elevenlabsApiKey: "used-up" });
  await page.reload();
  await page.waitForSelector("#voiceFab");
  await page.click("#voiceFab");
  await talk("refuse-after-connecting");
  await page.waitForFunction(() => !document.querySelector("#voiceNotice").hidden && /credits/.test(document.querySelector("#voiceNotice").textContent), null, { timeout: 5000 }).catch(() => {});
  let lines = await log();
  let n = await notice();
  check(lines.includes("ElevenLabs didn't start the conversation.") && !lines.includes("Conversation ended."), "voice: the conversation log says ElevenLabs didn't start it", JSON.stringify(lines.slice(-3)));
  check(/^Your ElevenLabs credits for this month are used up \(40,562 of 40,562\), so ElevenLabs won't start a conversation\. They renew on December 4\./.test(n), "voice: the notice says the credits are used up, and when they renew", n);
  check((await noticeLink()) === "https://elevenlabs.io/app/developers", "voice: with a button to add credits on ElevenLabs");
  if (shots) await page.screenshot({ path: path.join(shots, "credits-used-up.png") });

  // 2. Typing: ElevenLabs refuses before the conversation connects (what the phone showed as the raw message).
  const refusals = () => page.$$eval("#voiceLog > *", (els) => els.filter((e) => e.textContent.trim() === "ElevenLabs didn't start the conversation.").length);
  const refusedAgain = (k) => page.waitForFunction((k) => [...document.querySelectorAll("#voiceLog > *")].filter((e) => e.textContent.trim() === "ElevenLabs didn't start the conversation.").length > k && /^Your ElevenLabs credits/.test(document.querySelector("#voiceNotice").textContent.trim()), k, { timeout: 5000 }).catch(() => {});
  const before2 = await refusals();
  await page.fill("#voiceText", "Are you ok?");
  await page.evaluate(() => { window.__how = "refuse-before-connecting"; });
  await page.press("#voiceText", "Enter");
  await refusedAgain(before2);
  n = await notice();
  check((await refusals()) === before2 + 1 && /^Your ElevenLabs credits for this month are used up/.test(n) && !/trying to reach/.test(n), "typing: the same plain notice, not ElevenLabs' “not available”", JSON.stringify({ n, last: (await log()).slice(-3) }));

  // 3. ElevenLabs' error comes first, then the end.
  const before3 = await refusals();
  await talk("refuse-with-error");
  await page.waitForFunction((k) => [...document.querySelectorAll("#voiceLog > *")].filter((e) => e.textContent.trim() === "ElevenLabs didn't start the conversation.").length > k && /^Your ElevenLabs credits/.test(document.querySelector("#voiceNotice").textContent.trim()), before3, { timeout: 5000 }).catch(() => {});
  n = await notice();
  check((await refusals()) === before3 + 1 && /^Your ElevenLabs credits for this month are used up/.test(n), "an error, then the end: still explained as used-up credits", JSON.stringify({ n, last: (await log()).slice(-3) }));

  // 4. Settings shows the balance, and where to add credits.
  await page.click("#settingsBtn");
  await page.waitForSelector("#elCredits:not([hidden])", { timeout: 5000 }).catch(() => {});
  const credits = await page.$eval("#elCredits", (e) => ({ hidden: e.hidden, text: e.textContent.trim(), cls: e.className, link: e.querySelector("a")?.href || "" })).catch(() => null);
  check(credits && !credits.hidden && /used up \(40,562 of 40,562\)/.test(credits.text) && /check--bad/.test(credits.cls) && credits.link === "https://elevenlabs.io/app/developers", "Settings: credits used up, in red, with a link to add credits", JSON.stringify(credits));
  await page.$eval("#elCredits", (e) => e.scrollIntoView({ block: "center" }));
  await sleep(350);
  // On a phone the voice panel is open too: Settings has to be on top of it to be seen.
  const onTop = await page.$eval("#elCredits", (e) => {
    const r = e.getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("#modal");
  });
  check(onTop, "on a phone, Settings opens over the voice panel, not under it");
  if (shots) await page.screenshot({ path: path.join(shots, "credits-in-settings.png") });
  await page.click('#modal [data-ui="close"]');
  await sleep(300);
  const backToVoice = await page.$eval("#voiceText", (e) => {
    const r = e.getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("#voice");
  });
  check(backToVoice, "closing Settings goes back to the conversation");

  // 5. Credits fine, and the person ends the conversation quickly themselves: no warning at all.
  await api("POST", "/api/settings", { elevenlabsApiKey: "plenty" });
  await page.reload();
  await page.waitForSelector("#voiceFab");
  await page.click("#voiceFab");
  await talk("talk");
  await page.waitForFunction(() => [...document.querySelectorAll("#voiceLog > *")].some((e) => /Hi, I'm Patch/.test(e.textContent)), null, { timeout: 5000 });
  await page.click('#voiceControls [data-voice="end"]');
  await sleep(500);
  lines = await log();
  check(lines.includes("Conversation ended.") && !lines.some((l) => /didn't start|running low/.test(l)) && !(await notice()), "credits fine: an ordinary start and end, nothing about credits", JSON.stringify(lines));

  // 6. Credits running low: one line as the conversation starts.
  await api("POST", "/api/settings", { elevenlabsApiKey: "low" });
  await page.reload();
  await page.waitForSelector("#voiceFab");
  await page.click("#voiceFab");
  await talk("talk");
  await page.waitForFunction(() => [...document.querySelectorAll("#voiceLog > *")].some((e) => /running low/.test(e.textContent)), null, { timeout: 5000 }).catch(() => {});
  lines = await log();
  check(lines.some((l) => l === "ElevenLabs credits are running low: 2,000 of 40,562 left this month, until they renew on December 4. Talking uses a few hundred a minute."), "credits low: a line says how many are left", JSON.stringify(lines));

  check(!errors.length, "no errors on the page", errors.join(" | "));
} finally {
  await browser.close();
  await app.close();
  eleven.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
