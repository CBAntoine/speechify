#!/usr/bin/env node
/**
 * Publishes community "Pin a find" submissions a curator has approved.
 * Flow: the site files a GitHub issue labelled `submission` → a human edits the
 * JSON block if needed and adds the `approved` label → this script (daily, in
 * GitHub Actions) appends the pin to data/locations.json, comments, and closes it.
 *
 * Needs GITHUB_TOKEN and GITHUB_REPOSITORY (both provided by GitHub Actions).
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSubmission, slugify } from "./lib/intel.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) {
  console.log("[submissions] GITHUB_TOKEN/GITHUB_REPOSITORY not set; skipping");
  process.exit(0);
}
const gh = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "neon-atlas-curator",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });

const CATEGORIES = new Set(["easter-egg", "secret", "collectible", "wildlife", "story", "service", "tip"]);
const CONFIDENCE = new Set(["confirmed", "reported", "theory"]);

const res = await gh("/issues?state=open&labels=approved&per_page=50");
if (!res.ok) {
  console.warn(`[submissions] could not list issues: ${res.status}`);
  process.exit(0);
}
const issues = (await res.json()).filter((i) => !i.pull_request);
const file = resolve(root, "data/locations.json");
const locations = JSON.parse(await readFile(file, "utf8"));
const ids = new Set(locations.map((l) => l.id));
const today = new Date().toISOString().slice(0, 10);
let added = 0;

for (const issue of issues) {
  const p = parseSubmission(issue.body);
  if (!p) {
    await gh(`/issues/${issue.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Couldn't read the JSON block in this issue. Fix it and keep the `approved` label to retry tomorrow." }),
    });
    continue;
  }
  let id = slugify(p.id || p.name) || `find-${issue.number}`;
  while (ids.has(id)) id = `${id}-${issue.number}`;
  ids.add(id);
  const credit = typeof p.credit === "string" && p.credit.trim() ? p.credit.trim().slice(0, 40) : null;
  locations.push({
    id,
    name: String(p.name).slice(0, 90),
    category: CATEGORIES.has(p.category) ? p.category : "secret",
    region: typeof p.region === "string" ? p.region : null,
    confidence: CONFIDENCE.has(p.confidence) ? p.confidence : "reported",
    placement: p.placement === "exact" ? "exact" : "approximate",
    lng: Math.round(p.lng * 1e4) / 1e4,
    lat: Math.round(p.lat * 1e4) / 1e4,
    radiusKm: typeof p.radiusKm === "number" ? p.radiusKm : 3,
    area: typeof p.area === "string" ? p.area : undefined,
    summary: String(p.summary ?? "").slice(0, 240),
    details: Array.isArray(p.details) ? p.details.map(String) : [],
    steps: Array.isArray(p.steps) ? p.steps.map(String) : undefined,
    tags: credit ? [`found by ${credit}`] : undefined,
    sources: Array.isArray(p.sources) ? p.sources.filter((s) => /^https?:\/\//.test(s?.url ?? "")) : [],
    addedAt: today,
  });
  added++;
  await gh(`/issues/${issue.number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: `Published as \`${id}\` in today's update. Thanks${credit ? `, ${credit}` : ""}!` }),
  });
  await gh(`/issues/${issue.number}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
}

if (added) await writeFile(file, JSON.stringify(locations, null, 2) + "\n");
console.log(`[submissions] published ${added} pin(s)`);
