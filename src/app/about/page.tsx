import type { Metadata } from "next";
import Link from "next/link";
import { CONFIDENCE } from "@/lib/data";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "How we verify",
  description: `How ${SITE.name} sources, labels and verifies every GTA VI secret, tip and news story.`,
  alternates: { canonical: "/about" },
};

export default function About() {
  return (
    <article className="page">
      <p className="eyebrow">About</p>
      <h1 style={{ marginTop: 10 }}>How we verify</h1>
      <div className="prose" style={{ marginTop: 24 }}>
        <p>
          {SITE.name} is an independent fan guide to Grand Theft Auto VI. We built it around one rule:{" "}
          <strong>never present a guess as a fact.</strong> Every pin and tip carries one of three labels:
        </p>
        <ul>
          {(Object.keys(CONFIDENCE) as (keyof typeof CONFIDENCE)[]).map((c) => (
            <li key={c}>
              <strong>{CONFIDENCE[c].label}:</strong> {CONFIDENCE[c].help}
            </li>
          ))}
        </ul>
        <h2>The map</h2>
        <p>
          Our map is an original illustration of Leonida, drawn from scratch and inspired by the real-world geography the game
          parodies. It is not Rockstar&apos;s map and it isn&apos;t to scale. Pins marked &quot;search zone&quot; show the area to
          look in; as the community confirms exact spots, we tighten them.
        </p>
        <h2>The voice guide</h2>
        <p>
          {SITE.guideName} is a conversational voice AI. It answers only from the data on this site and the day&apos;s news feed,
          and it says so when something hasn&apos;t been charted yet. It can still make mistakes, so check the sources linked on
          every pin.
        </p>
        <h2>Daily updates</h2>
        <p>
          Every morning an automated job collects GTA VI headlines from major gaming outlets, removes duplicates, and drafts a
          short brief in our own words with links back to the original reporting. Community submissions are reviewed by a
          human before they appear on the map.
        </p>
        <h2 id="advertise">Advertise or partner</h2>
        <p>
          Gaming hardware, peripherals and apps that GTA players actually want: we offer sponsored placements in the daily
          brief, on the map and across tip pages. Sponsored content is always labelled.
        </p>
        <h2>Corrections</h2>
        <p>
          Spotted something wrong? Use <Link href="/#map">Pin a find</Link> on the map to send us a correction with a source,
          and we&apos;ll fix it.
        </p>
        <p className="fine">{SITE.disclaimer}</p>
      </div>
    </article>
  );
}
