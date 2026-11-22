import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Assistant } from "@/components/store/Assistant";
import { leadByDemoToken } from "@/lib/elevenlabs/demo";
import { getProfile } from "@/lib/repo";
import "../../store/store.css";

// A prospect's private demo: the AI receptionist the agency built from their
// public website. Linked from outreach; never indexed.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your AI receptionist demo", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

export default async function DemoPage({ params }: Props) {
  const [lead, profile] = await Promise.all([leadByDemoToken((await params).token), getProfile()]);
  if (!lead?.demo) notFound();
  return (
    <div className="store">
      <header className="store-header">
        <div className="store-wrap">
          <span className="store-logo">
            <span className="store-logo-mark">AI</span>
            {profile.agencyName}
          </span>
          <span className="spacer" />
          <Link className="btn primary" href={`/store/launch?lead=${lead.id}`}>
            Get this for {lead.name.length > 28 ? "your business" : lead.name}
          </Link>
        </div>
      </header>
      <main className="demo-hero">
        <div className="store-wrap demo-card">
          <span className="store-eyebrow">Private demo for {lead.name}</span>
          <h1>Talk to the AI receptionist we built for {lead.name}</h1>
          <p>
            {profile.agencyName} trained it on your public website. Call it like a customer would: ask about your services, prices, hours or booking an appointment. The real
            version answers your phone line 24/7 and sends you a summary of every call.
          </p>
          <div className="demo-tips">
            <span>“Do you have anything open Saturday?”</span>
            <span>“How much is a first visit?”</span>
            <span>“Can I talk to a person?”</span>
          </div>
          <div style={{ width: "100%", marginTop: 8 }}>
            <Assistant variant="inline" demoToken={lead.demo.token} title={`${lead.name} receptionist`} subtitle="Demo · voice or chat · 5-minute calls" />
          </div>
          <p className="faint small" style={{ maxWidth: 520 }}>
            This demo isn't connected to your phone line or calendar, and it only knows what's on your website. Built by {profile.agencyName}
            {profile.phone ? ` · ${profile.phone}` : ""}
            {profile.email ? ` · ${profile.email}` : ""}.
          </p>
        </div>
      </main>
    </div>
  );
}
