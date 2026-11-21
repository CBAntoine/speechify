"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { REGIONS, formatPlace, parsePlace, regionByCode } from "@/lib/regions";

// Where to search: a province or state, then one of its main cities (or any
// other town, typed). "Somewhere else" takes free text for other countries.
// The value is a place string, "London, ON", which the server expands.

const OTHER_CITY = "__other";
const ELSEWHERE = "";
const DEFAULT_REGION = "ON";
const SAVED_KEY = "rm:place";

/** The last place searched on this device, if one was saved. */
export function loadSavedPlace(): string | null {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null;
  }
}

export function savePlace(place: string) {
  try {
    if (place.trim()) localStorage.setItem(SAVED_KEY, place.trim());
  } catch {
    // Private mode or storage blocked: the picker still works, it just won't remember.
  }
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
const CANADA = REGIONS.filter((r) => r.country === "CA").sort((a, b) => byName(a.name, b.name));
const USA = REGIONS.filter((r) => r.country === "US").sort((a, b) => byName(a.name, b.name));

interface Pick {
  region: string;
  city: string;
  /** Typing a town that isn't in the list. */
  typing: boolean;
}

function pickFrom(value: string): Pick {
  const { city, region } = parsePlace(value);
  if (region) return { region: region.code, city, typing: !region.cities.includes(city) };
  if (!value.trim()) {
    const r = regionByCode(DEFAULT_REGION)!;
    return { region: r.code, city: r.cities[0], typing: false };
  }
  return { region: ELSEWHERE, city: value.trim(), typing: true };
}

function toPlace(p: Pick): string {
  const r = regionByCode(p.region);
  return r ? formatPlace(p.city, r) : p.city.trim();
}

export function PlacePicker({
  value,
  onChange,
  labels = true,
  near = false,
  cityAction,
}: {
  value: string;
  onChange: (place: string) => void;
  /** Visible field labels (Find clients), or screen-reader labels only (Today). */
  labels?: boolean;
  /** Searching around the phone's location: shown instead of the city. */
  near?: boolean;
  /** A button next to the city, such as "near me". */
  cityAction?: ReactNode;
}) {
  const [pick, setPick] = useState(() => pickFrom(value));
  const emitted = useRef<string | null>(null);
  const id = useId();

  const emit = (next: Pick) => {
    setPick(next);
    const place = toPlace(next);
    emitted.current = place;
    onChange(place);
  };

  // A blank value shows the default city, so tell the parent it's chosen.
  // Later outside changes (a saved place restored) re-sync the picker.
  useEffect(() => {
    if (value === emitted.current) return;
    if (!value.trim()) emit(pickFrom(""));
    else setPick(pickFrom(value));
  }, [value]); // emit only touches state setters and the onChange of this render

  const region = regionByCode(pick.region);
  const cities = useMemo(() => (region ? [...region.cities].sort(byName) : []), [region]);

  const regionSelect = (
    <select
      className="select"
      value={pick.region}
      aria-label={labels ? undefined : "Province or state"}
      onChange={(e) => {
        const r = regionByCode(e.target.value);
        emit(r ? { region: r.code, city: r.cities[0], typing: false } : { region: ELSEWHERE, city: "", typing: true });
      }}
    >
      <optgroup label="Canada">
        {CANADA.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="United States">
        {USA.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </optgroup>
      <option value={ELSEWHERE}>Somewhere else…</option>
    </select>
  );

  const labelledBy = labels ? `${id}-city` : undefined;
  let cityControl: ReactNode;
  if (near) {
    cityControl = (
      <input
        className="input"
        value="Near me"
        readOnly
        onClick={() => emit(pick)}
        aria-labelledby={labelledBy}
        aria-label={labels ? undefined : "City"}
        title="Searching around where you are. Tap to pick a city instead."
      />
    );
  } else if (region && !pick.typing) {
    cityControl = (
      <select
        className="select"
        value={pick.city}
        aria-labelledby={labelledBy}
        aria-label={labels ? undefined : "City"}
        onChange={(e) => emit(e.target.value === OTHER_CITY ? { ...pick, city: "", typing: true } : { ...pick, city: e.target.value })}
      >
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={OTHER_CITY}>Other city or town…</option>
      </select>
    );
  } else {
    cityControl = (
      <>
        <input
          className="input"
          value={pick.city}
          onChange={(e) => emit({ ...pick, city: e.target.value })}
          placeholder={region ? `Town in ${region.name}` : "City, region, country"}
          list={region ? `${id}-cities` : undefined}
          enterKeyHint="search"
          autoComplete="off"
          required
          aria-labelledby={labelledBy}
          aria-label={labels ? undefined : region ? `Town in ${region.name}` : "City, region and country"}
        />
        {region && (
          <datalist id={`${id}-cities`}>
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  const cityRow = (
    <div className="place-city">
      {cityControl}
      {cityAction}
    </div>
  );

  if (!labels) {
    return (
      <>
        {regionSelect}
        {cityRow}
      </>
    );
  }
  return (
    <>
      <label className="field">
        <span>Province or state</span>
        {regionSelect}
      </label>
      <div className="field">
        <span className="place-city-head">
          <span id={`${id}-city`}>{region || near ? "City" : "City, region and country"}</span>
          {region && pick.typing && !near && (
            <button type="button" className="link-btn" onClick={() => emit({ ...pick, city: region.cities[0], typing: false })}>
              Pick from the list
            </button>
          )}
        </span>
        {cityRow}
      </div>
    </>
  );
}
