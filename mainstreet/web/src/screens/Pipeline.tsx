import { useEffect, useMemo, useState } from "react";
import { Plus, Search, SquareKanban, Store } from "lucide-react";
import type { LeadStatus, LeadSummary } from "../api";
import type { LeadsResponse } from "../api";
import { run } from "../commands";
import { ago, initials, money, STATUS_LABEL } from "../format";
import { href, navigate, useRoute } from "../router";
import { formDialog, useApi, useStore } from "../store";
import { Button, Card, Chip, cx, Empty, ErrorNote, Loading, PageHeader, Rating, Score, StateChip, StatusChip } from "../ui";


const STAGES: (LeadStatus | "all")[] = ["all", "new", "qualified", "diagnosed", "built", "filmed", "ready", "pitched", "replied", "negotiating", "won", "lost", "skipped", "dnc"];

export function nicheLabel(id: string, niches?: { id: string; label: string }[]): string {
  return niches?.find((n) => n.id === id)?.label ?? id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Pipeline() {
  const route = useRoute();
  const status = (route.query.get("status") as LeadStatus | null) ?? "all";
  const [q, setQ] = useState(route.query.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [limit, setLimit] = useState(48);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => setLimit(48), [status, debounced]);

  const path = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit), offset: "0" });
    if (status !== "all") p.set("status", status);
    if (debounced) p.set("q", debounced);
    return `/api/leads?${p}`;
  }, [status, debounced, limit]);
  const { data, error, loading, reload } = useApi<LeadsResponse>(path);

  const counts = data?.counts ?? {};
  const all = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  const addBusiness = async () => {
    const niches = settings?.niches ?? [];
    const v = await formDialog({
      title: "Add a business",
      body: "The crew checks its website, scores it and, if it's a fit, builds the mockups and video like any other lead.",
      confirmLabel: "Add it",
      fields: [
        { name: "name", label: "Business name", required: true, placeholder: "Bright Smile Dental" },
        { name: "city", label: "City", required: true, placeholder: "Bend" },
        { name: "region", label: "State or province", placeholder: "OR" },
        ...(niches.length
          ? [{ name: "niche", label: "Type of business", type: "select" as const, options: [{ value: "", label: "Let the Scout work it out" }, ...niches.map((n) => ({ value: n.id, label: n.label }))] }]
          : [{ name: "niche", label: "Type of business", placeholder: "dentist" }]),
        { name: "phone", label: "Phone", placeholder: "(541) 555-0134" },
        { name: "website", label: "Current website", placeholder: "brightsmilebend.com" },
        { name: "email", label: "Email", placeholder: "hello@…", hint: "Only use an address the business publishes itself." },
      ],
    });
    if (!v) return;
    const res = await run("add_lead", v);
    if (res.ok) {
      const id = (res.data as { id?: string; lead?: { id?: string } } | undefined)?.id ?? (res.data as { lead?: { id?: string } } | undefined)?.lead?.id;
      if (id) navigate("lead", id);
      else reload();
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Pipeline"
        sub={data ? `${all.toLocaleString()} businesses, from first scan to paid.` : "Every business the crew is working on."}
        actions={
          <Button tone="primary" icon={Plus} onClick={() => void addBusiness()}>
            Add a business
          </Button>
        }
      />

      <div className="pipeline-tools">
        <label className="search">
          <Search size={16} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, city or niche" aria-label="Search leads" />
        </label>
      </div>

      <div className="stage-tabs" role="tablist" aria-label="Pipeline stages">
        {STAGES.map((s) => {
          const n = s === "all" ? all : (counts[s] ?? 0);
          if (s !== "all" && !n && s !== status && ["lost", "skipped", "dnc", "negotiating"].includes(s)) return null;
          return (
            <a key={s} role="tab" aria-selected={status === s} href={href("pipeline", undefined, { status: s === "all" ? undefined : s, q: debounced || undefined })} className={cx("stage-tab", status === s && "is-on")}>
              <span>{s === "all" ? "All" : STATUS_LABEL[s]}</span>
              <span className="stage-count num">{n}</span>
            </a>
          );
        })}
      </div>

      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {!data && loading ? <Loading label="Loading the pipeline…" /> : null}
      {data && !data.leads.length ? (
        <Card>
          <Empty
            icon={SquareKanban}
            title={debounced ? `Nothing matches "${debounced}"` : status === "all" ? "No businesses yet" : `No leads are ${STATUS_LABEL[status as LeadStatus].toLowerCase()} right now`}
            body={status === "all" && !debounced ? "Add target towns and niches in Settings, or ask Atlas to scout a town." : undefined}
            action={
              status === "all" && !debounced ? (
                <Button tone="primary" icon={Plus} onClick={() => void addBusiness()}>
                  Add a business
                </Button>
              ) : null
            }
          />
        </Card>
      ) : null}

      {data?.leads.length ? (
        <>
          <ul className="lead-grid">
            {data.leads.map((l) => (
              <li key={l.id}>
                <LeadCard lead={l} niches={settings?.niches} />
              </li>
            ))}
          </ul>
          {data.total > data.leads.length ? (
            <div className="center mt">
              <Button busy={loading} onClick={() => setLimit((n) => n + 48)}>
                Show more ({(data.total - data.leads.length).toLocaleString()} left)
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function LeadCard({ lead: l, niches }: { lead: LeadSummary; niches?: { id: string; label: string }[] }) {
  return (
    <a className={cx("lead-card", l.error && "has-error")} href={href("lead", l.id)}>
      <div className="lead-thumb">
        {l.thumb ? (
          <img src={l.thumb} alt={`Mockup for ${l.name}`} loading="lazy" decoding="async" />
        ) : (
          <span className="lead-thumb-empty" aria-hidden>
            <Store size={18} />
            <b>{initials(l.name)}</b>
          </span>
        )}
        <span className="lead-thumb-chips">
          <StatusChip status={l.status} />
        </span>
      </div>
      <div className="lead-card-body">
        <div className="lead-card-title">
          <b>{l.name}</b>
          <Score value={l.score} />
        </div>
        <span className="muted small">
          {nicheLabel(l.niche, niches)} · {l.city}
          {l.region ? `, ${l.region}` : ""}
        </span>
        <div className="lead-card-chips">
          <StateChip state={l.websiteState} />
          {l.error ? <Chip tone="red">Needs a look</Chip> : null}
        </div>
        <div className="lead-card-foot">
          <Rating value={l.rating} count={l.reviewCount} />
          <span className="num lead-price">{money(l.dealValueCents ?? l.priceCents)}</span>
        </div>
        <span className="muted tiny">Updated {ago(l.updatedAt)}</span>
      </div>
    </a>
  );
}
