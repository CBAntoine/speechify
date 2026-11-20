import MapExplorer from "@/components/map/MapExplorer";
import NewsTicker from "@/components/NewsTicker";
import AdSlot from "@/components/AdSlot";
import NewsletterForm from "@/components/NewsletterForm";
import GuideAutoOpen from "@/components/GuideAutoOpen";
import {
  CrewPassCard,
  DailyIntel,
  Faq,
  GearGrid,
  HowItWorks,
  SectionHead,
  TipsGrid,
} from "@/components/sections";
import { STATS } from "@/lib/data";
import { SITE } from "@/lib/site";
import { Icon } from "@/components/icons";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <MapExplorer variant="home" ticker={<NewsTicker className="explorer__ticker" />} />
      <a href="#intel-title" className="scroll-cue">
        News, tips &amp; more <Icon name="chevronDown" size={16} />
      </a>
      <GuideAutoOpen />

      <div className="stats-bar" aria-label="Map statistics">
        <div>
          <strong>{STATS.confirmed}</strong>
          <span>confirmed finds</span>
        </div>
        <div>
          <strong>{STATS.reported}</strong>
          <span>reports being verified</span>
        </div>
        <div>
          <strong>{STATS.theory}</strong>
          <span>theories to hunt</span>
        </div>
        <div>
          <strong>{STATS.tips}</strong>
          <span>tips &amp; tricks</span>
        </div>
        <div>
          <strong>Daily</strong>
          <span>auto-updated intel</span>
        </div>
      </div>

      <section className="section" aria-labelledby="intel-title">
        <SectionHead
          id="intel-title"
          eyebrow="Daily intel"
          title={
            <>
              Today in <span className="grad-text">Leonida</span>
            </>
          }
          lede="The day's GTA VI news in one place: patches, discoveries, deals and drama. Refreshed automatically every morning."
        />
        <DailyIntel limit={6} />
      </section>

      <div className="section section--tight">
        <AdSlot variant="inline" />
      </div>

      <section className="section" aria-labelledby="how-title">
        <SectionHead
          id="how-title"
          eyebrow={`Meet ${SITE.guideName}`}
          title={
            <>
              A guide you can <span className="grad-text">talk to</span>
            </>
          }
          lede={`${SITE.guideName} is a real-time voice AI wired into the map. Ask a question and watch it answer and fly you there.`}
        />
        <HowItWorks />
      </section>

      <section className="section" aria-labelledby="tips-title">
        <SectionHead
          id="tips-title"
          eyebrow="Tips & tricks"
          title={
            <>
              Play smarter <span className="grad-text">from hour one</span>
            </>
          }
          lede="Hands-on tips verified by outlets that have played the game, plus our own clearly labelled inferences."
        />
        <TipsGrid limit={9} />
        <p className="center">
          <Link className="btn btn--ghost" href="/tips">
            All {STATS.tips} tips
          </Link>
        </p>
      </section>

      <section className="section" aria-labelledby="gear-title">
        <SectionHead
          id="gear-title"
          eyebrow="Gear up"
          title="Kit for the trip to Leonida"
          lede="The game's install is huge and Vice City deserves good audio. A few things worth having."
        />
        <GearGrid />
      </section>

      <section className="section section--split" aria-labelledby="crew-title">
        <div>
          <SectionHead
            id="crew-title"
            eyebrow="Crew Pass"
            title={
              <>
                More {SITE.guideName}. <span className="grad-text">No ads.</span>
              </>
            }
            lede={`${SITE.name} is free and stays free. Crew Pass is for players who want more voice time, early pins and a cleaner site, and it keeps the lights on.`}
          />
          <div className="newsletter-block">
            <h3>Prefer email?</h3>
            <p>Get the daily Leonida brief: new secrets, verified tips and the day&apos;s news.</p>
            <NewsletterForm />
          </div>
        </div>
        <CrewPassCard />
      </section>

      <section className="section" aria-labelledby="faq-title">
        <SectionHead id="faq-title" eyebrow="FAQ" title="Straight answers" />
        <Faq />
      </section>
    </>
  );
}
