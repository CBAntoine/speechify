"use client";

import { useState } from "react";
import { Icon } from "./icons";

export default function NewsletterForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  return (
    <form
      className="newsletter"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setState("sending");
        const res = await fetch("/api/newsletter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: fd.get("email"), website: fd.get("website") }),
        }).catch(() => null);
        const data = await res?.json().catch(() => null);
        setMessage(data?.message || (res?.ok ? "You're in." : "Something went wrong. Try again."));
        setState(res?.ok ? "done" : "error");
      }}
    >
      <label className="sr-only" htmlFor="nl-email">
        Email address
      </label>
      <div className="newsletter__row">
        <Icon name="mail" size={18} />
        <input id="nl-email" name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
        <input name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <button type="submit" className="btn btn--sunset" disabled={state === "sending" || state === "done"}>
          {state === "sending" ? "Joining…" : state === "done" ? "Subscribed" : "Get the daily brief"}
        </button>
      </div>
      <p className={`newsletter__msg ${state}`} role="status">
        {message || "One email a day with new secrets, tips and news. Unsubscribe in one click."}
      </p>
    </form>
  );
}
