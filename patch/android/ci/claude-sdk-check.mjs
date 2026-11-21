// Checks the phone app's copy of Patch can use Claude: Anthropic's SDK, copied into the app by
// prepare-assets.mjs without its type definitions and sources, still loads, and a build streams from
// a stand-in for Anthropic's API (nothing reaches Anthropic).
// Usage: node claude-sdk-check.mjs <the app's assets/patch folder>
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startClaudeApi } from "../../sim/claude-api.mjs";

const copy = path.resolve(process.argv[2]);
const claude = await import(pathToFileURL(path.join(copy, "src/tvapps/claude.mjs")).href);
const api = await startClaudeApi();
const fail = (m) => {
  console.error(`FAILED: ${m}`);
  process.exit(1);
};
try {
  if (!(await claude.sdkReady())) fail("Anthropic's SDK doesn't load from the phone's copy of Patch");
  const key = await claude.checkKey({ apiKey: api.key, baseURL: api.url });
  if (!key.ok) fail(`the key check didn't work: ${key.message}`);
  api.queue.push({ app: { about: "A test.", html: "<!doctype html><html><body><p>Built</p></body></html>" }, chunks: 5 });
  let writing = 0;
  const made = await claude.writeApp({ apiKey: api.key, baseURL: api.url, request: "Build a test app.", onProgress: (p) => p.phase === "writing" && writing++ });
  if (made.about !== "A test." || !made.html.includes("<p>Built</p>")) fail(`the app didn't come through: ${JSON.stringify(made).slice(0, 200)}`);
  if (!writing) fail("no progress was reported while Claude wrote");
  console.log(`The phone's copy of Patch loads Anthropic's SDK and streams a build (${writing} progress updates).`);
} finally {
  await api.close();
}
