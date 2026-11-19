"use client";

import { usePathname, useRouter } from "next/navigation";
import { mapStore } from "@/lib/map-store";
import { SITE } from "@/lib/site";
import { Icon } from "./icons";

/** Opens the voice guide on map pages; elsewhere jumps to the map with the guide open. */
export default function AskButton() {
  const pathname = usePathname();
  const router = useRouter();
  const onMap = pathname === "/" || pathname === "/map";
  return (
    <button
      type="button"
      className="btn btn--sunset btn--sm ask-btn"
      onClick={() => {
        if (onMap) {
          mapStore.setVoiceOpen(true);
          document.getElementById("map")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          router.push("/?guide=1#map");
        }
      }}
    >
      <Icon name="mic" size={16} /> Ask {SITE.guideName}
    </button>
  );
}
