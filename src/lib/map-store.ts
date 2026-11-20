"use client";

import { useSyncExternalStore } from "react";
import type { CategoryId, Confidence, RegionId } from "./types";
import type { LngLat, RouteResult } from "./geo-utils";

export type FlyRequest =
  | { kind: "location"; id: string; nonce: number }
  | { kind: "region"; id: RegionId; nonce: number }
  | { kind: "fit"; ids: string[]; nonce: number }
  | { kind: "home"; nonce: number }
  | { kind: "place"; nonce: number }
  | { kind: "route"; nonce: number }
  | { kind: "point"; center: LngLat; zoom: number; nonce: number };

/** A spot that isn't a pin: a real-world street, landmark or neighbourhood. */
export interface PlaceFocus {
  name: string;
  label: string;
  lng: number;
  lat: number;
  kind: string;
  bbox: [number, number, number, number] | null;
  region: RegionId | null;
  /** Nearby pins (ids), closest first. */
  nearby: string[];
}

export interface RouteEnd {
  name: string;
  lng: number;
  lat: number;
  locationId?: string;
}

export interface RouteState extends RouteResult {
  from: RouteEnd;
  to: RouteEnd;
}

export interface MapState {
  selectedId: string | null;
  selectedRegion: RegionId | null;
  categories: CategoryId[]; // empty = all
  confidence: Confidence | "all";
  query: string;
  /** Ids the voice guide just surfaced; drawn with an extra halo. */
  highlightIds: string[];
  fly: FlyRequest | null;
  /** "Pin a find" mode: next map click drops a submission marker. */
  picking: boolean;
  picked: { lng: number; lat: number } | null;
  sheetOpen: boolean;
  voiceOpen: boolean;
  /** 3D tilt of the camera. */
  pitched: boolean;
  /** Street/landmark the guide or search flew to (shows a popup). */
  place: PlaceFocus | null;
  route: RouteState | null;
  /** Bumped to reopen the popup for the current selection after it was closed. */
  popupNonce: number;
}

const initial: MapState = {
  selectedId: null,
  selectedRegion: null,
  categories: [],
  confidence: "all",
  query: "",
  highlightIds: [],
  fly: null,
  picking: false,
  picked: null,
  sheetOpen: false,
  voiceOpen: false,
  pitched: false,
  place: null,
  route: null,
  popupNonce: 0,
};

let state: MapState = initial;
/** Phones: a selected pin shows its popup and the sheet stays as it was (the popup links to the full guide). */
const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
const listeners = new Set<() => void>();
let nonce = 0;
/** Camera centre, kept outside the store so panning doesn't re-render anything. */
let view: { center: LngLat; zoom: number } = { center: [-81.2, 27.4], zoom: 6 };

function set(patch: Partial<MapState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const mapStore = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  selectLocation(id: string | null, opts: { fly?: boolean } = {}) {
    set({
      selectedId: id,
      selectedRegion: null,
      place: id ? null : state.place,
      popupNonce: ++nonce,
      sheetOpen: id && !isNarrow() ? true : state.sheetOpen,
      fly: id && opts.fly !== false ? { kind: "location", id, nonce: ++nonce } : state.fly,
    });
  },
  selectRegion(id: RegionId | null, opts: { fly?: boolean } = {}) {
    set({
      selectedRegion: id,
      selectedId: null,
      place: id ? null : state.place,
      sheetOpen: id ? true : state.sheetOpen,
      fly: id && opts.fly !== false ? { kind: "region", id, nonce: ++nonce } : state.fly,
    });
  },
  back() {
    set({ selectedId: null, selectedRegion: null, place: null });
  },
  focusPlace(place: PlaceFocus, opts: { fly?: boolean } = {}) {
    set({
      place,
      selectedId: null,
      selectedRegion: null,
      popupNonce: ++nonce,
      fly: opts.fly !== false ? { kind: "place", nonce: ++nonce } : state.fly,
    });
  },
  flyTo(center: LngLat, zoom: number) {
    set({ fly: { kind: "point", center, zoom, nonce: ++nonce } });
  },
  clearPlace() {
    set({ place: null });
  },
  setRoute(route: RouteState) {
    set({ route, fly: { kind: "route", nonce: ++nonce } });
  },
  clearRoute() {
    set({ route: null });
  },
  view: () => view,
  setView(v: { center: LngLat; zoom: number }) {
    view = v;
  },
  toggleCategory(id: CategoryId) {
    const has = state.categories.includes(id);
    set({ categories: has ? state.categories.filter((c) => c !== id) : [...state.categories, id] });
  },
  setFilters(patch: Partial<Pick<MapState, "categories" | "confidence" | "query">>) {
    set(patch);
  },
  resetFilters() {
    set({ categories: [], confidence: "all", query: "", highlightIds: [] });
  },
  highlight(ids: string[], opts: { fit?: boolean } = {}) {
    set({ highlightIds: ids, fly: opts.fit && ids.length ? { kind: "fit", ids, nonce: ++nonce } : state.fly });
  },
  home() {
    set({ fly: { kind: "home", nonce: ++nonce } });
  },
  togglePitch() {
    set({ pitched: !state.pitched });
  },
  startPicking() {
    set({ picking: true, picked: null, sheetOpen: false });
  },
  pick(point: { lng: number; lat: number } | null) {
    set({ picking: false, picked: point });
  },
  cancelPicking() {
    set({ picking: false, picked: null });
  },
  setSheet(open: boolean) {
    set({ sheetOpen: open });
  },
  setVoiceOpen(open: boolean) {
    set({ voiceOpen: open });
  },
};

export function useMapStore<T>(selector: (s: MapState) => T): T {
  return useSyncExternalStore(
    mapStore.subscribe,
    () => selector(state),
    () => selector(initial),
  );
}
