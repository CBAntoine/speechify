import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

// Everything runs against a local stand-in for Google's OAuth and YouTube
// upload servers, in a throwaway app folder.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-yt-"));
process.env.CF_ROOT = root;
process.env.CF_WORKSPACE = path.join(root, "workspace");
process.env.CF_YT_CHUNK = String(256 * 1024);
process.env.CF_YT_BACKOFF_MS = "5";
process.env.CF_YT_POLL_MS = "5";
delete process.env.YOUTUBE_CLIENT_ID;

interface Seen {
  token: URLSearchParams[];
  init?: { headers: http.IncomingHttpHeaders; body: Record<string, any> };
  chunks: string[];
  statusChecks: number;
}
const seen: Seen = { token: [], chunks: [], statusChecks: 0 };
let received = 0;
let failOnce = true;
let size = 0;

const server = http.createServer((req, res) => {
  let raw: Buffer[] = [];
  req.on("data", (c) => raw.push(c));
  req.on("end", () => {
    const body = Buffer.concat(raw);
    const url = new URL(req.url!, "http://x");
    const json = (code: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/token") {
      const p = new URLSearchParams(body.toString());
      seen.token.push(p);
      if (p.get("grant_type") === "authorization_code") {
        if (p.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
        return json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", token_type: "Bearer" });
      }
      if (p.get("grant_type") === "refresh_token") return json(200, { access_token: "at-2", expires_in: 3600 });
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/yt/channels") {
      if (!req.headers.authorization?.startsWith("Bearer at-")) return json(401, { error: { message: "no" } });
      return json(200, { items: [{ id: "UC123", snippet: { title: "Heist Clips", customUrl: "@heistclips", thumbnails: { default: { url: "https://yt3.example/a.jpg" } } }, statistics: { subscriberCount: "12345", videoCount: "7" } }] });
    }
    if (url.pathname === "/yt/videos") return json(200, { items: [{ status: { uploadStatus: "processed", privacyStatus: "public" } }] });
    if (url.pathname === "/up/videos" && req.method === "POST") {
      seen.init = { headers: req.headers, body: JSON.parse(body.toString()) };
      size = Number(req.headers["x-upload-content-length"]);
      received = 0;
      res.writeHead(200, { Location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/up/session/abc` });
      return res.end();
    }
    if (url.pathname === "/up/session/abc" && req.method === "PUT") {
      const range = String(req.headers["content-range"] ?? "");
      if (range.startsWith("bytes */")) {
        seen.statusChecks++;
        res.writeHead(308, received ? { Range: `bytes=0-${received - 1}` } : {});
        return res.end();
      }
      seen.chunks.push(range);
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
      const [a, b] = [Number(m[1]), Number(m[2])];
      assert.equal(body.length, b - a + 1);
      if (a === 262144 && failOnce) {
        failOnce = false;
        res.writeHead(503);
        return res.end();
      }
      received = b + 1;
      if (received === size) return json(201, { id: "vid123", status: { privacyStatus: seen.init!.body.status.privacyStatus, uploadStatus: "uploaded" } });
      res.writeHead(308, { Range: `bytes=0-${received - 1}` });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.CF_GOOGLE_AUTH_URL = `${base}/auth`;
process.env.CF_GOOGLE_TOKEN_URL = `${base}/token`;
process.env.CF_GOOGLE_REVOKE_URL = `${base}/revoke`;
process.env.CF_YOUTUBE_API_URL = `${base}/yt`;
process.env.CF_YOUTUBE_UPLOAD_URL = `${base}/up`;

const yt = await import("../src/server/youtube.ts");
const { scheduleTimes } = await import("../src/server/publish.ts");
const { guard } = await import("../src/server/guard.ts");

test("the OAuth client JSON from Google Cloud Console is accepted, anything else isn't", () => {
  assert.throws(() => yt.saveClientConfig({ installed: { client_id: "nope" } }), /isn't a Google OAuth client/);
  const cfg = yt.saveClientConfig({ installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-s3cret", redirect_uris: ["http://localhost"] } });
  assert.equal(cfg.type, "installed");
  const st = yt.status("http://127.0.0.1:3200");
  assert.equal(st.configured, true);
  assert.equal(st.connected, false);
  assert.equal(st.redirectUri, "http://127.0.0.1:3200/");
  assert.equal((fs.statSync(path.join(root, ".secrets", "youtube-client.json")).mode & 0o777).toString(8), "600");
});

test("login: PKCE S256, offline access, upload + read scopes, then tokens and the channel", async () => {
  const { url, state, verifier } = yt.startLogin("http://127.0.0.1:3200/");
  const u = new URL(url);
  assert.equal(u.searchParams.get("client_id"), "123-abc.apps.googleusercontent.com");
  assert.equal(u.searchParams.get("redirect_uri"), "http://127.0.0.1:3200/");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), state);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(u.searchParams.get("code_challenge"), challenge);
  assert.match(u.searchParams.get("scope")!, /youtube\.upload/);
  await assert.rejects(yt.finishLogin("bad-code", verifier, "http://127.0.0.1:3200/"), /no longer accepts this login/);
  const channel = await yt.finishLogin("good-code", verifier, "http://127.0.0.1:3200/");
  assert.equal(channel.title, "Heist Clips");
  assert.equal(channel.subscribers, 12345);
  const ex = seen.token.find((p) => p.get("code") === "good-code")!;
  assert.equal(ex.get("code_verifier"), verifier);
  assert.equal(ex.get("redirect_uri"), "http://127.0.0.1:3200/");
  assert.equal(ex.get("client_secret"), "GOCSPX-s3cret");
  assert.equal(yt.status("http://127.0.0.1:3200").connected, true);
});

test("an expiring access token is refreshed", async () => {
  const file = path.join(root, ".secrets", "youtube-token.json");
  const store = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...store, expiry: Date.now() + 1000 }));
  assert.equal(await yt.accessToken(), "at-2");
  assert.equal(seen.token.at(-1)!.get("grant_type"), "refresh_token");
  assert.equal(seen.token.at(-1)!.get("refresh_token"), "rt-1");
});

test("metadata fits YouTube's limits", () => {
  const r = yt.videoResource({
    title: `<b>${"x".repeat(150)}</b>`,
    description: "é".repeat(4000),
    tags: ["gta", "#gaming", ...Array.from({ length: 80 }, (_, i) => `tag number ${i}`)],
    privacy: "public",
    language: "en",
  });
  assert.ok([...r.snippet.title].length <= 100);
  assert.ok(!/[<>]/.test(r.snippet.title));
  assert.ok(Buffer.byteLength(r.snippet.description, "utf8") <= 5000);
  const tagChars = r.snippet.tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0), 0) + r.snippet.tags.length - 1;
  assert.ok(tagChars <= 500);
  assert.equal(r.snippet.tags[1], "gaming");
  assert.equal(r.snippet.categoryId, "20");
  assert.equal(r.status.privacyStatus, "public");
  assert.equal(r.status.selfDeclaredMadeForKids, false);
  const s = yt.videoResource({ title: "t", description: "", tags: [], privacy: "public", publishAt: "2030-01-01T10:00:00Z" });
  assert.equal(s.status.privacyStatus, "private");
  assert.equal((s.status as { publishAt?: string }).publishAt, "2030-01-01T10:00:00.000Z");
});

test("resumable upload: 256 KiB chunks, recovers from a 503 by asking how much arrived", async () => {
  const file = path.join(root, "short.mp4");
  fs.writeFileSync(file, crypto.randomBytes(700_000));
  const progress: number[] = [];
  const video = await yt.uploadVideo(file, { title: "NO WAY.", description: "d", tags: ["gta"], privacy: "unlisted" }, { onProgress: (f) => progress.push(f) });
  assert.equal(video.id, "vid123");
  assert.equal(seen.init!.headers["x-upload-content-length"], "700000");
  assert.equal(seen.init!.headers["x-upload-content-type"], "video/mp4");
  assert.equal(seen.init!.body.status.privacyStatus, "unlisted");
  assert.equal(seen.init!.body.snippet.title, "NO WAY.");
  assert.deepEqual(seen.chunks, ["bytes 0-262143/700000", "bytes 262144-524287/700000", "bytes 262144-524287/700000", "bytes 524288-699999/700000"]);
  assert.equal(seen.statusChecks, 1);
  assert.equal(progress.at(-1), 1);
  assert.equal(yt.receivedUpTo("bytes=0-1048575"), 1048576);
  assert.equal(yt.receivedUpTo(null), 0);
});

test("posting a shipped short end to end, and the dashboard state it leaves", async () => {
  const { createJob, getJob, update } = await import("../src/server/jobs.ts");
  const { publishShort, uploadsDone } = await import("../src/server/publish.ts");
  const job = createJob({ name: "TEST" });
  const dir = path.join(process.env.CF_WORKSPACE!, job.id);
  fs.mkdirSync(path.join(dir, "export"), { recursive: true });
  fs.writeFileSync(path.join(dir, "export", "SHORT_01.mp4"), crypto.randomBytes(300_000));
  update(job.id, (s) => {
    s.source = { title: "Heist", url: "https://www.twitch.tv/videos/1", duration: 92, width: 1280, height: 720, fps: 30, hasAudio: true, file: "source.mp4", media: "source.mp4" };
    s.shorts = [{ id: "short_01", n: 1, order: 1, title: "The building blew up", hook: "NO WAY.", reason: "", score: 95, description: "Chat lost it.", hashtags: ["gta", "gaming"], start: 0, end: 20, keep: [[0, 20]], deadAir: 0, duration: 20, status: "done", progress: 1, file: "export/SHORT_01.mp4", dubs: [] }];
  });
  failOnce = false;
  publishShort(job.id, "short_01", { privacy: "public" });
  // The queue starts right away when nothing else is uploading.
  assert.ok(["queued", "uploading"].includes(getJob(job.id)!.shorts[0].youtube!.status));
  assert.throws(() => publishShort(job.id, "short_01", { privacy: "public" }), /already being posted/);
  await uploadsDone();
  const y = getJob(job.id)!.shorts[0].youtube!;
  assert.equal(y.status, "posted");
  assert.equal(y.url, "https://youtube.com/shorts/vid123");
  assert.equal(y.note, undefined);
  // The description links the stream and carries the hashtags.
  assert.match(seen.init!.body.snippet.description, /Full stream: https:\/\/www\.twitch\.tv\/videos\/1/);
  assert.match(seen.init!.body.snippet.description, /#gta #gaming #Shorts/);
});

test("schedules: a later start, a spaced-out run, or all now", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  assert.deepEqual(scheduleTimes(3, "2026-11-24T18:00:00Z", 6, now), ["2026-11-24T18:00:00.000Z", "2026-11-25T00:00:00.000Z", "2026-11-25T06:00:00.000Z"]);
  assert.deepEqual(scheduleTimes(3, undefined, 12, now), [undefined, "2026-11-24T00:00:00.000Z", "2026-11-24T12:00:00.000Z"]);
  assert.deepEqual(scheduleTimes(2, undefined, undefined, now), [undefined, undefined]);
  // A start time that has already passed means "now, then spaced out".
  assert.deepEqual(scheduleTimes(2, "2026-11-23T11:00:00Z", 1, now), [undefined, "2026-11-23T13:00:00.000Z"]);
});

test("only the dashboard's own pages can act; other sites and rebinding hosts can't", () => {
  const req = (h: Record<string, string>) => new Request("http://127.0.0.1:3200/api/jobs", { method: "POST", headers: h });
  assert.equal(guard(req({ host: "127.0.0.1:3200", origin: "http://127.0.0.1:3200", "sec-fetch-site": "same-origin" })), null);
  assert.equal(guard(req({ host: "evil.example:3200" }))?.status, 403);
  assert.equal(guard(req({ host: "127.0.0.1:3200", origin: "https://evil.example" }))?.status, 403);
  assert.equal(guard(req({ host: "127.0.0.1:3200", "sec-fetch-site": "cross-site" }))?.status, 403);
  // Reading only checks the host (Google's redirect back is cross-site by design).
  assert.equal(guard(req({ host: "localhost:3200", "sec-fetch-site": "cross-site" }), "read"), null);
});

test("disconnect forgets the login", async () => {
  await yt.disconnect();
  assert.equal(yt.status("http://127.0.0.1:3200").connected, false);
  server.close();
});
