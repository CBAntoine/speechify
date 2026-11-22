"use client";

import { createContext, useContext } from "react";
import type { OfferView, StoreView } from "@/lib/store-view";

// Shared by the store's client pieces: the store data, and window events so
// any button (or the sales assistant) can open the checkout or the assistant.

export const StoreCtx = createContext<StoreView | null>(null);

export function useStore(): StoreView {
  const v = useContext(StoreCtx);
  if (!v) throw new Error("useStore must be used inside <StoreClient>");
  return v;
}

export function useStoreOptional(): StoreView | null {
  return useContext(StoreCtx);
}

export type AssistantRequest = { mode?: "voice" | "text"; ask?: string };
export type CheckoutRequest = { offerId: string; interval?: "month" | "year" };

export function openAssistant(detail: AssistantRequest) {
  window.dispatchEvent(new CustomEvent<AssistantRequest>("rm:assistant", { detail }));
}

export function openCheckout(detail: CheckoutRequest) {
  window.dispatchEvent(new CustomEvent<CheckoutRequest>("rm:checkout", { detail }));
}

export function findOffer(v: StoreView, idOrSlug: string | undefined): OfferView | undefined {
  if (!idOrSlug) return undefined;
  const k = idOrSlug.trim().toLowerCase();
  return [...v.plans, ...v.products].find((o) => o.id === k || o.slug === k || o.name.toLowerCase() === k);
}

export function storedLeadId(): string | undefined {
  try {
    return sessionStorage.getItem("rm_lead") ?? undefined;
  } catch {
    return undefined;
  }
}
