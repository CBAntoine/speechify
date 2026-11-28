import { useEffect, useMemo, useState } from "react";
import { Bell, Building, ExternalLink, Gauge, Image, Mic, Plug, Plus, RefreshCw, Rocket, Save, Send, ShieldCheck, Target, Undo2, Wallet, X } from "lucide-react";
import { getVoiceStatus, patchSettings, syncVoice } from "../api";
import type { Integrations, Settings, SettingsResponse, VoiceStatus } from "../api";
import { setAtlasOpen } from "../atlas/open";
import { useRoute } from "../router";
import { setSettings, toast, useApi } from "../store";
import { Button, Card, Chip, cx, Dot, ErrorNote, Field, Loading, PageHeader, Segmented, Toggle, useBusy } from "../ui";

type Section = Exclude<keyof Settings, "crew">;
const SECTIONS: Section[] = ["owner", "offer", "targets", "quotas", "pitching", "escalation", "budget", "media", "qualify"];

const cents = (v: string) => Math.max(0, Math.round(Number(v || 0) * 100));
const dollars = (c: number | undefined) => (c === undefined ? "" : String(Math.round(c) / 100));
const int = (v: string, min = 0) => Math.max(min, Math.round(Number(v || 0)));

export function SettingsScreen() {
  const route = useRoute();
  const { data, error, loading, reload } = useApi<SettingsResponse>("/api/settings", { live: false });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setDraft(structuredClone(data.settings));
      setSettings(data);
    }
  }, [data]);

  // #/settings?section=voice scrolls to that card.
  const section = route.query.get("section");
  useEffect(() => {
    if (!section || !draft) return;
    window.setTimeout(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }, [section, draft]);

  const dirty = useMemo(() => {
    if (!data || !draft) return [] as Section[];
    return SECTIONS.filter((s) => JSON.stringify(data.settings[s]) !== JSON.stringify(draft[s]));
  }, [data, draft]);

  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data || !draft) return <div className="page">{loading ? <Loading label="Loading settings…" /> : null}</div>;

  const s = draft;
  const up = (fn: (d: Settings) => void) =>
    setDraft((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });

  const save = async () => {
    const patch: Partial<Settings> = {};
    for (const k of dirty) (patch as Record<string, unknown>)[k] = draft[k];
    setSaving(true);
    try {
      const res = await patchSettings(patch);
      const next = { ...data, settings: res.settings };
      setSettings(next);
      setDraft(structuredClone(res.settings));
      toast("success", "Settings saved. The crew uses them from its next step.");
      reload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Couldn't save the settings.");
    } finally {
      setSaving(false);
    }
  };

  const noAddress = !s.owner.postalAddress.trim();
  const niches = data.niches;

  return (
    <div className={cx("page settings", dirty.length > 0 && "has-savebar")}>
      <PageHeader title="Settings" sub="How the crew works: who you are, what you sell, where it hunts, how fast it goes and when it stops to ask you." />

      <nav className="settings-jump chips-row" aria-label="Jump to a section">
        {[
          ["owner", "You"],
          ["offer", "Offer"],
          ["targets", "Targets"],
          ["quotas", "Pace"],
          ["pitching", "Pitching"],
          ["escalation", "Escalation"],
          ["budget", "Budget"],
          ["media", "Media"],
          ["integrations", "Connections"],
          ["voice", "Voice"],
        ].map(([id, label]) => (
          <a key={id} className="filter-chip" href={`#/settings?section=${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <div className="settings-grid">
        <Card title="You and your agency" icon={Building} id="settings-owner" className={cx(noAddress && "card-alert")}>
          {noAddress ? (
            <div className="callout tone-red">
              <span>
                <b>Add your postal address.</b> CAN-SPAM and CASL require it on every commercial email, so the Pitcher won't send any email until it's filled in.
              </span>
            </div>
          ) : null}
          <div className="form-grid">
            <Field label="Your name">
              <input className="input" value={s.owner.name} onChange={(e) => up((d) => void (d.owner.name = e.target.value))} />
            </Field>
            <Field label="Agency name">
              <input className="input" value={s.owner.agencyName} onChange={(e) => up((d) => void (d.owner.agencyName = e.target.value))} />
            </Field>
            <Field label="Email for alerts" hint="Escalations and your daily brief go here.">
              <input className="input" type="email" value={s.owner.email} onChange={(e) => up((d) => void (d.owner.email = e.target.value))} />
            </Field>
            <Field label="Reply-to address" hint="An inbound address that forwards replies to Mainstreet, so the Closer sees them.">
              <input className="input" type="email" value={s.owner.replyTo ?? ""} onChange={(e) => up((d) => void (d.owner.replyTo = e.target.value || undefined))} />
            </Field>
            <Field label="Your phone" hint="E.164, like +16045550123. Atlas calls it for escalations.">
              <input className="input" type="tel" value={s.owner.phone ?? ""} onChange={(e) => up((d) => void (d.owner.phone = e.target.value || undefined))} />
            </Field>
            <Field label="Booking link" hint="Your calendar link for prospects who want a call.">
              <input className="input" type="url" value={s.owner.bookingUrl ?? ""} onChange={(e) => up((d) => void (d.owner.bookingUrl = e.target.value || undefined))} />
            </Field>
            <Field label="Postal address" wide error={noAddress ? "Required before any email can go out." : undefined}>
              <textarea className="input" rows={2} value={s.owner.postalAddress} onChange={(e) => up((d) => void (d.owner.postalAddress = e.target.value))} />
            </Field>
            <Field label="Time zone">
              <TimezoneSelect value={s.owner.timezone} onChange={(v) => up((d) => void (d.owner.timezone = v))} />
            </Field>
          </div>
        </Card>

        <Card title="Your offer" icon={Wallet} id="settings-offer">
          <div className="form-grid">
            <Field label="Price per website">
              <MoneyInput value={s.offer.priceCents} onChange={(c) => up((d) => void (d.offer.priceCents = c))} />
            </Field>
            <Field label="Currency">
              <select className="input" value={s.offer.currency} onChange={(e) => up((d) => void (d.offer.currency = e.target.value as "USD" | "CAD"))}>
                <option value="USD">US dollars</option>
                <option value="CAD">Canadian dollars</option>
              </select>
            </Field>
            <Field label="Hosting per month" hint="0 means no hosting plan.">
              <MoneyInput value={s.offer.hostingMonthlyCents} onChange={(c) => up((d) => void (d.offer.hostingMonthlyCents = c))} />
            </Field>
            <Field label="Delivery (days)">
              <input className="input" type="number" min={1} value={s.offer.deliveryDays} onChange={(e) => up((d) => void (d.offer.deliveryDays = int(e.target.value, 1)))} />
            </Field>
            <Field label="Guarantee" wide hint="Shown on every proposal page.">
              <input className="input" value={s.offer.guarantee} onChange={(e) => up((d) => void (d.offer.guarantee = e.target.value))} />
            </Field>
          </div>
        </Card>

        <Card title="Where the Scout hunts" icon={Target} id="settings-targets">
          <h3 className="group-title">Towns and cities</h3>
          {s.targets.cities.length ? (
            <ul className="tag-list">
              {s.targets.cities.map((c, i) => (
                <li key={`${c.city}-${c.region}-${i}`} className="tag">
                  {c.city}, {c.region} <span className="muted">{c.country}</span>
                  <button type="button" aria-label={`Remove ${c.city}`} onClick={() => up((d) => void d.targets.cities.splice(i, 1))}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No towns yet. Small cities work best: fewer agencies call them.</p>
          )}
          <AddCity onAdd={(c) => up((d) => void d.targets.cities.push(c))} />
          <h3 className="group-title mt">Niches</h3>
          <ul className="tag-list">
            {s.targets.niches.map((n, i) => (
              <li key={n} className="tag">
                {niches.find((x) => x.id === n)?.label ?? n}
                <button type="button" aria-label={`Remove ${n}`} onClick={() => up((d) => void d.targets.niches.splice(i, 1))}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <AddNiche options={niches.filter((n) => !s.targets.niches.includes(n.id))} onAdd={(id) => up((d) => void d.targets.niches.push(id))} />
        </Card>

        <Card title="Pace" icon={Gauge} id="settings-quotas">
          <div className="form-grid three">
            <Field label="Scanned per day">
              <input className="input" type="number" min={0} value={s.quotas.scanPerDay} onChange={(e) => up((d) => void (d.quotas.scanPerDay = int(e.target.value)))} />
            </Field>
            <Field label="Built per day">
              <input className="input" type="number" min={0} value={s.quotas.leadsPerDay} onChange={(e) => up((d) => void (d.quotas.leadsPerDay = int(e.target.value)))} />
            </Field>
            <Field label="Pitched per day">
              <input className="input" type="number" min={0} value={s.quotas.pitchesPerDay} onChange={(e) => up((d) => void (d.quotas.pitchesPerDay = int(e.target.value)))} />
            </Field>
          </div>
          <h3 className="group-title mt">Who qualifies</h3>
          <div className="form-grid three">
            <Field label="Minimum score" hint="0–100">
              <input className="input" type="number" min={0} max={100} value={s.qualify.minScore} onChange={(e) => up((d) => void (d.qualify.minScore = Math.min(100, int(e.target.value))))} />
            </Field>
            <Field label="Minimum reviews" hint="Shows they're established.">
              <input className="input" type="number" min={0} value={s.qualify.minReviews} onChange={(e) => up((d) => void (d.qualify.minReviews = int(e.target.value)))} />
            </Field>
            <div className="field">
              <span className="field-label">&nbsp;</span>
              <Toggle checked={s.qualify.skipChains} onChange={(v) => up((d) => void (d.qualify.skipChains = v))} label="Skip chains and franchises" />
            </div>
          </div>
        </Card>

        <Card title="Pitching" icon={Send} id="settings-pitching">
          <Field label="First emails" hint={s.pitching.mode === "review" ? "Every first email waits in Approvals for your yes." : "The Pitcher sends inside your caps and hours. Follow-ups always send on their own."}>
            <Segmented
              label="First emails"
              value={s.pitching.mode}
              onChange={(v) => up((d) => void (d.pitching.mode = v))}
              options={[
                { value: "review", label: "I review each one" },
                { value: "auto", label: "Send automatically" },
              ]}
            />
          </Field>
          <h3 className="group-title mt">Channels</h3>
          <div className="toggle-list">
            <Toggle checked={s.pitching.channels.email} onChange={(v) => up((d) => void (d.pitching.channels.email = v))} label="Email" hint="Sent by the Pitcher, to addresses the business publishes itself." />
            <Toggle checked={s.pitching.channels.call} onChange={(v) => up((d) => void (d.pitching.channels.call = v))} label="Calls" hint="On your one-tap list, with a script." />
            <Toggle checked={s.pitching.channels.sms} onChange={(v) => up((d) => void (d.pitching.channels.sms = v))} label="Texts" hint="One tap opens your phone's Messages with the text ready." />
            <Toggle checked={s.pitching.channels.dm} onChange={(v) => up((d) => void (d.pitching.channels.dm = v))} label="Social DMs" hint="Opens their Facebook or Instagram page with the message copied." />
          </div>
          <h3 className="group-title mt">When</h3>
          <div className="form-grid three">
            <Field label="Start sending at">
              <HourSelect value={s.pitching.sendWindow.startHour} onChange={(h) => up((d) => void (d.pitching.sendWindow.startHour = h))} />
            </Field>
            <Field label="Stop at">
              <HourSelect value={s.pitching.sendWindow.endHour} onChange={(h) => up((d) => void (d.pitching.sendWindow.endHour = h))} />
            </Field>
            <Field label="Follow up after (days)" hint="Comma-separated, e.g. 3, 7">
              <FollowupInput value={s.pitching.followupDays} onChange={(v) => up((d) => void (d.pitching.followupDays = v))} />
            </Field>
          </div>
          <div className="toggle-list mt-sm">
            <Toggle checked={s.pitching.sendWindow.weekdaysOnly} onChange={(v) => up((d) => void (d.pitching.sendWindow.weekdaysOnly = v))} label="Weekdays only" />
            <Toggle checked={s.pitching.warmup} onChange={(v) => up((d) => void (d.pitching.warmup = v))} label="Warm up a new sending domain" hint="Ramps daily email volume over two weeks so it doesn't land in spam." />
            <Toggle
              checked={Boolean(s.pitching.autoReply)}
              onChange={(v) => up((d) => void (d.pitching.autoReply = v))}
              label="Let the Closer answer routine replies itself"
              hint="Questions, a plain “yes” and price questions get answered right away. Anything big or unusual still waits for you."
            />
          </div>
        </Card>

        <Card title="When Atlas wakes you" icon={Bell} id="settings-escalation">
          <div className="form-grid">
            <Field label="Deals over" hint="Bigger deals wait for your yes.">
              <MoneyInput value={s.escalation.dealOverCents} onChange={(c) => up((d) => void (d.escalation.dealOverCents = c))} />
            </Field>
            <Field label="Alert below this reply rate" hint="7-day share of pitches that get a reply.">
              <div className="input-suffix">
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={Math.round(s.escalation.minResponseRate * 1000) / 10}
                  onChange={(e) => up((d) => void (d.escalation.minResponseRate = Math.min(1, Math.max(0, Number(e.target.value || 0) / 100))))}
                />
                <span>%</span>
              </div>
            </Field>
            <Field label="Judge after this many pitches">
              <input className="input" type="number" min={1} value={s.escalation.minSample} onChange={(e) => up((d) => void (d.escalation.minSample = int(e.target.value, 1)))} />
            </Field>
            <Field label="Push topic (ntfy.sh)" hint="Install the ntfy app and subscribe to this topic.">
              <input className="input" value={s.escalation.ntfyTopic ?? ""} placeholder="mainstreet-your-secret-topic" onChange={(e) => up((d) => void (d.escalation.ntfyTopic = e.target.value || undefined))} />
            </Field>
          </div>
          <div className="toggle-list mt-sm">
            <Toggle checked={s.escalation.pauseOnLowResponse} onChange={(v) => up((d) => void (d.escalation.pauseOnLowResponse = v))} label="Pause pitching when the rate drops" hint="Protects your domain and your list while you look at why." />
            <Toggle checked={s.escalation.callOwner} onChange={(v) => up((d) => void (d.escalation.callOwner = v))} label="Atlas phones me for escalations" hint="Needs your phone above and a phone number in ElevenLabs." />
          </div>
        </Card>

        <Card title="Budget" icon={ShieldCheck} id="settings-budget">
          <p className="muted small">The Checker prices every step before it runs and stops the crew at these limits.</p>
          <div className="form-grid three">
            <Field label="Per day (USD)">
              <MoneyInput value={Math.round(s.budget.dailyUsd * 100)} onChange={(c) => up((d) => void (d.budget.dailyUsd = c / 100))} currency="USD" />
            </Field>
            <Field label="Per month (USD)">
              <MoneyInput value={Math.round(s.budget.monthlyUsd * 100)} onChange={(c) => up((d) => void (d.budget.monthlyUsd = c / 100))} currency="USD" />
            </Field>
            <Field label="Per lead, at most (USD)">
              <MoneyInput value={Math.round(s.budget.perLeadMaxUsd * 100)} onChange={(c) => up((d) => void (d.budget.perLeadMaxUsd = c / 100))} currency="USD" />
            </Field>
          </div>
        </Card>

        <Card title="Mockups and video" icon={Image} id="settings-media">
          <div className="toggle-list">
            <Toggle checked={s.media.heroImages} onChange={(v) => up((d) => void (d.media.heroImages = v))} label="AI hero photos" hint="ElevenLabs Image & Video (Pro plan). Without it the mockups use designed artwork." disabled={!data.integrations.elevenImages && !s.media.heroImages} />
            <Toggle checked={s.media.video} onChange={(v) => up((d) => void (d.media.video = v))} label="Make a video for each lead" hint="A 10–15 second vertical video of their new site with a voiceover." />
          </div>
          <Field label="Voiceover voice ID" hint="From your ElevenLabs voice library. Empty uses the default.">
            <input className="input" value={s.media.voiceId ?? ""} onChange={(e) => up((d) => void (d.media.voiceId = e.target.value.trim() || undefined))} />
          </Field>
        </Card>

        <IntegrationsCard integrations={data.integrations} />
        <VoiceCard integrations={data.integrations} />
      </div>

      {dirty.length ? (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <span>
            <b>Unsaved changes</b> <span className="muted small">in {dirty.length === 1 ? "1 section" : `${dirty.length} sections`}</span>
          </span>
          <div className="row gap-sm">
            <Button tone="ghost" icon={Undo2} onClick={() => setDraft(structuredClone(data.settings))} disabled={saving}>
              Discard
            </Button>
            <Button tone="primary" icon={Save} busy={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────

function MoneyInput({ value, onChange, currency }: { value: number; onChange: (cents: number) => void; currency?: string }) {
  const [text, setText] = useState(dollars(value));
  useEffect(() => setText(dollars(value)), [value]);
  return (
    <div className="input-prefix">
      <span>{currency === "USD" ? "US$" : "$"}</span>
      <input
        className="input"
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(cents(e.target.value));
        }}
      />
    </div>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {new Date(2020, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}
        </option>
      ))}
    </select>
  );
}

function FollowupInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  return (
    <input
      className="input"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const days = e.target.value
          .split(/[,\s]+/)
          .map((x) => Math.round(Number(x)))
          .filter((n) => Number.isFinite(n) && n > 0 && n < 90);
        onChange([...new Set(days)].sort((a, b) => a - b));
      }}
    />
  );
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const zones = useMemo(() => {
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
      return all.filter((z) => /^(America|Europe|Australia|Pacific|Asia|Africa|Atlantic)\//.test(z));
    } catch {
      return [];
    }
  }, []);
  if (!zones.length) return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {!zones.includes(value) ? <option value={value}>{value}</option> : null}
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

function AddCity({ onAdd }: { onAdd: (c: { city: string; region: string; country: "US" | "CA" }) => void }) {
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState<"US" | "CA">("US");
  const add = () => {
    if (!city.trim() || !region.trim()) return;
    onAdd({ city: city.trim(), region: region.trim().toUpperCase(), country });
    setCity("");
    setRegion("");
  };
  return (
    <div
      className="inline-form city-form"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          add();
        }
      }}
    >
      <input className="input" placeholder="Town" value={city} onChange={(e) => setCity(e.target.value)} aria-label="Town or city" />
      <input className="input narrow" placeholder="State" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="State or province" maxLength={3} />
      <select className="input narrow" value={country} onChange={(e) => setCountry(e.target.value as "US" | "CA")} aria-label="Country">
        <option value="US">US</option>
        <option value="CA">CA</option>
      </select>
      <Button icon={Plus} onClick={add} disabled={!city.trim() || !region.trim()}>
        Add
      </Button>
    </div>
  );
}

function AddNiche({ options, onAdd }: { options: { id: string; label: string }[]; onAdd: (id: string) => void }) {
  const [pick, setPick] = useState("");
  if (!options.length) return null;
  return (
    <div className="inline-form">
      <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a niche">
        <option value="">Add a niche…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Button
        icon={Plus}
        disabled={!pick}
        onClick={() => {
          onAdd(pick);
          setPick("");
        }}
      >
        Add
      </Button>
    </div>
  );
}

// ── Connections ──────────────────────────────────────────────────────────

const INTEGRATIONS: { key: keyof Omit<Integrations, "voiceAgent" | "publicUrl">; name: string; does: string; env: string }[] = [
  { key: "claude", name: "Claude", does: "Writes every diagnosis, site plan, pitch and reply.", env: "ANTHROPIC_API_KEY" },
  { key: "googlePlaces", name: "Google Places", does: "Finds businesses on the map, with ratings, hours and reviews.", env: "GOOGLE_PLACES_API_KEY" },
  { key: "elevenlabs", name: "ElevenLabs", does: "Atlas's voice, and the voiceover on every video.", env: "ELEVENLABS_API_KEY" },
  { key: "elevenImages", name: "ElevenLabs images", does: "AI hero photos for the mockups (Pro plan and up).", env: "ELEVENLABS_API_KEY" },
  { key: "resend", name: "Resend", does: "Sends pitch emails from your own domain and receives the replies.", env: "RESEND_API_KEY" },
  { key: "stripe", name: "Stripe", does: "The “Claim this site” payment button on every proposal.", env: "STRIPE_SECRET_KEY" },
  { key: "ffmpeg", name: "FFmpeg", does: "Renders the vertical videos.", env: "brew install ffmpeg" },
  { key: "browser", name: "Chromium", does: "Screenshots and films each mockup.", env: "npx playwright install chromium" },
];

function IntegrationsCard({ integrations }: { integrations: Integrations }) {
  return (
    <Card title="Connections" icon={Plug} id="settings-integrations">
      <p className="muted small">Keys live in the server's .env file. Everything works without them in demo mode; each key switches on the real thing.</p>
      <ul className="integrations">
        {INTEGRATIONS.map((i) => {
          const on = Boolean(integrations[i.key]);
          return (
            <li key={i.key} className={cx("integration", on ? "is-on" : "is-off")}>
              <Dot tone={on ? "green" : "grey"} label={on ? "Connected" : "Not connected"} />
              <span className="integration-text">
                <b>{i.name}</b>
                <span className="muted small">{i.does}</span>
              </span>
              {on ? <Chip tone="green">Connected</Chip> : <code className="env">{i.env}</code>}
            </li>
          );
        })}
        <li className={cx("integration", integrations.publicUrl ? "is-on" : "is-off")}>
          <Dot tone={integrations.publicUrl ? "green" : "grey"} label={integrations.publicUrl ? "Set" : "Not set"} />
          <span className="integration-text">
            <b>Public address</b>
            <span className="muted small">{integrations.publicUrl ? integrations.publicUrl : "Proposal links prospects can open, payment webhooks, and calling Atlas from your phone."}</span>
          </span>
          {integrations.publicUrl ? <Chip tone="green">Set</Chip> : <code className="env">PUBLIC_URL</code>}
        </li>
      </ul>
    </Card>
  );
}

function VoiceCard({ integrations }: { integrations: Integrations }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [busy, act] = useBusy();

  const load = () =>
    getVoiceStatus()
      .then((v) => {
        setStatus(v);
        setStatusErr(null);
      })
      .catch((err: unknown) => setStatusErr(err instanceof Error ? err.message : String(err)));
  useEffect(() => {
    void load();
  }, []);

  const v = status ?? { configured: integrations.voiceAgent.configured, agentId: integrations.voiceAgent.agentId, toolMode: integrations.voiceAgent.toolMode };

  return (
    <Card title="Atlas, your voice agent" icon={Mic} id="settings-voice" className="voice-card">
      <div className="voice-status">
        <span className={cx("orb sm", !v.configured && "idle")} aria-hidden />
        <div>
          <b>{v.configured ? "Atlas is set up" : "Atlas isn't set up yet"}</b>
          <p className="muted small">
            {v.configured
              ? v.toolMode === "webhook"
                ? "Its tools call this server over the internet, so it works in the app and on a phone call."
                : "Its tools run in this dashboard, so talk to it here. Set PUBLIC_URL and sync again to also call it from your phone."
              : integrations.elevenlabs
                ? "Press Sync to create Atlas in your ElevenLabs workspace with every command as a tool."
                : "Add ELEVENLABS_API_KEY to the server's .env, restart it, then press Sync."}
          </p>
        </div>
      </div>
      {statusErr ? <p className="field-err">{statusErr}</p> : null}
      <dl className="dl">
        <div>
          <dt>Agent</dt>
          <dd>{v.agentId ? <code>{v.agentId}</code> : "—"}</dd>
        </div>
        <div>
          <dt>Tools run</dt>
          <dd>{v.toolMode === "webhook" ? "On this server (webhooks)" : "In this dashboard (client tools)"}</dd>
        </div>
      </dl>
      <div className="row gap-sm wrap mt-sm">
        <Button
          tone="primary"
          icon={RefreshCw}
          busy={busy}
          disabled={!integrations.elevenlabs}
          onClick={() =>
            act(async () => {
              try {
                const r = await syncVoice();
                if (r.ok) {
                  toast("success", `Atlas is ${r.created ? "created" : "synced"} in ElevenLabs${r.tools ? ` with ${r.tools} tools` : ""}.`);
                  await load();
                } else toast("error", r.error ?? "Sync failed.");
              } catch (err) {
                toast("error", err instanceof Error ? err.message : "Sync failed.");
              }
            })
          }
        >
          Sync Atlas to ElevenLabs
        </Button>
        <Button icon={Rocket} onClick={() => setAtlasOpen(true)} disabled={!v.configured}>
          Talk to Atlas
        </Button>
        {status?.talkUrl ? (
          <a className="btn btn-ghost" href={status.talkUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden /> Open in ElevenLabs
          </a>
        ) : null}
      </div>
    </Card>
  );
}

