#!/usr/bin/env node
/**
 * Tells IndexNow search engines (Bing, and through it Copilot, DuckDuckGo and
 * ChatGPT search; also Yandex, Seznam, Naver) which pages the daily update just
 * changed, so they are re-crawled within hours instead of weeks. No account needed:
 * ownership is proven by the key file served at /<key>.txt.
 *
 * Usage (after the daily commit): SITE_URL=https://your-domain node scripts/indexnow.mjs [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const INDEXNOW_KEY = "e4efac27da960eaecc288d273b73c4a6";

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch {
    return "";
  }
};

/** URLs whose content changed between two commits of the data files. */
export function changedPaths(changedFiles, oldLocations, newLocations) {
  const paths = new Set();
  if (changedFiles.includes("data/news.json")) ["/", "/news"].forEach((p) => paths.add(p));
  if (changedFiles.includes("data/locations.json")) {
    const before = new Map(oldLocations.map((l) => [l.id, JSON.stringify(l)]));
    for (const loc of newLocations) {
      if (before.get(loc.id) === JSON.stringify(loc)) continue;
      ["/", "/map", `/locations/${loc.id}`].forEach((p) => paths.add(p));
      if (loc.region) paths.add(`/regions/${loc.region}`);
    }
  }
  if (changedFiles.includes("data/tips.json")) paths.add("/tips");
  return [...paths];
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const dryRun = process.argv.includes("--dry-run");
  if (!/^https:\/\//.test(site)) {
    console.log("[indexnow] SITE_URL not set; skipping");
    process.exit(0);
  }
  const files = git("diff", "--name-only", "HEAD~1", "HEAD").split("\n").filter(Boolean);
  const readAt = (rev) => {
    try {
      return JSON.parse(rev ? git("show", `${rev}:data/locations.json`) : readFileSync("data/locations.json", "utf8"));
    } catch {
      return [];
    }
  };
  const urls = changedPaths(files, readAt("HEAD~1"), readAt(null)).map((p) => `${site}${p === "/" ? "/" : p}`);
  if (!urls.length) {
    console.log("[indexnow] nothing changed; skipping");
    process.exit(0);
  }
  const body = { host: new URL(site).host, key: INDEXNOW_KEY, keyLocation: `${site}/${INDEXNOW_KEY}.txt`, urlList: urls };
  if (dryRun) {
    console.log(JSON.stringify(body, null, 2));
    process.exit(0);
  }
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  }).catch((err) => ({ ok: false, status: String(err.message) }));
  // 200/202 = accepted. 403 = key file not reachable yet (new deploy still going out).
  console.log(`[indexnow] ${urls.length} URL(s) -> ${res.status}`);
}
