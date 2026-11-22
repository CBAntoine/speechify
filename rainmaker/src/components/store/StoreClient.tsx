"use client";

import { useEffect, type ReactNode } from "react";
import { useToast } from "@/components/client";
import type { StoreView } from "@/lib/store-view";
import { Assistant } from "./Assistant";
import { StoreCtx } from "./bus";
import { Checkout } from "./Checkout";

// The store's client root: shares the store data with buttons, the checkout
// sheet and the sales assistant. The assistant lives here, in the layout, so
// a conversation keeps going while the visitor moves between store pages.

export function StoreClient({ view, children }: { view: StoreView; children: ReactNode }) {
  const toast = useToast();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const lead = q.get("lead");
    if (lead && /^lead_[a-z0-9]+$/.test(lead)) {
      try {
        sessionStorage.setItem("rm_lead", lead);
      } catch {
        /* private mode: the checkout still works, without the lead link */
      }
    }
    if (q.get("canceled")) toast("Checkout cancelled. Nothing was charged.");
  }, [toast]);

  return (
    <StoreCtx.Provider value={view}>
      {children}
      <Checkout />
      {view.assistant && <Assistant variant="dock" />}
    </StoreCtx.Provider>
  );
}
