"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { sharePage } from "@/lib/share";

/** Share sheet on phones, copy-link elsewhere, with a moment of feedback. */
export default function ShareButton({
  path,
  title,
  text,
  className = "btn btn--ghost btn--sm",
}: {
  path: string;
  title: string;
  text?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const result = await sharePage(path, title, text);
        if (result === "copied" || result === "failed") {
          setState(result);
          window.setTimeout(() => setState("idle"), 1800);
        }
      }}
    >
      <Icon name="link" size={16} /> {state === "copied" ? "Link copied" : state === "failed" ? "Couldn't copy" : "Share"}
    </button>
  );
}
