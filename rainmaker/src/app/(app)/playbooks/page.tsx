import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lightbulb, MessageSquareQuote } from "lucide-react";
import { DynIcon, PageHead } from "@/components/ui";
import { NICHES } from "@/lib/niches";
import { COMPLAINTS, PLAYBOOKS } from "@/lib/playbooks";

export const metadata: Metadata = { title: "Playbooks" };

export default function PlaybooksPage() {
  return (
    <div className="page">
      <PageHead
        title="Playbooks"
        sub="How small agencies actually land local clients, from agency surveys and practitioner reports. Each play links to the screen that does it for you."
      />

      <div className="tip neutral" style={{ marginBottom: 18 }}>
        <Lightbulb size={15} />
        <span>
          Rule of thumb for every first message: <b>one real observation → what it costs them → one small free next step</b>. Keep it short, follow up three times, and never claim results you haven&apos;t had.
        </span>
      </div>

      <div className="plays">
        {PLAYBOOKS.map((p) => (
          <article key={p.id} className="card play">
            <div>
              <span className="badge brand">{p.tag}</span>
              <h3 style={{ marginTop: 10 }}>{p.title}</h3>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {p.why}
            </p>
            <ol>
              {p.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {p.script && (
              <div className="tip neutral" style={{ fontSize: 12.5 }}>
                <MessageSquareQuote size={15} />
                <span>{p.script}</span>
              </div>
            )}
            <div className="evidence">
              {p.own && <span className="faint">From your playbook. Check the numbers against your own trials.</span>}
              {p.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                  {s.text}
                </a>
              ))}
            </div>
            <Link href={p.action.href} className="btn sm" style={{ marginTop: "auto", width: "fit-content" }}>
              {p.action.label} <ArrowRight size={14} />
            </Link>
          </article>
        ))}
      </div>

      <h2 className="display" style={{ margin: "34px 0 6px", fontSize: 22 }}>
        Niche cheat sheets
      </h2>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        What a customer is worth to them, offers that convert, and where to advertise. Rough planning numbers with sources.
      </p>
      <div className="plays">
        {NICHES.map((n) => (
          <article key={n.id} className="card play">
            <div className="row" style={{ gap: 10 }}>
              <span className="icon-tile">
                <DynIcon name={n.icon} size={15} />
              </span>
              <h3>{n.label}</h3>
            </div>
            {n.tip && <p style={{ margin: 0 }}>{n.tip}</p>}
            <dl className="kv">
              <dt>Customer worth</dt>
              <dd>{n.customerValue}</dd>
              <dt>Typical retainer</dt>
              <dd>{n.retainer}</dd>
              <dt>Channels</dt>
              <dd>{n.channels.join(", ")}</dd>
              <dt>Offers</dt>
              <dd>{n.offers.join(" · ")}</dd>
            </dl>
            {n.evidence && (
              <div className="evidence">
                {n.evidence.map((e) => (
                  <a key={e.url} href={e.url} target="_blank" rel="noreferrer">
                    {e.text}
                  </a>
                ))}
              </div>
            )}
            <Link href={`/prospects?${new URLSearchParams({ niche: n.id })}`} className="btn sm" style={{ marginTop: "auto", width: "fit-content" }}>
              Find {n.plural} <ArrowRight size={14} />
            </Link>
          </article>
        ))}
      </div>

      <h2 className="display" style={{ margin: "34px 0 6px", fontSize: 22 }}>
        Built around what agencies complain about
      </h2>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        The most common complaints about all-in-one agency platforms (GoHighLevel reviews and its public feature board), and what Rainmaker does instead.
      </p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table className="compare">
          <thead>
            <tr>
              <th style={{ width: "45%" }}>What people complain about</th>
              <th>What Rainmaker does</th>
            </tr>
          </thead>
          <tbody>
            {COMPLAINTS.map((c) => (
              <tr key={c.complaint}>
                <td>
                  {c.complaint}{" "}
                  <a href={c.url} target="_blank" rel="noreferrer" className="faint small" style={{ textDecoration: "underline" }}>
                    source
                  </a>
                </td>
                <td>{c.answer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
