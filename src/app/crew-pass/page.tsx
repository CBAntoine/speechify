import type { Metadata } from "next";
import { CREW_PERKS, CrewPassCard, SectionHead } from "@/components/sections";
import RestoreForm from "./RestoreForm";
import { PUBLIC_CONFIG, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Crew Pass: more Sol, no ads",
  description: `Support ${SITE.name} and get more voice time with ${SITE.guideName}, early pins and an ad-free site.`,
  alternates: { canonical: "/crew-pass" },
};

export default async function CrewPassPage({ searchParams }: { searchParams: Promise<{ restore?: string }> }) {
  const { restore } = await searchParams;
  return (
    <div className="page page--wide">
      {restore === "ok" && <p className="voice-notice">Crew Pass unlocked on this device. Welcome back.</p>}
      {restore === "expired" && (
        <p className="voice-notice voice-notice--error">That sign-in link expired. Request a fresh one below.</p>
      )}
      <div className="section--split" style={{ display: "grid", padding: 0 }}>
        <div>
          <SectionHead
            eyebrow="Membership"
            title={
              <>
                Join the <span className="grad-text">crew</span>
              </>
            }
            lede={`Voice AI isn't free to run. Every minute ${SITE.guideName} talks costs us real money. The free tier stays generous; Crew Pass is for people who use it every day, and it keeps the site independent.`}
          />
          <div className="prose">
            <h2>What you get</h2>
            <ul>
              {CREW_PERKS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <h2 id="restore">On a new device?</h2>
            <p>Enter the email you paid with and we&apos;ll send a one-time sign-in link.</p>
            <RestoreForm />
            {PUBLIC_CONFIG.stripePortalUrl && (
              <p>
                Manage or cancel your membership in the{" "}
                <a href={PUBLIC_CONFIG.stripePortalUrl} target="_blank" rel="noopener noreferrer">
                  billing portal
                </a>
                .
              </p>
            )}
          </div>
        </div>
        <CrewPassCard compact />
      </div>
    </div>
  );
}
