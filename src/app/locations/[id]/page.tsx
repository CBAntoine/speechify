import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORIES, CONFIDENCE, LOCATIONS, TIPS, gridRef, isPlaced, locationById, regionById } from "@/lib/data";
import { CategoryBadge, ConfidenceBadge } from "@/components/Badges";
import MiniMap from "@/components/MiniMap";
import AdSlot from "@/components/AdSlot";
import { Icon } from "@/components/icons";
import { TipCard } from "@/components/sections";
import { SITE } from "@/lib/site";

export function generateStaticParams() {
  return LOCATIONS.map((l) => ({ id: l.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const loc = locationById(id);
  if (!loc) return {};
  const region = regionById(loc.region);
  const title = `${loc.name}: GTA 6 ${CATEGORIES[loc.category].label} Location${region ? ` in ${region.name}` : ""} & How to Find It`;
  return {
    title,
    description: loc.summary,
    alternates: { canonical: `/locations/${loc.id}` },
    openGraph: { title, description: loc.summary, type: "article" },
  };
}

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loc = locationById(id);
  if (!loc) notFound();
  const region = regionById(loc.region);
  const tips = TIPS.filter((t) => t.locationId === loc.id);
  const related = LOCATIONS.filter((l) => l.id !== loc.id && (l.region === loc.region || l.category === loc.category)).slice(0, 4);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to find ${loc.name} in GTA 6`,
    description: loc.summary,
    step: (loc.steps ?? []).map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s })),
  };

  return (
    <article className="page page--wide">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link> / {region ? <Link href={`/regions/${region.id}`}>{region.name}</Link> : "Unplaced"} /{" "}
        <span>{loc.name}</span>
      </nav>
      <div className="detail__badges">
        <CategoryBadge value={loc.category} />
        <ConfidenceBadge value={loc.confidence} withHelp />
        {loc.spoiler && <span className="badge">Story spoiler</span>}
      </div>
      <h1 style={{ marginTop: 14 }}>{loc.name}</h1>
      <p className="page__lede">{loc.summary}</p>

      <div className="page__grid">
        <div className="prose">
          {loc.area && (
            <p>
              <strong>Where:</strong> {loc.area}
              {isPlaced(loc) && <> · grid {gridRef(loc.lng, loc.lat)} on our map</>}
              {loc.placement === "approximate" && " (search zone, approximate)"}
            </p>
          )}
          {loc.details.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
          {loc.steps && loc.steps.length > 0 && (
            <>
              <h2>How to find it</h2>
              <ol>
                {loc.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          {loc.requirements && loc.requirements.length > 0 && (
            <>
              <h2>Requirements</h2>
              <ul>
                {loc.requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <h2>How sure are we?</h2>
          <p>
            <strong>{CONFIDENCE[loc.confidence].label}.</strong> {CONFIDENCE[loc.confidence].help}
          </p>
          {loc.sources.length > 0 && (
            <ul>
              {loc.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.label}
                  </a>
                  {s.date ? ` (${s.date})` : ""}
                </li>
              ))}
            </ul>
          )}
          {tips.length > 0 && (
            <>
              <h2>Tips for this spot</h2>
              <div className="tips-grid" style={{ gridTemplateColumns: "1fr" }}>
                {tips.map((t) => (
                  <TipCard key={t.id} tip={t} />
                ))}
              </div>
            </>
          )}
        </div>
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {isPlaced(loc) || region ? <MiniMap loc={loc} region={!isPlaced(loc) ? region : undefined} /> : null}
          <Link className="btn btn--sunset btn--block" href={`/?loc=${loc.id}#map`}>
            <Icon name="map" size={18} /> Open on the live map
          </Link>
          <Link className="btn btn--ghost btn--block" href={`/?loc=${loc.id}&guide=1#map`}>
            <Icon name="mic" size={18} /> Ask {SITE.guideName} about it
          </Link>
          <AdSlot variant="sidebar" />
          {related.length > 0 && (
            <div className="card">
              <h2 style={{ fontSize: 16 }}>Nearby &amp; related</h2>
              {related.map((r) => (
                <Link key={r.id} href={`/locations/${r.id}`} className="text-btn">
                  {r.name}
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </article>
  );
}
