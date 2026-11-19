"use client";

import { useState } from "react";
import { CATEGORIES, gridRef } from "@/lib/data";
import { mapStore, useMapStore } from "@/lib/map-store";
import type { CategoryId } from "@/lib/types";
import { Icon } from "@/components/icons";

type State = "idle" | "sending" | "sent" | "error";

export default function SubmitFind() {
  const picking = useMapStore((s) => s.picking);
  const picked = useMapStore((s) => s.picked);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  if (picking) {
    return (
      <div className="pick-banner" role="status">
        <Icon name="pinPlus" size={18} />
        <span>Click the map where you found it</span>
        <button type="button" className="text-btn" onClick={() => mapStore.cancelPicking()}>
          Cancel
        </button>
      </div>
    );
  }
  if (!picked) return null;

  async function submit(form: HTMLFormElement) {
    setState("sending");
    setError("");
    const fd = new FormData(form);
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: fd.get("title"),
        category: fd.get("category"),
        description: fd.get("description"),
        source: fd.get("source"),
        credit: fd.get("credit"),
        website: fd.get("website"), // honeypot
        lng: picked!.lng,
        lat: picked!.lat,
      }),
    }).catch(() => null);
    if (res?.ok) {
      setState("sent");
    } else {
      const data = await res?.json().catch(() => null);
      setError(data?.message || "Couldn't send that. Please try again in a minute.");
      setState("error");
    }
  }

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="submit-title">
      <div className="modal">
        <header className="modal__head">
          <h2 id="submit-title">Pin a find</h2>
          <button type="button" className="icon-btn" onClick={() => mapStore.cancelPicking()} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>
        {state === "sent" ? (
          <div className="modal__body">
            <p className="modal__success">
              <Icon name="check" size={20} /> Thanks! We verify every submission before it goes live, usually within a day.
            </p>
            <button type="button" className="btn btn--ghost" onClick={() => mapStore.cancelPicking()}>
              Back to the map
            </button>
          </div>
        ) : (
          <form
            className="modal__body form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(e.currentTarget);
            }}
          >
            <p className="form__hint">
              Pinned at grid <strong>{gridRef(picked.lng, picked.lat)}</strong> ({picked.lat.toFixed(3)}, {picked.lng.toFixed(3)}). Drag the
              pin to fine-tune, or{" "}
              <button type="button" className="text-btn" onClick={() => mapStore.startPicking()}>
                pick again
              </button>
              .
            </p>
            <label>
              What did you find?
              <input name="title" required maxLength={90} placeholder="e.g. Hidden mural under the causeway" />
            </label>
            <label>
              Type
              <select name="category" defaultValue={"secret" satisfies CategoryId}>
                {(Object.keys(CATEGORIES) as CategoryId[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORIES[c].plural}
                  </option>
                ))}
              </select>
            </label>
            <label>
              How do you find or trigger it?
              <textarea name="description" required maxLength={1200} rows={4} placeholder="Time of day, mission, character, steps…" />
            </label>
            <label>
              Proof link (clip, screenshot, post), optional
              <input name="source" type="url" maxLength={300} placeholder="https://" />
            </label>
            <label>
              Credit me as (optional)
              <input name="credit" maxLength={40} placeholder="Your handle" />
            </label>
            <input name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            {state === "error" && <p className="form__error">{error}</p>}
            <button type="submit" className="btn btn--sunset" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Submit for verification"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
