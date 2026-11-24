import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

// The clipping business end to end against stand-ins for Twitch, TikTok and
// Instagram: track a creator, add their campaign, find their new VOD, start
// a job, schedule a finished job's shorts on two accounts, post them, read
// their views back, and see what the campaign owes.

const seen: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
const VOD_START = new Date(Date.now() - 5 * 3600_000).toISOString();

function route(method: string, url: URL, body: string): { status?: number; json?: unknown; raw?: string } {
  const p = url.pathname;
  // Twitch
  if (p === "/twitch/token") return { json: { access_token: "tw-token", expires_in: 3600, token_type: "bearer" } };
  if (p === "/twitch/helix/users") return { json: { data: [{ id: "111", login: "streamer", display_name: "Streamer", profile_image_url: "https://example.com/p.png" }] } };
  if (p === "/twitch/helix/videos") return { json: { data: [{ id: "9001", stream_id: "s1", user_id: "111", user_login: "streamer", title: "Bank heist stream", created_at: VOD_START, url: "https://www.twitch.tv/videos/9001", view_count: 52000, type: "archive", duration: "3h0m0s" }] } };
  if (p === "/twitch/helix/streams") return { json: { data: [] } };
  if (p === "/twitch/helix/channels/followers") return { json: { total: 1_200_000 } };
  if (p === "/twitch/helix/clips") return { json: { data: [{ id: "c1", url: "https://clips.twitch.tv/c1", broadcaster_id: "111", video_id: "9001", title: "NO WAY", view_count: 40000, created_at: VOD_START, duration: 30, vod_offset: 3600 }], pagination: {} } };
  // TikTok (direct post)
  if (p === "/tiktok/v2/post/publish/creator_info/query/") return { json: { data: { creator_username: "clipsbyme", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } } };
  if (p === "/tiktok/v2/post/publish/video/init/") return { json: { data: { publish_id: "pub_1", upload_url: `${base}/tiktok-upload/pub_1` }, error: { code: "ok" } } };
  if (p === "/tiktok-upload/pub_1") return { status: 201, json: {} };
  // Raw text: the ID is a 19-digit JSON number, exactly as TikTok sends it.
  if (p === "/tiktok/v2/post/publish/status/fetch/") return { raw: '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok"}}' };
  if (p === "/tiktok/v2/video/query/") return { json: { data: { videos: [{ id: "7300000000000000001", view_count: 25000, like_count: 900, comment_count: 40 }] }, error: { code: "ok" } } };
  // Instagram
  if (p === "/ig/v24.0/me") return { json: { user_id: "1789", username: "clipsbyme_ig" } };
  if (p === "/ig/v24.0/1789/media" && method === "POST") return { json: { id: "cont_1", uri: `${base}/rupload/cont_1` } };
  if (p === "/rupload/cont_1") return { json: { success: true } };
  if (p === "/ig/v24.0/cont_1") return { json: { status_code: "FINISHED" } };
  if (p === "/ig/v24.0/1789/media_publish") return { json: { id: "media_1" } };
  if (p === "/ig/v24.0/media_1" && url.searchParams.get("fields") === "permalink") return { json: { permalink: "https://www.instagram.com/reel/abc/" } };
  if (p === "/ig/v24.0/media_1") return { json: { like_count: 50, comments_count: 3 } };
  if (p === "/ig/v24.0/media_1/insights") return { json: { data: [{ name: "views", values: [{ value: 12000 }] }] } };
  return { status: 404, json: { error: { message: `no route ${method} ${p}` } } };
}

let base = "";

test("the autopilot: who to clip → job → schedule → post → views → earnings", async () => {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", base);
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body: body.length > 2000 ? `<${body.length} bytes>` : body.toString() });
      const r = route(req.method ?? "GET", url, body.toString());
      res.writeHead(r.status ?? 200, { "Content-Type": "application/json" });
      res.end(r.raw ?? JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cf-biz-"));
  Object.assign(process.env, {
    CF_ROOT: root,
    CF_WORKSPACE: path.join(root, "workspace"),
    CF_TWITCH_API_URL: `${base}/twitch/helix`,
    CF_TWITCH_TOKEN_URL: `${base}/twitch/token`,
    TWITCH_CLIENT_ID: "cid",
    TWITCH_CLIENT_SECRET: "secret",
    CF_TIKTOK_API_URL: `${base}/tiktok`,
    TIKTOK_CLIENT_KEY: "ck",
    TIKTOK_CLIENT_SECRET: "cs",
    CF_IG_API_URL: `${base}/ig`,
    CF_TIKTOK_POLL_MS: "5",
    CF_IG_POLL_MS: "5",
  });
  delete process.env.YOUTUBE_API_KEY;
  try {
    const { act, addTiktokAccount, snapshot } = await import("../src/server/biz/api.ts");
    const { postDue, refreshStats, scan, schedulePosts } = await import("../src/server/biz/autopilot.ts");
    const { biz, mutate } = await import("../src/server/biz/store.ts");
    const { writeSecret } = await import("../src/server/secrets.ts");
    const { createJob, getJob, update } = await import("../src/server/jobs.ts");

    // 1. Track a creator from a pasted link; Twitch fills in who they are.
    await act({ action: "creator.add", input: "https://www.twitch.tv/Streamer" });
    let c = biz().creators[0];
    assert.equal(c.id, "twitch:streamer");
    assert.equal(c.name, "Streamer");
    assert.equal(c.platformId, "111");
    assert.equal(c.permission, "unknown");
    assert.equal(c.autopilot, false, "no permission yet, so the autopilot leaves them alone");

    // 2. Their paid campaign: that's the permission.
    await act({ action: "campaign.save", campaign: { name: "Streamer clipping", url: "https://whop.com/streamer/", creatorIds: ["twitch:streamer"], ratePer1k: 2, minViews: 10000, rules: { requiredText: "#ad", mentions: "streamer", platforms: ["tiktok", "instagram"] } } });
    c = biz().creators[0];
    assert.equal(c.permission, "campaign");
    assert.equal(c.autopilot, true);
    await act({ action: "creator.update", id: c.id, patch: { vocabulary: "Duke, heist" } });

    // 3. Scan: the fresh VOD becomes a job with the creator's words and the campaign's limits.
    await act({ action: "autopilot.update", patch: { enabled: true, maxJobsPerDay: 2, shortsPerVod: 4 } });
    const r = await scan({ manual: true });
    assert.equal(r.started, 1);
    const jobId = Object.keys(biz().jobs)[0];
    const job = getJob(jobId)!;
    assert.equal(job.options.url, "https://www.twitch.tv/videos/9001");
    assert.equal(job.options.count, 4);
    assert.deepEqual(job.options.vocabulary, ["Streamer", "Duke", "heist"]);
    assert.ok(biz().creators[0].seenVods?.includes("9001"));
    const opp = snapshot().opportunities[0];
    assert.match(opp.reasons.join(" | "), /\$2\.00 per 1K views/);
    assert.match(opp.reasons.join(" | "), /Viewers clipped them 1× in 24 h/);
    assert.equal((await scan({ manual: true })).started, 0, "the same VOD isn't clipped twice");

    // 4. Accounts: a TikTok login (as the OAuth callback leaves it) and an Instagram token.
    writeSecret("tiktok-open1.json", { openId: "open1", access_token: "tt", refresh_token: "rt", expiresAt: Date.now() + 86400_000, refreshExpiresAt: Date.now() + 300 * 86400_000, scope: "video.publish", username: "clipsbyme", mode: "direct" });
    addTiktokAccount("tiktok:open1", "@clipsbyme", "clipsbyme", undefined, "direct");
    await act({ action: "instagram.connect", token: "IGAAtesttokentesttokentest" });
    assert.deepEqual(
      biz()
        .accounts.map((a) => a.id)
        .sort(),
      ["instagram:1789", "tiktok:open1"],
    );

    // 5. A finished job (stand-in for the pipeline): its good shorts get slots on both accounts.
    const done = createJob({ url: "https://www.twitch.tv/videos/9001" });
    const file = path.join(process.env.CF_WORKSPACE!, done.id, "export", "SHORT_01.mp4");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(300_000, 7));
    update(done.id, (s) => {
      s.status = "done";
      s.shorts = [
        { id: "short_01", n: 1, title: "He robbed the wrong bank", hook: "NO WAY.", reason: "", score: 91, description: "The heist went sideways.", hashtags: ["gta", "heist"], start: 3590, end: 3630, keep: [[3590, 3630]], deadAir: 0, duration: 40, status: "done", progress: 1, dubs: [], file: `export/SHORT_01.mp4`, category: "chaos", teaser: [3600, 3602] },
        { id: "short_02", n: 2, title: "Meh", hook: "OK.", reason: "", score: 40, description: "", hashtags: [], start: 10, end: 40, keep: [[10, 40]], deadAir: 0, duration: 30, status: "done", progress: 1, dubs: [], file: `export/SHORT_02.mp4` },
      ];
    });
    const n = schedulePosts(getJob(done.id)!, "twitch:streamer", biz().campaigns[0].id);
    assert.equal(n, 2, "the 91 goes to TikTok and Instagram; the 40 doesn't clear the bar");
    const posts = biz().posts;
    assert.ok(posts.every((p) => p.status === "scheduled"));
    assert.match(posts.find((p) => p.platform === "tiktok")!.caption, /@streamer #ad/);
    const hours = posts.map((p) => new Date(p.at).getHours());
    assert.ok(hours.every((h) => h >= 10 && h < 23), `slots inside posting hours: ${hours}`);

    // 6. Due: post both.
    mutate((d) => d.posts.forEach((p) => (p.at = new Date(Date.now() - 1000).toISOString())));
    assert.equal(await postDue(), 2);
    const tt = biz().posts.find((p) => p.platform === "tiktok")!;
    const ig = biz().posts.find((p) => p.platform === "instagram")!;
    assert.equal(tt.status, "posted", tt.error);
    assert.equal(tt.remoteId, "7300000000000000001");
    assert.equal(tt.url, "https://www.tiktok.com/@clipsbyme/video/7300000000000000001");
    assert.equal(ig.status, "posted", ig.error);
    assert.equal(ig.url, "https://www.instagram.com/reel/abc/");
    // The requests looked right.
    const init = JSON.parse(seen.find((s) => s.path === "/tiktok/v2/post/publish/video/init/")!.body);
    assert.equal(init.post_info.privacy_level, "PUBLIC_TO_EVERYONE");
    assert.deepEqual(init.source_info, { source: "FILE_UPLOAD", video_size: 300000, chunk_size: 300000, total_chunk_count: 1 });
    assert.equal(seen.find((s) => s.path === "/tiktok-upload/pub_1")!.headers["content-range"], "bytes 0-299999/300000");
    const rup = seen.find((s) => s.path === "/rupload/cont_1")!;
    assert.equal(rup.headers.authorization, "OAuth IGAAtesttokentesttokentest");
    assert.equal(rup.headers.file_size, "300000");
    assert.equal(rup.headers.offset, "0");

    // 7. Views come back; the campaign owes $2 per 1K past 10K views.
    assert.equal(await refreshStats(), 2);
    const s = snapshot();
    assert.equal(s.earnings.total.views, 37000);
    assert.equal(s.earnings.total.usd, 74);
    assert.equal(s.earnings.submit.length, 2);
    await act({ action: "post.update", id: tt.id, patch: { submitted: true, paid: 50 } });
    const after = snapshot();
    assert.equal(after.earnings.submit.length, 1);
    assert.equal(after.earnings.total.paid, 50);
    assert.ok(job, "the scanned job exists (it would run on the real pipeline)");
  } finally {
    server.close();
  }
});
