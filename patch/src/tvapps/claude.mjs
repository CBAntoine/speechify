// Claude builds TV apps. The person describes an app (by voice, in the chat or in the dashboard) and
// Claude writes all of it: one HTML page that runs full screen on their TV, with the remote. Patch then
// packages and installs it like the TV apps it makes itself (index.mjs). Claude is reached with the
// person's own Anthropic API key, through Anthropic's SDK, which is only loaded when it's needed.

export const CLAUDE_MODEL = "claude-opus-5-5";
export const CLAUDE_NAME = "Claude Opus 5.5";
const API = "https://api.anthropic.com";
const MAX_HTML = 400 * 1024;
// Claude Opus 5.5's prices (US$ per million tokens), for showing roughly what a build cost.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

export class ClaudeError extends Error {
  constructor(message, status = 502, code = "claude") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let sdk = null;
/** Anthropic's SDK, loaded the first time Claude is needed, so a problem with it can't stop Patch. */
export function loadSdk() {
  sdk ??= import("@anthropic-ai/sdk").then((m) => m.default);
  return sdk;
}

/** Whether the SDK loads here (shown in Patch's state, and checked on the phone in its tests). */
export async function sdkReady() {
  try {
    return typeof (await loadSdk()) === "function";
  } catch {
    return false;
  }
}

function client(Anthropic, { apiKey, baseURL, ...options }) {
  // Only the key the person gave Patch, and Anthropic's own address: never a key, token or address
  // that happens to be set in this computer's environment for something else.
  return new Anthropic({ apiKey, authToken: null, baseURL: baseURL || API, maxRetries: 2, timeout: 20 * 60_000, ...options });
}

// What Claude sends back: a JSON object with these fields (structured output, so it always parses).
const APP_SCHEMA = {
  type: "object",
  properties: {
    about: { type: "string", description: "One or two plain sentences for the person: what the app does and how to use it with the remote." },
    html: { type: "string", description: "The complete app: one HTML document, starting with <!doctype html>." },
  },
  required: ["about", "html"],
  additionalProperties: false,
};

const SYSTEM = `You build apps for people's TVs. Someone describes an app, often in a few spoken words, and you write the whole app as one HTML document. Patch, their home network assistant, installs it on their TV as a real app (Android TV, Google TV and Fire TV) or opens it in the TV's web browser (Samsung and LG). The same page may also be opened on a phone, a tablet or a computer.

Build what they asked for, complete and working: real content and real logic, nothing left as a placeholder or "coming soon". The description may come from speech recognition, so read it generously and fill in sensible details yourself. Don't ask questions: no one can answer them. When a request is unclear, build the most useful version of it.

## Where it runs
- Android TV, Google TV and Fire TV: a full-screen Android WebView (Chromium 70 or newer on older Fire TV sticks).
- Samsung and LG TVs: the TV's own web browser, which can be several years old (about Chrome 56 on older sets).
- Phones, tablets and computers, with touch or a mouse.
So write one self-contained file: inline <style> and <script>; no external scripts, stylesheets, fonts or images, because the TV may be offline. Draw pictures with CSS, inline SVG, canvas or emoji. Write JavaScript that old TV browsers run: ES2015 (let and const, arrow functions, template strings, classes, Promise and fetch are fine), with no async/await, no optional chaining or ??, no object spread, no ES modules, no imports and no frameworks. Put the script at the end of <body>.

## The remote
Most people use a TV remote with arrows, OK and Back, so everything must work with those alone.
- Listen for keydown on document and check both e.key and e.keyCode, since TVs differ: ArrowUp 38, ArrowDown 40, ArrowLeft 37, ArrowRight 39, and Enter 13 for OK. Back is Escape 27, Backspace 8, 10009 on Samsung and 461 on LG. Media keys when they help: MediaPlayPause 179 (some TVs send 415 for play and 19 for pause).
- Exactly one thing is selected at a time, and it's obvious from across the room: a thick bright ring, a glow or a slight scale-up. The arrows move the selection to the nearest item in that direction, and OK uses it. Start with the most useful item selected. Never rely on hover, a pointer or typing; if the app needs words, offer choices or an on-screen keyboard grid.
- Back: define window.tvkit = { back: function () { ... } }. On Android TV the remote's Back button calls it: close what's open or go back one screen and return true; return false on the first screen, and the app closes. Call the same function for the Back keys above in TV browsers.
- Taps and clicks work on everything too, for phones and computers.
- Games: the arrows play the game directly, OK pauses or confirms, and there's a start screen with one line of instructions, a score, game over and play again. Keep the best score in localStorage.

## The screen
- Design for 1920 by 1080, seen from a sofa: body text at least 32px, headings 64px or more, no more than about eight short items on screen at once, and generous space. Keep everything inside a 5% margin, because TVs crop the edges. Size things with vw and vh or a scale factor, so the app also fits 1280 by 720, 4K and phones (portrait too). The page itself never scrolls: each screen fits, and a long list pages or scrolls inside its own box, keeping the selection in view.
- Make it look good: a dark, calm background unless the app calls for something else, one accent colour, clear contrast, and short smooth transitions. Respect prefers-reduced-motion.

## Data
- Keep settings, lists and scores in localStorage, wrapped in try/catch (it can be unavailable).
- The app may use public APIs that need no key and allow cross-origin requests, such as Open-Meteo for weather and Wikipedia's REST API. Show that it's loading, and a friendly message with a way to retry when a request fails. Don't invent APIs: if you aren't sure one exists and works without a key, build the app without it.
- Clocks, dates and countdowns use the device's own clock (new Date()).

## Extras on Android TV and Fire TV
When the app runs installed on the TV, window.PatchTV exists. Check for it first: it's missing in browsers.
- PatchTV.openUrl(url): opens a web page in the TV's browser, or a YouTube link in the TV's YouTube app.
- PatchTV.launch(nameOrPackage): opens another app on the TV, by its name ("Netflix") or its package id.
- PatchTV.apps(): the TV's apps, as a JSON string: [{"name": "...", "package": "..."}].
- PatchTV.keepAwake(true or false): keeps the screen on (for clocks, slideshows and boards).
- PatchTV.exit(): closes the app.
Without PatchTV, fall back sensibly (window.open for a link; leave out what can't work there).

## Never
Never ask for or keep passwords or payment details. No ads, trackers or analytics, no other sites in frames, and no code loaded from elsewhere. Keep the file under 150 KB.

## What you return
- about: one or two plain sentences for the person: what the app does and how to use it with the remote.
- html: the complete document, starting with <!doctype html>, with <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1"> and a <title>.`;

/** The request for a new app. */
export function newAppRequest({ description, name, where }) {
  return [
    "Build this app for the TV.",
    "",
    "<description>",
    description,
    "</description>",
    "",
    `Its name: ${name}`,
    `Where it will run: ${where || "the person's TVs (installed on Android TV and Fire TV, or in the browser on Samsung and LG TVs)"}`,
  ].join("\n");
}

/** The request for a new version of an app: what it is now, and the change. */
export function changeRequest({ name, html, instruction, history = [], where }) {
  return [
    `Here is the TV app “${name}” as it is now.`,
    ...(history.length ? ["", "It was built from these requests, oldest first:", ...history.map((h) => `- ${h}`)] : []),
    "",
    "<app>",
    html,
    "</app>",
    "",
    "Change it like this:",
    "",
    "<change>",
    instruction,
    "</change>",
    "",
    "Keep everything that works and wasn't asked to change. Return the whole updated app.",
    ...(where ? [`Where it runs: ${where}`] : []),
  ].join("\n");
}

/** Roughly what the request cost, from what the API reported (every attempt, when a fallback ran). */
export function costOf(usage) {
  if (!usage) return null;
  const parts = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
  let input = 0;
  let output = 0;
  let dollars = 0;
  for (const u of parts) {
    const i = u.input_tokens || 0;
    const o = u.output_tokens || 0;
    const w = u.cache_creation_input_tokens || 0;
    const r = u.cache_read_input_tokens || 0;
    input += i + w + r;
    output += o;
    dollars += (i * PRICE.input + o * PRICE.output + w * PRICE.cacheWrite + r * PRICE.cacheRead) / 1e6;
  }
  return { inputTokens: input, outputTokens: output, dollars: Math.round(dollars * 100) / 100 };
}

/** Claude's answer as an app: { about, html }. */
export function readAnswer(message) {
  if (message.stop_reason === "refusal") throw new ClaudeError("Claude wouldn't build that. Try describing the app differently.", 422, "refusal");
  if (message.stop_reason === "max_tokens") throw new ClaudeError("Claude's app came out too long and was cut off. Ask for something a little simpler.", 502, "too_long");
  // After a server-side fallback the answer can carry on across the switch, so try what came after
  // the last switch, then all of the text.
  const blocks = message.content || [];
  const switched = blocks.map((b) => b.type).lastIndexOf("fallback");
  const text = (list) => list.filter((b) => b.type === "text").map((b) => b.text).join("");
  let out = null;
  for (const t of [text(blocks.slice(switched + 1)), text(blocks)]) {
    try {
      out = JSON.parse(t);
      break;
    } catch {
      /* the next way */
    }
  }
  const html = typeof out?.html === "string" ? out.html.trim() : "";
  if (!/<(html|body|script|div|canvas|main)[\s>]/i.test(html)) throw new ClaudeError("Claude's answer wasn't a complete app. Try again.", 502, "bad_answer");
  if (Buffer.byteLength(html) > MAX_HTML) throw new ClaudeError("Claude's app came out bigger than a TV app can be (400 KB). Ask for something simpler.", 502, "too_big");
  const about = String(out.about || "").replace(/\s+/g, " ").trim().slice(0, 400);
  return { about, html: /^<!doctype html>/i.test(html) ? html : `<!doctype html>\n${html}` };
}

/** An SDK error in words the person understands, most specific first. */
function explain(err, A) {
  if (err instanceof ClaudeError) return err;
  if (err instanceof A.APIUserAbortError || err?.name === "AbortError") return new ClaudeError("Stopped.", 499, "cancelled");
  if (err instanceof A.AuthenticationError) return new ClaudeError("Claude didn't accept your Anthropic API key. Check it in Settings → Claude.", 401, "auth");
  if (err instanceof A.PermissionDeniedError) return new ClaudeError(`Your Anthropic API key isn't allowed to use ${CLAUDE_NAME}. Check the key in the Anthropic Console (console.anthropic.com → API keys).`, 403, "permission");
  if (err instanceof A.PaymentRequiredError || (err instanceof A.BadRequestError && /credit balance|billing/i.test(err.message))) return new ClaudeError("Your Anthropic account is out of credit. Add some at console.anthropic.com → Billing, then try again.", 402, "billing");
  if (err instanceof A.NotFoundError) return new ClaudeError(`Your Anthropic account can't use ${CLAUDE_NAME} yet.`, 404, "model");
  if (err instanceof A.RateLimitError) return new ClaudeError("Claude is busy for your account right now (rate limit). Try again in a minute.", 429, "rate_limit");
  if (err instanceof A.OverloadedError || err instanceof A.InternalServerError || err instanceof A.ServiceUnavailableError) return new ClaudeError("Claude is overloaded right now. Try again in a few minutes.", 503, "overloaded");
  if (err instanceof A.APIConnectionError) return new ClaudeError("Patch couldn't reach Claude. Check the internet connection and try again.", 502, "network");
  if (err instanceof A.BadRequestError) return new ClaudeError(`Claude couldn't take that request: ${String(err.error?.error?.message || err.message).slice(0, 200)}`, 400, "bad_request");
  if (err instanceof A.APIError) return new ClaudeError(`Claude had a problem (${err.status || "no answer"}). Try again.`, 502, "api");
  return new ClaudeError(`Claude had a problem: ${err?.message || err}`, 502, "unknown");
}

/**
 * Claude writes an app. request: the user message (newAppRequest or changeRequest). onProgress gets
 * { phase: "thinking" | "writing", chars } as the answer streams in. Returns { about, html, model, cost }.
 */
export async function writeApp({ apiKey, baseURL, request, signal, onProgress = () => {} }) {
  if (!apiKey) throw new ClaudeError("Claude isn't set up yet: add your Anthropic API key in Settings → Claude.", 412, "nokey");
  let Anthropic;
  try {
    Anthropic = await loadSdk();
  } catch (err) {
    throw new ClaudeError(`Patch couldn't load Anthropic's SDK (${err.message}).`, 500, "sdk");
  }
  let chars = 0;
  try {
    const stream = client(Anthropic, { apiKey, baseURL }).beta.messages.stream(
      {
        model: CLAUDE_MODEL,
        max_tokens: 64000,
        // If Claude's safety checks decline a request, Anthropic runs it on the model it recommends
        // for that case instead of just saying no.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: APP_SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: request }],
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "thinking") onProgress({ phase: "thinking", chars });
      else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        chars += event.delta.text.length;
        onProgress({ phase: "writing", chars });
      }
    }
    const message = await stream.finalMessage();
    return { ...readAnswer(message), model: message.model, cost: costOf(message.usage) };
  } catch (err) {
    throw explain(err, Anthropic);
  }
}

/** Check a key before saving it: the Models API answers without using any tokens. */
export async function checkKey({ apiKey, baseURL }) {
  let Anthropic;
  try {
    Anthropic = await loadSdk();
  } catch (err) {
    return { ok: false, message: `Patch couldn't load Anthropic's SDK (${err.message}).` };
  }
  try {
    await client(Anthropic, { apiKey, baseURL, maxRetries: 0, timeout: 15_000 }).models.retrieve(CLAUDE_MODEL);
    return { ok: true, message: `Key works. Claude (${CLAUDE_NAME}) can build apps now.` };
  } catch (err) {
    const e = explain(err, Anthropic);
    const unsure = ["network", "overloaded", "rate_limit"].includes(e.code);
    return { ok: false, network: unsure, message: unsure ? "Couldn't check the key with Claude just now, so I saved it anyway." : e.message };
  }
}
