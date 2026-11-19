import type { Metadata } from "next";
import { DailyIntel, SectionHead } from "@/components/sections";
import AdSlot from "@/components/AdSlot";
import NewsletterForm from "@/components/NewsletterForm";
import { NEWS } from "@/lib/data";
import { longDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "GTA 6 news today: daily intel",
  description: "Every day's GTA VI news in one place, with a daily brief written in plain English and links to every source.",
  alternates: { canonical: "/news" },
};

export default function NewsPage() {
  return (
    <div className="page page--wide">
      <SectionHead
        eyebrow={`Updated ${longDate(NEWS.updatedAt)}`}
        title={
          <>
            Daily <span className="grad-text">intel</span>
          </>
        }
        lede="We scan the major gaming outlets every day for GTA VI stories, dedupe them, and write a short brief. Headlines link straight to the original reporting."
      />
      <DailyIntel limit={60} showAll={false} />
      <div style={{ marginTop: 40 }}>
        <AdSlot variant="inline" />
      </div>
      <div className="newsletter-block" style={{ marginTop: 32, maxWidth: 640 }}>
        <h3>Get it by email</h3>
        <p>The daily brief, every morning. No spam, one-click unsubscribe.</p>
        <NewsletterForm />
      </div>
    </div>
  );
}
