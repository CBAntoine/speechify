import { CATEGORIES, CONFIDENCE, gridRef, locationById, regionById } from "@/lib/data";
import { formatDistance, haversineM } from "@/lib/geo-utils";
import type { MapLocation, Region } from "@/lib/types";
import type { PlaceFocus, RouteEnd } from "@/lib/map-store";

/** Popup markup is built from our data and geocoder answers: escape everything. */
export const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const KIND_LABEL: Record<string, string> = {
  residential: "Street",
  primary: "Street",
  secondary: "Street",
  tertiary: "Street",
  trunk: "Highway",
  motorway: "Highway",
  pedestrian: "Street",
  neighbourhood: "Neighbourhood",
  suburb: "Neighbourhood",
  quarter: "Neighbourhood",
  city: "City",
  town: "Town",
  village: "Village",
  beach: "Beach",
  park: "Park",
  island: "Island",
  aerodrome: "Airport",
  stadium: "Stadium",
  museum: "Museum",
  attraction: "Landmark",
  hotel: "Hotel",
};

function routeButton(from: RouteEnd | null | undefined, to: { lng: number; lat: number }) {
  if (!from || haversineM([from.lng, from.lat], [to.lng, to.lat]) < 60) return "";
  return `<button type="button" class="pop__btn" data-act="route">Route from ${esc(from.name)}</button>`;
}

export function locationPopup(loc: MapLocation & { lng: number; lat: number }, opts: { narrow: boolean; from?: RouteEnd | null }) {
  const cat = CATEGORIES[loc.category];
  const conf = CONFIDENCE[loc.confidence];
  const region = regionById(loc.region);
  const grid = gridRef(loc.lng, loc.lat);
  const steps = !opts.narrow && !loc.spoiler ? (loc.steps ?? []).slice(0, 3) : [];
  const where =
    loc.placement === "approximate" && loc.radiusKm
      ? `Search zone ≈ ${formatDistance(loc.radiusKm * 2000)} across`
      : "Marked spot";
  return `<div class="pop${opts.narrow ? " pop--narrow" : ""}" style="--c:${cat.color}">
  <div class="pop__meta"><span class="pop__cat">${esc(cat.label)}</span><span class="pop__conf" style="--cc:${conf.color}" title="${esc(conf.help)}">${esc(conf.label)}</span></div>
  <h3 class="pop__title">${esc(loc.name)}</h3>
  <p class="pop__text">${esc(loc.summary)}</p>
  ${steps.length ? `<p class="pop__sub">How to find it</p><ol class="pop__steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
  ${loc.spoiler ? '<p class="pop__note">Story spoiler: open the full guide to read the steps.</p>' : ""}
  <p class="pop__note">${esc([where, region?.name, grid ? `Grid ${grid}` : null].filter(Boolean).join(" · "))}</p>
  <div class="pop__actions"><button type="button" class="pop__btn pop__btn--primary" data-act="guide">Full guide</button><button type="button" class="pop__btn" data-act="share">Share</button>${routeButton(opts.from, loc)}</div>
</div>`;
}

export function placePopup(place: PlaceFocus, opts: { narrow: boolean; from?: RouteEnd | null }) {
  const region = regionById(place.region);
  const kind = KIND_LABEL[place.kind] ?? "Place";
  const nearby = place.nearby
    .map((id) => locationById(id))
    .filter((l): l is MapLocation & { lng: number; lat: number } => !!l && l.lng != null && l.lat != null)
    .slice(0, opts.narrow ? 0 : 3);
  return `<div class="pop${opts.narrow ? " pop--narrow" : ""}" style="--c:#4db2ff">
  <div class="pop__meta"><span class="pop__cat">${esc(kind)}</span>${region ? `<span class="pop__conf" style="--cc:${region.color}">${esc(region.name)}</span>` : ""}</div>
  <h3 class="pop__title">${esc(place.name)}</h3>
  <p class="pop__text">${esc(place.label)}. A real-world ${esc(kind.toLowerCase())} on the stand-in map${region ? `, inside the ${esc(region.name)} region` : ""}. The in-game layout differs.</p>
  ${
    nearby.length
      ? `<p class="pop__sub">Pins nearby</p><ul class="pop__list">${nearby
          .map(
            (l) =>
              `<li><button type="button" class="pop__link" data-act="pin" data-id="${esc(l.id)}">${esc(l.name)}</button><span>${formatDistance(haversineM([place.lng, place.lat], [l.lng, l.lat]))}</span></li>`,
          )
          .join("")}</ul>`
      : ""
  }
  <div class="pop__actions">${routeButton(opts.from, place)}</div>
</div>`;
}

export function regionPopup(region: Region, pins: MapLocation[], opts: { narrow: boolean }) {
  const top = pins.slice(0, opts.narrow ? 2 : 4);
  return `<div class="pop${opts.narrow ? " pop--narrow" : ""}" style="--c:${region.color}">
  <div class="pop__meta"><span class="pop__cat">Region</span><span class="pop__conf" style="--cc:${region.color}">${pins.length} ${pins.length === 1 ? "pin" : "pins"}</span></div>
  <h3 class="pop__title">${esc(region.name)}</h3>
  <p class="pop__text">${esc(region.tagline)}</p>
  ${
    top.length
      ? `<ul class="pop__list">${top
          .map((l) => `<li><button type="button" class="pop__link" data-act="pin" data-id="${esc(l.id)}">${esc(l.name)}</button><span>${esc(CONFIDENCE[l.confidence].label)}</span></li>`)
          .join("")}</ul>`
      : ""
  }
  <div class="pop__actions"><button type="button" class="pop__btn pop__btn--primary" data-act="guide">Region guide</button></div>
</div>`;
}
