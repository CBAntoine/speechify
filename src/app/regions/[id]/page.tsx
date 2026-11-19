import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORIES, LOCATIONS, REGIONS, regionById } from "@/lib/data";
import { ConfidenceBadge } from "@/components/Badges";
import MiniMap from "@/components/MiniMap";
import AdSlot from "@/components/AdSlot";
import { Icon } from "@/components/icons";
import { SITE } from "@/lib/site";

export function generateStaticParams() {
  return REGIONS.map((r) => ({ id: r.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = regionById(id);
  if (!r) return {};
  return {
    title: `${r.name} map, secrets & Easter eggs (GTA 6)`,
    description: `${r.tagline} Every confirmed, reported and theorised secret in ${r.name}, mapped.`,
    alternates: { canonical: `/regions/${r.id}` },
  };
}

export default async function RegionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const region = regionById(id);
  if (!region) notFound();
  const pins = LOCATIONS.filter((l) => l.region === region.id);

  return (
    <article className="page page--wide">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Map</Link> / <span>Regions</span> / <span>{region.name}</span>
      </nav>
      <p className="eyebrow" style={{ color: region.color }}>
        Region of Leonida
      </p>
      <h1 style={{ marginTop: 10 }}>{region.name}</h1>
      <p className="page__lede">{region.tagline}</p>
      <div className="page__grid">
        <div className="prose">
          {region.description.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
          <h2>
            {pins.length} {pins.length === 1 ? "pin" : "pins"} in {region.name}
          </h2>
          {pins.length === 0 ? (
            <p>
              Nothing charted here yet. It&apos;s launch week.{" "}
              <Link href="/#map">Pin a find</Link> and help map it.
            </p>
          ) : (
            <div className="loc-list">
              {pins.map((l) => (
                <Link key={l.id} href={`/locations/${l.id}`} className="loc-link">
                  <span className={`result__icon result__icon--${l.confidence}`} style={{ "--cc": CATEGORIES[l.category].color } as React.CSSProperties}>
                    <Icon name={l.category} size={18} />
                  </span>
                  <span className="result__text">
                    <span className="result__name">{l.name}</span>
                    <span className="result__meta">{CATEGORIES[l.category].label}</span>
                  </span>
                  <ConfidenceBadge value={l.confidence} />
                </Link>
              ))}
            </div>
          )}
          <h2>Other regions</h2>
          <p>
            {REGIONS.filter((r) => r.id !== region.id).map((r, i, arr) => (
              <span key={r.id}>
                <Link href={`/regions/${r.id}`}>{r.name}</Link>
                {i < arr.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
          <p className="fine">
            Sources:{" "}
            {region.sources.map((s, i) => (
              <span key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
                {i < region.sources.length - 1 ? "; " : ""}
              </span>
            ))}
          </p>
        </div>
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <MiniMap region={region} />
          <Link className="btn btn--sunset btn--block" href={`/?region=${region.id}#map`}>
            <Icon name="map" size={18} /> Explore {region.name} live
          </Link>
          <Link className="btn btn--ghost btn--block" href={`/?region=${region.id}&guide=1#map`}>
            <Icon name="mic" size={18} /> Ask {SITE.guideName}
          </Link>
          <AdSlot variant="sidebar" />
        </aside>
      </div>
    </article>
  );
}
