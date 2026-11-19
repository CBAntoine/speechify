"use client";

import { useSyncExternalStore } from "react";
import type { CategoryId, Confidence, RegionId } from "./types";

export type FlyRequest =
  | { kind: "location"; id: string; nonce: number }
  | { kind: "region"; id: RegionId; nonce: number }
  | { kind: "fit"; ids: string[]; nonce: number }
  | { kind: "home"; nonce: number };

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
};

let state: MapState = initial;
const listeners = new Set<() => void>();
let nonce = 0;

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
      sheetOpen: id ? true : state.sheetOpen,
      fly: id && opts.fly !== false ? { kind: "location", id, nonce: ++nonce } : state.fly,
    });
  },
  selectRegion(id: RegionId | null, opts: { fly?: boolean } = {}) {
    set({
      selectedRegion: id,
      selectedId: null,
      sheetOpen: id ? true : state.sheetOpen,
      fly: id && opts.fly !== false ? { kind: "region", id, nonce: ++nonce } : state.fly,
    });
  },
  back() {
    set({ selectedId: null, selectedRegion: null });
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
