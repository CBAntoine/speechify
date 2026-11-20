"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CATEGORIES,
  CONFIDENCE,
  LOCATIONS,
  NEWS,
  REGIONS,
  STATS,
  TIPS,
  gridRef,
  isPlaced,
  locationById,
  regionById,
  searchLocations,
} from "@/lib/data";
import { relativeDay } from "@/lib/format";
import { mapStore, useMapStore } from "@/lib/map-store";
import type { CategoryId, Confidence, MapLocation } from "@/lib/types";
import { CategoryBadge, ConfidenceBadge } from "@/components/Badges";
import { Icon } from "@/components/icons";
import { SITE } from "@/lib/site";

const PLACEMENT_LABEL: Record<MapLocation["placement"], string> = {
  exact: "Exact spot",
  approximate: "Search zone (approximate)",
  unplaced: "Not on the map yet",
};

function ask(text: string) {
  window.dispatchEvent(new CustomEvent("na:ask", { detail: { text } }));
}

export default function MapPanel({ headingLevel = 1 }: { headingLevel?: 1 | 2 }) {
  const selectedId = useMapStore((s) => s.selectedId);
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const sheetOpen = useMapStore((s) => s.sheetOpen);
  const loc = locationById(selectedId);
  const region = regionById(selectedRegion);

  return (
    <section className={`map-panel ${sheetOpen ? "is-open" : ""}`} data-map-panel aria-label="Map explorer">
      <button
        type="button"
        className="map-panel__grip"
        onClick={() => mapStore.setSheet(!sheetOpen)}
        aria-expanded={sheetOpen}
        aria-label={sheetOpen ? "Collapse panel" : "Expand panel"}
      >
        <span />
      </button>
      {loc ? <LocationDetail loc={loc} /> : region ? <RegionDetail id={region.id} /> : <ListView headingLevel={headingLevel} />}
    </section>
  );
}

function ListView({ headingLevel }: { headingLevel: 1 | 2 }) {
  const categories = useMapStore((s) => s.categories);
  const confidence = useMapStore((s) => s.confidence);
  const query = useMapStore((s) => s.query);
  const highlightIds = useMapStore((s) => s.highlightIds);
  const H = headingLevel === 1 ? "h1" : "h2";

  const results = useMemo(
    () => searchLocations({ query, categories, confidence }),
    [query, categories, confidence],
  );
  const placed = results.filter(isPlaced);
  const unplaced = results.filter((l) => !isPlaced(l));
  const counts = useMemo(() => {
    const c: Partial<Record<CategoryId, number>> = {};
    for (const l of LOCATIONS) c[l.category] = (c[l.category] ?? 0) + 1;
    return c;
  }, []);
  const filtered = categories.length > 0 || confidence !== "all" || query.trim() !== "";

  return (
    <div className="map-panel__inner">
      <header className="map-panel__head">
        <p className="eyebrow">
          <span className="live-dot" aria-hidden="true" /> Live map · updated {relativeDay(NEWS.updatedAt).toLowerCase()}
        </p>
        <H className="map-panel__title">
          The GTA 6 map <span className="grad-text">of secrets</span>
        </H>
        <p className="map-panel__sub">
          {STATS.placed} on the map · {STATS.unplaced} awaiting coordinates · {STATS.tips} tips. Ask {SITE.guideName} out loud,
          or dig in yourself.
        </p>
      </header>

      <label className="search">
        <Icon name="search" size={18} />
        <input
          type="search"
          value={query}
          onChange={(e) => mapStore.setFilters({ query: e.target.value })}
          placeholder="Search secrets, places, tips…"
          aria-label="Search the map"
          onFocus={() => mapStore.setSheet(true)}
        />
      </label>

      <div className="chips" role="group" aria-label="Filter by category">
        {(Object.keys(CATEGORIES) as CategoryId[])
          .filter((c) => counts[c])
          .map((c) => {
            const active = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={`chip ${active ? "is-active" : ""}`}
                style={{ "--cc": CATEGORIES[c].color } as React.CSSProperties}
                onClick={() => mapStore.toggleCategory(c)}
                aria-pressed={active}
              >
                <Icon name={c} size={14} strokeWidth={2} />
                {CATEGORIES[c].plural}
                <span className="chip__count">{counts[c]}</span>
              </button>
            );
          })}
      </div>

      <div className="segmented" role="radiogroup" aria-label="Filter by confidence">
        {(["all", "confirmed", "reported", "theory"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={confidence === c}
            className={confidence === c ? "is-active" : ""}
            onClick={() => mapStore.setFilters({ confidence: c as Confidence | "all" })}
            title={c === "all" ? "Show everything" : CONFIDENCE[c].help}
          >
            {c === "all" ? "All" : CONFIDENCE[c].short}
          </button>
        ))}
      </div>

      <div className="map-panel__scroll">
        {!filtered && (
          <div className="region-grid" aria-label="Jump to a region">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="region-chip"
                style={{ "--rc": r.color } as React.CSSProperties}
                onClick={() => mapStore.selectRegion(r.id)}
              >
                <span className="region-chip__name">{r.name.replace(" National Park", "")}</span>
                <span className="region-chip__count">
                  {LOCATIONS.filter((l) => l.region === r.id).length} pins
                </span>
              </button>
            ))}
          </div>
        )}

        {filtered && (
          <div className="results-head">
            <span>
              {results.length} {results.length === 1 ? "result" : "results"}
            </span>
            <button type="button" className="text-btn" onClick={() => mapStore.resetFilters()}>
              Clear filters
            </button>
          </div>
        )}

        <ul className="result-list">
          {placed.map((l) => (
            <ResultRow key={l.id} loc={l} highlighted={highlightIds.includes(l.id)} />
          ))}
        </ul>

        {unplaced.length > 0 && (
          <>
            <h3 className="list-heading">Found, not yet on the map</h3>
            <ul className="result-list">
              {unplaced.map((l) => (
                <ResultRow key={l.id} loc={l} highlighted={false} />
              ))}
            </ul>
          </>
        )}

        {results.length === 0 && (
          <p className="empty">
            Nothing matches yet. It&apos;s launch week, and new finds land daily. Know one?{" "}
            <button type="button" className="text-btn" onClick={() => mapStore.startPicking()}>
              Pin it
            </button>
            .
          </p>
        )}

        <div className="pin-cta">
          <div>
            <strong>Found something?</strong>
            <span>Drop a pin. Verified finds go live with your name.</span>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => mapStore.startPicking()}>
            <Icon name="pinPlus" size={16} /> Pin a find
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ loc, highlighted }: { loc: MapLocation; highlighted: boolean }) {
  const cat = CATEGORIES[loc.category];
  const region = regionById(loc.region);
  return (
    <li>
      <button
        type="button"
        className={`result ${highlighted ? "is-highlight" : ""}`}
        onClick={() => mapStore.selectLocation(loc.id)}
        style={{ "--cc": cat.color } as React.CSSProperties}
      >
        <span className={`result__icon result__icon--${loc.confidence}`}>
          <Icon name={loc.category} size={18} strokeWidth={1.9} />
        </span>
        <span className="result__text">
          <span className="result__name">{loc.name}</span>
          <span className="result__meta">
            {region ? region.name : "Location TBC"}
            {isPlaced(loc) && <> · {gridRef(loc.lng, loc.lat)}</>}
          </span>
        </span>
        <ConfidenceBadge value={loc.confidence} />
      </button>
    </li>
  );
}

function LocationDetail({ loc }: { loc: MapLocation }) {
  const [revealed, setRevealed] = useState(!loc.spoiler);
  const [copied, setCopied] = useState(false);
  const region = regionById(loc.region);
  const tips = TIPS.filter((t) => t.locationId === loc.id);

  return (
    <div className="map-panel__inner">
      <div className="detail__top">
        <button type="button" className="back-btn" onClick={() => mapStore.back()}>
          <Icon name="back" size={16} /> All finds
        </button>
      </div>
      <div className="map-panel__scroll detail">
        <div className="detail__badges">
          <CategoryBadge value={loc.category} />
          <ConfidenceBadge value={loc.confidence} withHelp />
        </div>
        <h2 className="detail__title">{loc.name}</h2>
        <p className="detail__where">
          {region ? (
            <button type="button" className="text-btn" onClick={() => mapStore.selectRegion(region.id)}>
              {region.name}
            </button>
          ) : (
            "Region TBC"
          )}
          {isPlaced(loc) && <> · Grid {gridRef(loc.lng, loc.lat)}</>} · {PLACEMENT_LABEL[loc.placement]}
        </p>
        {loc.area && <p className="detail__area">{loc.area}</p>}

        <div className={`detail__body ${revealed ? "" : "is-spoiler"}`}>
          <p className="detail__summary">{loc.summary}</p>
          {loc.details.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
          {loc.steps && loc.steps.length > 0 && (
            <>
              <h3 className="list-heading">How to find it</h3>
              <ol className="steps">
                {loc.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          {loc.requirements && loc.requirements.length > 0 && (
            <div className="reqs">
              {loc.requirements.map((r) => (
                <span key={r} className="req">
                  {r}
                </span>
              ))}
            </div>
          )}
          {!revealed && (
            <button type="button" className="spoiler-btn" onClick={() => setRevealed(true)}>
              Story spoiler. Tap to reveal.
            </button>
          )}
        </div>

        {tips.length > 0 && (
          <>
            <h3 className="list-heading">Tips for this spot</h3>
            <ul className="mini-tips">
              {tips.map((t) => (
                <li key={t.id}>
                  <strong>{t.title}.</strong> {t.body}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="detail__actions">
          <button type="button" className="btn btn--sunset btn--sm" onClick={() => ask(`Tell me about ${loc.name}.`)}>
            <Icon name="mic" size={16} /> Ask {SITE.guideName}
          </button>
          <Link className="btn btn--ghost btn--sm" href={`/locations/${loc.id}`}>
            Full guide
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const url = `${window.location.origin}/?loc=${loc.id}#map`;
              void navigator.clipboard?.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            <Icon name="link" size={16} /> {copied ? "Copied" : "Share"}
          </button>
        </div>

        {loc.sources.length > 0 ? (
          <div className="sources">
            <h3 className="list-heading">Sources</h3>
            <ul>
              {loc.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.label}
                    <Icon name="external" size={13} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="detail__note">
            No source yet. This is a theory based on series history and the map&apos;s geography.
          </p>
        )}
        <p className="detail__note">{CONFIDENCE[loc.confidence].help}</p>
      </div>
    </div>
  );
}

function RegionDetail({ id }: { id: NonNullable<MapLocation["region"]> }) {
  const region = regionById(id)!;
  const pins = LOCATIONS.filter((l) => l.region === id);
  return (
    <div className="map-panel__inner">
      <div className="detail__top">
        <button type="button" className="back-btn" onClick={() => mapStore.back()}>
          <Icon name="back" size={16} /> All regions
        </button>
      </div>
      <div className="map-panel__scroll detail">
        <p className="eyebrow" style={{ color: region.color }}>
          Region · {region.short}
        </p>
        <h2 className="detail__title">{region.name}</h2>
        <p className="detail__summary">{region.tagline}</p>
        {region.description.map((d, i) => (
          <p key={i}>{d}</p>
        ))}
        <h3 className="list-heading">
          {pins.length} {pins.length === 1 ? "pin" : "pins"} here
        </h3>
        <ul className="result-list">
          {pins.map((l) => (
            <ResultRow key={l.id} loc={l} highlighted={false} />
          ))}
        </ul>
        <div className="detail__actions">
          <button
            type="button"
            className="btn btn--sunset btn--sm"
            onClick={() => ask(`What should I know about ${region.name}?`)}
          >
            <Icon name="mic" size={16} /> Ask {SITE.guideName}
          </button>
          <Link className="btn btn--ghost btn--sm" href={`/regions/${region.id}`}>
            Region guide
          </Link>
        </div>
        <div className="sources">
          <h3 className="list-heading">Sources</h3>
          <ul>
            {region.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                  <Icon name="external" size={13} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
