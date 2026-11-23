"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider, useConversationClientTool, useConversationControls, useConversationInput, useConversationMode, useConversationStatus,
} from "@elevenlabs/react";
import { Mic, MicOff, PhoneOff, Send, X } from "lucide-react";
import { ANNUAL_MONTHS, dollars } from "@/lib/catalog";
import type { OfferView, StoreView } from "@/lib/store-view";
import { findOffer, openCheckout, storedLeadId, useStoreOptional, type AssistantRequest } from "./bus";

// The ElevenLabs voice + chat assistant. On the store it's the sales
// assistant, with client tools that read the live catalog, put products on
// screen, open checkout and save contacts. On a demo page it's a prospect's
// demo receptionist (no tools; the agent was built from their website).

type Line = { id: number; role: "user" | "agent" | "tool" | "system"; text: string };

export interface AssistantProps {
  variant: "dock" | "inline";
  /** Talk to a prospect's demo receptionist instead of the sales assistant. */
  demoToken?: string;
  /** Talk to a prospect's demo AI website guide (by its private token). */
  guideToken?: string;
  title?: string;
  subtitle?: string;
  /** The line above the start buttons, before anyone has said anything. */
  intro?: string;
  quick?: string[];
}

export function Assistant(props: AssistantProps) {
  return (
    <ConversationProvider>
      <AssistantInner {...props} />
    </ConversationProvider>
  );
}

function catalogFor(v: StoreView) {
  const c = v.settings.currency;
  return {
    currency: c.toUpperCase(),
    billing: v.settings.annual
      ? `Monthly, or yearly for the price of ${ANNUAL_MONTHS} months${v.settings.waiveSetupOnAnnual ? " with the setup fee waived" : ""}.`
      : "Monthly.",
    extra_call_minutes: `${dollars(v.settings.overagePerMinute, { cents: true, currency: c })} per minute beyond a plan's included minutes`,
    plans: v.plans.map((o) => ({ id: o.id, name: o.name, tagline: o.tagline, monthly_price: o.price, setup_fee: o.setupFee, most_popular: Boolean(o.highlight), includes: o.included.slice(0, 6) })),
    products: v.products.map((o) => ({
      id: o.id,
      name: o.name,
      category: v.categories.find((x) => x.id === o.category)?.label,
      tagline: o.tagline,
      monthly_price: o.price,
      setup_fee: o.setupFee,
    })),
    can_book_a_call: Boolean(v.brand.calendarUrl),
    contact: { email: v.brand.email || null, phone: v.brand.phone || null },
  };
}

function detailsFor(v: StoreView, o: OfferView) {
  return {
    id: o.id,
    name: o.name,
    type: o.kind,
    tagline: o.tagline,
    summary: o.summary,
    monthly_price: o.price,
    setup_fee: o.setupFee,
    yearly_price: v.settings.annual ? o.yearly : null,
    setup_fee_on_yearly: v.settings.annual ? o.setupYearly : null,
    currency: v.settings.currency.toUpperCase(),
    included_each_month: o.included,
    what_it_does: o.features,
    how_it_works: o.howItWorks,
    ideal_for: o.idealFor,
    what_we_deliver: o.deliverables,
    time_to_live: o.timeToLive,
    example: o.example,
    fine_print: o.fineprint ?? null,
    faqs: o.faqs,
    bundled_products: o.bundles?.map((id) => findOffer(v, id)?.name).filter(Boolean) ?? null,
    worth_if_bought_separately_per_month: o.worth ?? null,
    built_on: v.settings.showEngine ? o.engine : null,
  };
}

function pageLabel(v: StoreView | null, path: string): string {
  if (!v) return "a demo page";
  const m = path.match(/^\/store\/([^/?#]+)/);
  if (m) {
    const o = findOffer(v, m[1]);
    if (o) return `the ${o.name} page (id ${o.id})`;
    if (m[1] === "thanks") return "the order confirmation page";
  }
  return "the store home page";
}

function friendly(msg: string): string {
  if (/permission|notallowed|microphone|getUserMedia/i.test(msg)) return "Your microphone is blocked. Allow it in the browser, or type instead.";
  if (/network|websocket|failed to fetch|livekit/i.test(msg)) return "Connection dropped. Check your internet and try again.";
  return "Something went wrong with the conversation. Try again, or type instead.";
}

function AssistantInner({ variant, demoToken, guideToken, title, subtitle, intro, quick }: AssistantProps) {
  const isDemo = Boolean(demoToken || guideToken);
  const store = useStoreOptional();
  const router = useRouter();
  const path = usePathname();
  const { startSession, endSession, sendUserMessage, sendContextualUpdate, getInputVolume, getOutputVolume } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [open, setOpen] = useState(variant === "inline");
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const pendingText = useRef<string | null>(null);
  /** Set when the mic is pressed during a typed chat: start a voice call once it ends. */
  const switchToVoice = useRef(false);
  const beginRef = useRef<(m: "voice" | "text") => Promise<void>>(async () => undefined);
  const orbRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const connected = status === "connected";
  const connecting = busy || status === "connecting";

  const name = title ?? store?.settings.assistantName ?? "Assistant";
  const tone = isDemo ? "tone-lagoon" : "tone-sky";
  const push = useCallback((role: Line["role"], text: string) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === text) return prev;
      return [...prev.slice(-80), { id: nextId.current++, role, text }];
    });
  }, []);

  // ── Client tools (names match sales-spec.ts) ──
  useConversationClientTool("get_catalog", () => (store ? JSON.stringify(catalogFor(store)) : "The catalog isn't available on this page."));
  useConversationClientTool("get_product_details", (p: { product_id?: string }) => {
    if (!store) return "Not available on this page.";
    const o = findOffer(store, p?.product_id);
    if (!o) return `No product with id "${p?.product_id ?? ""}". Call get_catalog for the ids.`;
    return JSON.stringify(detailsFor(store, o));
  });
  useConversationClientTool("show_product", (p: { product_id?: string }) => {
    if (!store) return "Not available on this page.";
    const o = findOffer(store, p?.product_id);
    if (!o) return `No product with id "${p?.product_id ?? ""}".`;
    const el = document.getElementById(`offer-${o.id}`);
    push("tool", `Showing ${o.name}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
      return `${o.name} is highlighted on the visitor's screen.`;
    }
    router.push(`/store/${o.slug}`);
    return `Opened the ${o.name} page on the visitor's screen.`;
  });
  useConversationClientTool("open_checkout", (p: { offer_id?: string; billing?: string }) => {
    if (!store) return "Checkout isn't available on this page.";
    const o = findOffer(store, p?.offer_id);
    if (!o) return `No product with id "${p?.offer_id ?? ""}".`;
    const interval = p?.billing === "year" && store.settings.annual ? "year" : "month";
    openCheckout({ offerId: o.id, interval });
    push("tool", `Opened checkout for ${o.name}`);
    if (!store.payments.stripe && !store.payments.paypal) return "Online payment isn't switched on yet, so the checkout form collects their details instead and the team follows up to finish the sale.";
    return `The secure checkout for ${o.name} (${interval === "year" ? "yearly" : "monthly"}) is open on the visitor's screen. They fill in their business name and email, then pay by card or PayPal. Offer to answer questions while they do.`;
  });
  useConversationClientTool("save_contact", async (p: Record<string, unknown>) => {
    const field = (k: string) => (typeof p?.[k] === "string" ? (p[k] as string) : undefined);
    const body = {
      name: field("name"),
      email: field("email"),
      phone: field("phone"),
      business: field("business"),
      website: field("website"),
      interest: field("interest"),
      notes: [field("notes"), `Saved by the AI sales assistant from ${path}.`].filter(Boolean).join(" "),
      leadId: storedLeadId(),
    };
    const res = await fetch("/api/store/lead", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; error?: string } | undefined;
    if (!res?.ok || !data?.ok) return `Not saved: ${data?.error ?? "the connection failed"}. Ask them to try again, or to email or call the team.`;
    push("tool", "Saved your details for a callback");
    return "Saved. The team has a task to follow up.";
  });
  useConversationClientTool("book_call", () => {
    const url = store?.brand.calendarUrl;
    if (!url) return "There's no booking calendar. Offer to save their details with save_contact so the team calls them.";
    window.open(url, "_blank", "noopener");
    push("tool", "Opened the booking calendar");
    return "The booking calendar opened in a new tab.";
  });

  // Keep the agent aware of which page the visitor is on.
  const lastPath = useRef(path);
  useEffect(() => {
    if (!connected || lastPath.current === path) return;
    lastPath.current = path;
    sendContextualUpdate(`The visitor is now viewing ${pageLabel(store, path)}.`);
  }, [connected, path, store, sendContextualUpdate]);

  // The orb follows the audio level.
  useEffect(() => {
    if (!connected || mode !== "voice") {
      orbRef.current?.style.setProperty("--level", "0");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const level = Math.max(getOutputVolume?.() ?? 0, (getInputVolume?.() ?? 0) * 0.8);
      smooth = smooth * 0.75 + Math.min(1, level * 1.6) * 0.25;
      orbRef.current?.style.setProperty("--level", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, mode, getInputVolume, getOutputVolume]);

  useEffect(() => {
    // Before anyone speaks, keep the greeting and start buttons in view.
    if (!lines.length && !notice) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, notice]);

  const begin = useCallback(
    async (nextMode: "voice" | "text") => {
      setNotice(null);
      setBusy(true);
      try {
        const res = await fetch("/api/store/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: nextMode, demo: demoToken, guide: guideToken }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; auth?: { conversationToken: string } | { signedUrl: string } };
        if (!res.ok || !data.ok || !data.auth) {
          setNotice(data.error ?? "The assistant isn't available right now.");
          pendingText.current = null;
          return;
        }
        setMode(nextMode);
        const auth =
          "conversationToken" in data.auth
            ? { conversationToken: data.auth.conversationToken, connectionType: "webrtc" as const }
            : { signedUrl: data.auth.signedUrl, connectionType: "websocket" as const };
        startSession({
          ...auth,
          textOnly: nextMode === "text",
          ...(store && !isDemo
            ? {
                dynamicVariables: {
                  assistant_name: store.settings.assistantName,
                  agency_name: store.brand.name,
                  today: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
                  current_page: pageLabel(store, window.location.pathname),
                },
              }
            : {}),
          onConnect: () => {
            push("system", nextMode === "voice" ? "Connected. Start talking." : "Connected.");
            lastPath.current = window.location.pathname;
            if (store && !isDemo) {
              sendContextualUpdate(
                `Product and plan ids, for the tools: ${[...store.plans, ...store.products].map((o) => `${o.id} (${o.name})`).join(", ")}.`
              );
            }
            if (pendingText.current) {
              const t = pendingText.current;
              pendingText.current = null;
              sendUserMessage(t);
            }
          },
          onMessage: ({ message, role }: { message?: string; role?: string }) => {
            if (message?.trim()) push(role === "agent" ? "agent" : "user", message);
          },
          onDisconnect: () => {
            setMode(null);
            if (switchToVoice.current) {
              switchToVoice.current = false;
              push("system", "Switching to voice…");
              window.setTimeout(() => void beginRef.current("voice"), 250);
              return;
            }
            push("system", "Conversation ended.");
          },
          onError: (msg: string) => {
            console.warn("[assistant]", msg);
            setNotice(friendly(msg));
          },
        });
      } catch (err) {
        setNotice(friendly(err instanceof Error ? err.message : String(err)));
      } finally {
        setBusy(false);
      }
    },
    [demoToken, guideToken, isDemo, push, sendContextualUpdate, sendUserMessage, startSession, store]
  );
  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const ask = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      push("user", t);
      if (connected) {
        sendUserMessage(t);
        return;
      }
      pendingText.current = t;
      await begin("text");
    },
    [begin, connected, push, sendUserMessage]
  );

  // "Talk to our AI" buttons anywhere on the page.
  useEffect(() => {
    const onReq = (e: Event) => {
      const d = (e as CustomEvent<AssistantRequest>).detail ?? {};
      setOpen(true);
      if (d.ask && d.mode === "voice" && !connected && !connecting) {
        // Start a voice call that opens with this question.
        const t = d.ask.trim();
        push("user", t);
        pendingText.current = t;
        void begin("voice");
      } else if (d.ask) void ask(d.ask);
      else if (d.mode && !connected && !connecting) void begin(d.mode);
    };
    window.addEventListener("rm:assistant", onReq);
    return () => window.removeEventListener("rm:assistant", onReq);
  }, [ask, begin, connected, connecting, push]);

  const prompts =
    quick ??
    (store
      ? ["What does the AI receptionist do?", "Which plan fits a dental office?", "How does video dubbing work?", "What's included in Growth?"]
      : ["Hi, do you have anything open Saturday?", "How much does a visit cost?", "Where are you located?"]);

  const statusText = connecting
    ? "Connecting…"
    : connected
      ? mode === "voice"
        ? isSpeaking
          ? `${name} is talking`
          : isMuted
            ? "Mic muted"
            : "Listening…"
        : "Chatting"
      : (subtitle ?? "Voice or chat · usually answers instantly");

  if (variant === "dock" && !open) {
    return (
      <button type="button" className="assistant-fab" onClick={() => setOpen(true)} aria-label={`Talk to ${name}, our AI assistant`}>
        <span className={`orb idle ${tone}`} />
        <span style={{ textAlign: "left" }}>
          Talk to {name}
          <small>AI assistant · voice or chat</small>
        </span>
      </button>
    );
  }

  return (
    <section className={`assistant-panel ${variant === "inline" ? "inline" : ""}`} aria-label={`${name}, AI assistant`}>
      <div className="ap-head">
        <span ref={orbRef} className={`orb ${tone} ${connected ? "" : "idle"}`} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b className="truncate">{name}</b>
          <small aria-live="polite">{statusText}</small>
        </div>
        {connected && (
          <button type="button" className="btn ghost icon sm" onClick={() => endSession()} aria-label="End conversation" title="End conversation">
            <PhoneOff size={17} />
          </button>
        )}
        {variant === "dock" && (
          <button
            type="button"
            className="btn ghost icon sm"
            onClick={() => {
              if (connected) endSession();
              setOpen(false);
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="ap-body" ref={scrollRef}>
        {!lines.length && (
          <div className="ap-intro">
            <span className={`orb lg idle ${tone}`} />
            <p>
              {intro ??
                (store && !isDemo
                  ? `Hi! I'm ${name}, an AI assistant. Ask me about any of our services, what they cost, or which plan fits your business.`
                  : "Talk to it like a caller would. Ask about services, prices, hours or booking.")}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button type="button" className="btn primary" onClick={() => void begin("voice")} disabled={connecting}>
                <Mic size={16} /> Start talking
              </button>
              <button type="button" className="btn" onClick={() => void begin("text")} disabled={connecting}>
                Type instead
              </button>
            </div>
            <div className="ap-quick">
              {prompts.map((q) => (
                <button key={q} type="button" onClick={() => void ask(q)} disabled={connecting}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.map((l) => (
          <div key={l.id} className={`ap-line ${l.role}`}>
            {l.role === "tool" || l.role === "system" ? <span>{l.text}</span> : <div className="say">{l.text}</div>}
          </div>
        ))}
      </div>

      {notice && <div className="ap-notice">{notice}</div>}

      <form
        className="ap-foot"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft;
          setDraft("");
          void ask(t);
        }}
      >
        {connected && mode === "voice" ? (
          <button type="button" className={`mic-btn ${isMuted ? "muted" : "live"}`} onClick={() => setMuted(!isMuted)} aria-label={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        ) : (
          <button
            type="button"
            className="mic-btn"
            onClick={() => {
              if (!connected) return void begin("voice");
              switchToVoice.current = true;
              endSession();
            }}
            disabled={connecting}
            aria-label="Talk by voice"
            title="Talk by voice"
          >
            <Mic size={18} />
          </button>
        )}
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={connected && mode === "voice" ? "Or type a message…" : "Type a message…"} aria-label="Message" maxLength={800} />
        <button type="submit" className="btn primary icon" disabled={!draft.trim() || connecting} aria-label="Send">
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}
