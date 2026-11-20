import { NextResponse } from "next/server";
import { CATEGORIES, GEO, gridRef } from "@/lib/data";
import type { CategoryId } from "@/lib/types";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

/**
 * Community "Pin a find" submissions become GitHub issues labelled `submission`.
 * A curator reviews them, edits the JSON block if needed and adds the `approved`
 * label; the daily workflow then publishes them to data/locations.json.
 */
export async function POST(req: Request) {
  if (!rateLimit(`submit:${clientIp(req)}`, 6, 60 * 60_000)) {
    return NextResponse.json({ ok: false, message: "Thanks for the enthusiasm! Try again in a bit." }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.website) return NextResponse.json({ ok: true }); // honeypot

  const title = clean(b.title, 90);
  const description = clean(b.description, 1200);
  const source = clean(b.source, 300);
  const credit = clean(b.credit, 40);
  const category = (Object.keys(CATEGORIES) as CategoryId[]).includes(b.category as CategoryId)
    ? (b.category as CategoryId)
    : "secret";
  const lng = Math.round(Number(b.lng) * 1e4) / 1e4;
  const lat = Math.round(Number(b.lat) * 1e4) / 1e4;
  const [west, south, east, north] = GEO.bbox;
  if (title.length < 4 || description.length < 10 || !(lng >= west && lng <= east && lat >= south && lat <= north)) {
    return NextResponse.json({ ok: false, message: "Add a title, a short description, and a pin on the map." }, { status: 400 });
  }
  if (source && !/^https?:\/\//i.test(source)) {
    return NextResponse.json({ ok: false, message: "The proof link should start with http(s)://" }, { status: 400 });
  }

  const token = process.env.GITHUB_SUBMISSIONS_TOKEN;
  const repo = process.env.GITHUB_SUBMISSIONS_REPO;
  if (!token || !repo) {
    return NextResponse.json({ ok: false, message: "Submissions open soon. Thanks for your patience!" }, { status: 503 });
  }

  const proposal = {
    name: title,
    category,
    confidence: "reported",
    placement: "approximate",
    lng,
    lat,
    radiusKm: 3,
    summary: description.slice(0, 220),
    details: [description],
    sources: source ? [{ label: "Community submission", url: source }] : [],
    credit: credit || undefined,
  };
  const body = [
    `**Category:** ${CATEGORIES[category].plural}  `,
    `**Grid:** ${gridRef(lng, lat)} (lat ${lat}, lng ${lng})  `,
    credit ? `**Credit:** ${credit}  ` : "",
    source ? `**Proof:** ${source}` : "**Proof:** none provided",
    "",
    "### Description",
    description,
    "",
    "### Proposed pin (edit before approving)",
    "```json",
    JSON.stringify(proposal, null, 2),
    "```",
    "",
    "_Add the `approved` label to publish this pin in the next daily update._",
  ]
    .filter(Boolean)
    .join("\n");

  const create = (labels?: string[]) =>
    fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gta6-secrets-map-submissions",
      },
      body: JSON.stringify({ title: `[Find] ${title}`, body, ...(labels ? { labels } : {}) }),
    });

  let res = await create(["submission"]).catch(() => null);
  if (res && res.status === 422) res = await create().catch(() => null);
  if (!res?.ok) {
    console.error("[submit] GitHub issue failed", res?.status, await res?.text().catch(() => ""));
    return NextResponse.json({ ok: false, message: "Couldn't save that right now. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
