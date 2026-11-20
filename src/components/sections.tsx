import Link from "next/link";
import { CONFIDENCE, GEAR, NEWS, TIPS, TIP_TOPICS, latestNews, locationById } from "@/lib/data";
import { hostOf, longDate, relativeDay } from "@/lib/format";
import { PUBLIC_CONFIG, SITE, amazonSearchUrl } from "@/lib/site";
import type { Tip } from "@/lib/types";
import { ConfidenceBadge } from "./Badges";
import { Icon } from "./icons";

export function SectionHead({ eyebrow, title, lede, id }: { eyebrow: string; title: React.ReactNode; lede?: string; id?: string }) {
  return (
    <header className="section__head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="section__title" id={id}>
        {title}
      </h2>
      {lede && <p className="section__lede">{lede}</p>}
    </header>
  );
}

export function DailyIntel({ limit = 6, showAll = true }: { limit?: number; showAll?: boolean }) {
  const brief = NEWS.brief;
  const items = latestNews(limit);
  return (
    <div className="intel">
      {brief && (
        <article className="brief">
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" /> Daily brief · {longDate(brief.date)}
          </p>
          <h3 className="brief__headline">{brief.headline}</h3>
          <ul className="brief__list">
            {brief.bullets.map((b, i) => (
              <li key={i}>
                {b.text}{" "}
                {b.url && (
                  <a href={b.url} target="_blank" rel="noopener noreferrer" className="brief__src">
                    {hostOf(b.url)}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="brief__foot">
            Updated automatically every day. Sources linked, summaries in our own words.
            {brief.model && brief.model !== "editor" ? " AI-drafted, editor-checked." : ""}
          </p>
        </article>
      )}
      <div className="news-grid">
        {items.map((n) => (
          <a key={n.id} className="news-card" href={n.url} target="_blank" rel="noopener noreferrer">
            <span className="news-card__meta">
              <span className="news-card__src">{n.source}</span>
              <span>{relativeDay(n.publishedAt)}</span>
            </span>
            <span className="news-card__title">{n.title}</span>
            {n.summary && <span className="news-card__sum">{n.summary}</span>}
            <span className="news-card__tags">
              {n.tags.slice(0, 2).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
              <Icon name="external" size={14} className="news-card__ext" />
            </span>
          </a>
        ))}
      </div>
      {showAll && (
        <p className="center">
          <Link className="btn btn--ghost" href="/news">
            All intel <Icon name="news" size={16} />
          </Link>
        </p>
      )}
    </div>
  );
}

export function TipCard({ tip }: { tip: Tip }) {
  const loc = tip.locationId ? locationById(tip.locationId) : undefined;
  return (
    <article className={`tip-card tip-card--${tip.confidence}`}>
      <header className="tip-card__head">
        <span className="tag">{TIP_TOPICS[tip.topic]}</span>
        <ConfidenceBadge value={tip.confidence} />
      </header>
      <h3 className="tip-card__title">{tip.title}</h3>
      <p className="tip-card__body">{tip.body}</p>
      <footer className="tip-card__foot">
        {loc && (
          <Link href={`/?loc=${loc.id}#map`} className="text-btn">
            <Icon name="map" size={14} /> On the map
          </Link>
        )}
        {tip.sources[0] ? (
          <a href={tip.sources[0].url} target="_blank" rel="noopener noreferrer" className="tip-card__src">
            {hostOf(tip.sources[0].url)}
          </a>
        ) : (
          <span className="tip-card__src">Neon Atlas inference</span>
        )}
      </footer>
    </article>
  );
}

export function TipsGrid({ limit }: { limit?: number }) {
  const rank = { confirmed: 0, reported: 1, theory: 2 } as const;
  const tips = [...TIPS].sort((a, b) => rank[a.confidence] - rank[b.confidence]).slice(0, limit ?? TIPS.length);
  return (
    <>
      <div className="legend">
        {(Object.keys(CONFIDENCE) as (keyof typeof CONFIDENCE)[]).map((c) => (
          <span key={c} className="legend__item">
            <ConfidenceBadge value={c} /> {CONFIDENCE[c].help}
          </span>
        ))}
      </div>
      <div className="tips-grid">
        {tips.map((t) => (
          <TipCard key={t.id} tip={t} />
        ))}
      </div>
    </>
  );
}

export function HowItWorks() {
  const steps = [
    {
      icon: "mic" as const,
      title: "Ask out loud",
      body: `"Where's the egg nest?" "What's new today?" ${SITE.guideName} understands natural speech, or you can type.`,
    },
    {
      icon: "map" as const,
      title: "Watch the map move",
      body: `${SITE.guideName} flies the map, filters the pins and opens the guide for you while it talks you through it.`,
    },
    {
      icon: "check" as const,
      title: "Trust, but verify",
      body: "Every pin is labelled Confirmed, Reported or Theory and links its sources. No made-up secrets.",
    },
  ];
  return (
    <div className="how-grid">
      {steps.map((s, i) => (
        <article key={s.title} className="how-card">
          <span className="how-card__num">0{i + 1}</span>
          <Icon name={s.icon} size={26} />
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </article>
      ))}
    </div>
  );
}

export function GearGrid() {
  return (
    <>
      <div className="gear-grid">
        {GEAR.map((g) => (
          <a
            key={g.id}
            className="gear-card"
            href={amazonSearchUrl(g.query)}
            target="_blank"
            rel="sponsored noopener noreferrer"
          >
            {g.badge && <span className="tag">{g.badge}</span>}
            <strong>{g.name}</strong>
            <span>{g.blurb}</span>
            <span className="gear-card__cta">
              Check price <Icon name="external" size={14} />
            </span>
          </a>
        ))}
      </div>
      <p className="fine center">
        As an Amazon Associate {SITE.name} earns from qualifying purchases. Prices and availability change. Check before you buy.
      </p>
    </>
  );
}

const FREE_VOICE = Number(process.env.VOICE_FREE_SESSIONS_PER_DAY || 3);
const CREW_VOICE = Number(process.env.VOICE_CREW_SESSIONS_PER_DAY || 60);

export const CREW_PERKS = [
  `${CREW_VOICE} voice sessions a day with ${SITE.guideName} (free accounts get ${FREE_VOICE})`,
  "No ads, anywhere on the site",
  "Early access to fresh pins before they go public",
  "Your finds get a Crew badge and fast-track verification",
  "Support an independent, fact-checked guide",
];

export function CrewPassCard({ compact = false }: { compact?: boolean }) {
  const link = PUBLIC_CONFIG.stripePaymentLink;
  return (
    <div className={`crew-card ${compact ? "crew-card--compact" : ""}`}>
      <div className="crew-card__glow" aria-hidden="true" />
      <p className="eyebrow">
        <Icon name="crown" size={14} /> Crew Pass
      </p>
      <h3 className="crew-card__price">
        {PUBLIC_CONFIG.crewPassPrice.split("/")[0]}
        <small>/{PUBLIC_CONFIG.crewPassPrice.split("/")[1] || "mo"}</small>
      </h3>
      <ul className="crew-card__perks">
        {CREW_PERKS.map((p) => (
          <li key={p}>
            <Icon name="check" size={16} strokeWidth={2.2} /> {p}
          </li>
        ))}
      </ul>
      {link ? (
        <a className="btn btn--sunset btn--block" href={link} rel="noopener">
          Join the crew
        </a>
      ) : (
        <span className="btn btn--sunset btn--block is-disabled" aria-disabled="true">
          Memberships open soon
        </span>
      )}
      <p className="fine">Cancel anytime. Secure checkout by Stripe.</p>
      {!compact && (
        <p className="fine">
          Already a member on another device? <Link href="/crew-pass#restore">Restore your pass</Link>.
        </p>
      )}
    </div>
  );
}

export function Faq() {
  const qa: [string, string][] = [
    [
      "Is this the official GTA VI map?",
      `No. ${SITE.name} is an independent fan guide. The map is real-world Florida, street by street from OpenStreetMap, standing in for Leonida. We never copy Rockstar's in-game map, so pin positions are approximate until the community charts exact spots.`,
    ],
    [
      "How do you know a secret is real?",
      "Every pin carries a label. Confirmed means verified in-game by a reputable outlet or official source. Reported means players or guides claim it and we're checking. Theory is our inference about where to look. Sources are linked on every pin.",
    ],
    [
      `What can ${SITE.guideName} do?`,
      `${SITE.guideName} is a real-time voice guide. Ask about secrets, tips or today's news, and it controls the map as it answers: flying to pins, filtering categories and opening guides. It only uses the data on this site, so if something isn't charted yet, it tells you.`,
    ],
    [
      "How often is it updated?",
      "News and the daily brief refresh automatically every day. New pins go live as soon as they're verified, including community submissions.",
    ],
    ["Does it spoil the story?", "Story-related pins are marked as spoilers and stay blurred until you tap to reveal."],
  ];
  return (
    <div className="faq">
      {qa.map(([q, a]) => (
        <details key={q} className="faq__item">
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
