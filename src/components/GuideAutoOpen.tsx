"use client";

import { useEffect } from "react";
import { mapStore } from "@/lib/map-store";

/** /?guide=1 (from "Ask Sol" on other pages) opens the voice panel on arrival. */
export default function GuideAutoOpen() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("guide") === "1") {
      mapStore.setVoiceOpen(true);
      url.searchParams.delete("guide");
      window.history.replaceState(null, "", url);
    }
  }, []);
  return null;
}
