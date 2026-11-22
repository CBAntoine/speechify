import { Check, PhoneCall } from "lucide-react";
import { AskButton, CtaBand, PlanCards, ProductCatalog, Showcase, TalkButton } from "@/components/store/parts";
import { dollars } from "@/lib/catalog";
import { getStoreView } from "@/lib/store-view";

export const dynamic = "force-dynamic";

/** "*words*" in the headline setting are set in the lighter second tone. */
function Headline({ text }: { text: string }) {
  const parts = text.split("*");
  return <>{parts.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}</>;
}

function ExampleCall() {
  return (
    <div className="call-card" aria-label="Example call with an AI receptionist">
      <div className="call-card-head">
        <span className="orb tone-lagoon" aria-hidden />
        <div>
          <b>Incoming call · Bright Smile Dental</b>
          <small>Saturday, 7:42 pm · office closed</small>
        </div>
        <span className="call-live">
          <i /> AI answering
        </span>
      </div>
      <div className="bubble-row caller">
        <div className="say">Hi, do you have anything this Saturday for a cleaning?</div>
      </div>
      <div className="bubble-row ai">
        <div className="say">We do! I can offer 10:30 or 1:15 this Saturday. Which works better for you?</div>
      </div>
      <div className="bubble-row caller">
        <div className="say">10:30, please.</div>
      </div>
      <div className="bubble-row ai">
        <div className="say">You're booked for 10:30. Can I get a phone number for the confirmation text?</div>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="bars" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="call-summary" style={{ flex: 1 }}>
          <Check size={16} aria-hidden /> Booking request and call summary sent to the front desk
        </div>
      </div>
      <div className="call-note">Illustration of a typical call. Talk to our assistant to hear the real thing.</div>
    </div>
  );
}

const LANGS = ["English", "Español", "Français", "Deutsch", "Português", "中文", "हिन्दी", "العربية", "Tagalog", "Tiếng Việt", "한국어", "Italiano"];

const FAQS = (agency: string, showEngine: boolean) => [
  { q: "Do I need any technical skills?", a: `No. ${agency} sets everything up, connects it to your phone line and website, and keeps it running. Your part is a short kickoff call and approving what we build.` },
  { q: "Is there a contract?", a: "No long-term contract. Monthly plans can be cancelled anytime and stop at the end of the billing period. Yearly plans cost 10 months' price for 12." },
  { q: "Will callers know they're talking to AI?", a: "Yes. Your agent introduces itself as a virtual assistant, and hands callers to a person whenever they ask. Being upfront keeps your customers' trust." },
  { q: "Can you use my existing phone number?", a: "Yes. We forward your current number to the AI (always, after hours, or only when you're busy), or set up a new local number." },
  { q: "Who owns the voiceovers, videos and ads you make?", a: "You do. Everything we make for your business is yours to use, with commercial rights." },
  { q: "How do payments work?", a: "Pay securely by card (processed by Stripe) or with PayPal. To change your plan or cancel, contact us anytime; PayPal subscriptions can also be cancelled from your PayPal account." },
  { q: "What happens to my customers' data?", a: "Calls and chats are processed by our AI providers only to run your service. We never sell data. See our privacy policy for details." },
  ...(showEngine
    ? [{ q: "Is this ElevenLabs?", a: `Our voice products are built on ElevenLabs, the leading AI voice technology. ${agency} is an independent agency: we design, build and run the AI for your business, and you deal with us.` }]
    : []),
];

export default async function StorePage() {
  const v = await getStoreView();
  const c = v.settings.currency;
  const from = Math.min(...v.products.map((p) => p.price));
  const plansFrom = v.plans.length ? Math.min(...v.plans.map((p) => p.price)) : from;

  if (!v.settings.enabled) {
    return (
      <div className="narrow">
        <h1>We're updating our services</h1>
        <p>Check back soon{v.brand.email ? `, or email ${v.brand.email}` : ""}.</p>
      </div>
    );
  }

  return (
    <>
      <section className="store-hero">
        <div className="store-wrap store-hero-grid">
          <div>
            <span className="store-eyebrow">
              <span className="orb idle tone-lagoon" aria-hidden /> {v.settings.showEngine ? "Done-for-you AI, built on ElevenLabs voices" : "Done-for-you AI for local businesses"}
            </span>
            <h1 className="store-h1">
              <Headline text={v.settings.headline} />
            </h1>
            <div className="store-cta-row">
              {v.assistant ? (
                <>
                  <TalkButton mode="voice" className="btn btn-talk lg" />
                  <TalkButton mode="text" className="btn lg" />
                </>
              ) : (
                <>
                  <a className="btn primary lg" href="#plans">
                    See plans
                  </a>
                  {v.brand.calendarUrl && (
                    <a className="btn lg" href={v.brand.calendarUrl} target="_blank" rel="noopener">
                      Book a call
                    </a>
                  )}
                </>
              )}
            </div>
          </div>
          <div>
            <p className="store-lede">{v.settings.subheadline}</p>
            <div className="store-trust">
              <span>
                <Check size={15} aria-hidden /> Answers 24/7
              </span>
              <span>
                <Check size={15} aria-hidden /> 90+ languages
              </span>
              <span>
                <Check size={15} aria-hidden /> Live in days
              </span>
              <span>
                <Check size={15} aria-hidden /> Plans from {dollars(plansFrom, { currency: c })}/mo
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="showcase-wrap">
        <Showcase />
      </div>

      <section className="store-section" id="why">
        <div className="store-wrap">
          <h2 className="store-h2">
            One AI team for every customer conversation. <em>Built, run and improved for you.</em>
          </h2>
          <div className="bento">
            <div className="bento-card wide">
              <h3 className="store-h3">Answers every call, day and night</h3>
              <p>Your AI receptionist picks up on the first ring, books appointments, answers questions and sends you a summary of every call.</p>
              <div className="bento-visual">
                <ExampleCall />
              </div>
            </div>
            <div className="bento-card">
              <h3 className="store-h3">Meets customers where they are</h3>
              <p>Phone, website chat and WhatsApp, with the same knowledge of your business on every channel.</p>
              <div className="bento-visual">
                <div style={{ display: "grid", placeItems: "center" }}>
                  <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
                    <span className="orb xl tone-aqua" aria-hidden />
                    <span className="orb-play" style={{ cursor: "default" }} aria-hidden>
                      <PhoneCall size={22} />
                    </span>
                  </div>
                  <div className="channel-pills" aria-label="Channels">
                    <span>Voice</span>
                    <span>Chat</span>
                    <span>WhatsApp</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="bento-card">
              <h3 className="store-h3">Speaks your customers' language</h3>
              <p>Agents, voiceovers and dubbing in 90+ languages. Callers are answered in the language they speak.</p>
              <div className="bento-visual">
                <div className="lang-cloud">
                  {LANGS.map((l) => (
                    <span key={l}>{l}</span>
                  ))}
                  <span className="more">and 80 more</span>
                </div>
              </div>
            </div>
            <div className="bento-card wide">
              <h3 className="store-h3">Marketing that makes itself</h3>
              <p>Ads written for your business every month, with custom art in your brand colours, voiceovers and short videos.</p>
              <div className="bento-visual">
                <div className="ad-mock" aria-label="Example ad">
                  <div className="art grain-card" />
                  <div className="copy">
                    <small>Sponsored · Bright Smile Dental</small>
                    <b>Saturday cleanings, booked in seconds</b>
                    <span>Call any time: we always pick up. New patients welcome.</span>
                    <i>Book now</i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="store-section" id="plans">
        <div className="store-wrap">
          <PlanCards />
        </div>
      </section>

      <section className="store-section" id="services">
        <div className="store-wrap">
          <div className="store-kicker">
            <span className="orb idle tone-lagoon" aria-hidden /> Services
          </div>
          <h2 className="store-h2">
            Every service, done for you. <em>Buy just the one you need.</em>
          </h2>
          <p className="store-sub">
            Every service is available on its own, built and run by us.{" "}
            {v.assistant ? `Not sure which fits? Ask ${v.settings.assistantName}: it knows every product in detail.` : "Not sure which fits? Book a call and we'll tell you."}
          </p>
          <div style={{ marginTop: 28 }}>
            <ProductCatalog />
          </div>
        </div>
      </section>

      <section className="store-section" id="how">
        <div className="store-wrap">
          <h2 className="store-h2">
            You talk to us for 20 minutes. <em>We do the rest.</em>
          </h2>
          <div className="steps-3">
            {[
              ["Tell us about your business", "Pick a plan or a service, then a 20-minute kickoff call: your services, prices, hours and goals. That's all the work you do."],
              ["We build, train and test it", "We train your AI on your website, pick or design its voice, write your ads and make your art. You approve everything before it goes live."],
              ["It runs. We keep improving it.", "Your AI answers, follows up and markets around the clock. Every month we review the results and tune it."],
            ].map(([h, p], i) => (
              <div className="step-card" key={h}>
                <div className="step-num">{i + 1}</div>
                <h3>{h}</h3>
                <p>{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="store-section" id="compare">
        <div className="store-wrap">
          <h2 className="store-h2">
            Better than doing it yourself. <em>Faster than hiring.</em>
          </h2>
          <p className="store-sub">Software like GoHighLevel gives you the tools and leaves the building to you. We build it, run it and keep it improving.</p>
          <div className="compare-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th />
                  <th>Hiring a receptionist</th>
                  <th>DIY software (e.g. GoHighLevel)</th>
                  <th className="us">{v.brand.name}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Monthly cost</th>
                  <td>$3,000+ in wages for one full-time person</td>
                  <td>$97–$497 for the software, plus AI add-ons ($50–$97 per account) and usage</td>
                  <td className="us">Plans from {dollars(plansFrom, { currency: c })}/mo, single services from {dollars(from, { currency: c })}/mo, all done for you</td>
                </tr>
                <tr>
                  <th>Who sets it up</th>
                  <td>You hire and train them</td>
                  <td>You, or a freelancer you pay</td>
                  <td className="us">We build, launch and run it</td>
                </tr>
                <tr>
                  <th>Answers calls</th>
                  <td>Business hours, minus breaks and sick days</td>
                  <td>24/7, once you've built and tested it</td>
                  <td className="us">24/7 from launch day, in 90+ languages</td>
                </tr>
                <tr>
                  <th>Voice quality</th>
                  <td>Human</td>
                  <td>Depends on the voice tools you connect</td>
                  <td className="us">{v.settings.showEngine ? "ElevenLabs' most natural real-time voices" : "The most natural real-time AI voices"}</td>
                </tr>
                <tr>
                  <th>Ads, art and voiceovers</th>
                  <td>Not included</td>
                  <td>Templates; you make them</td>
                  <td className="us">Made for you every month (Growth and Scale)</td>
                </tr>
                <tr>
                  <th>Time to launch</th>
                  <td>Weeks to hire</td>
                  <td>Weeks of setup and learning</td>
                  <td className="us">Days</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="footnote">
            GoHighLevel list prices (gohighlevel.com/pricing, November 2026): Starter $97, Unlimited $297, Founder $497 per month; AI Employee $50–$97 per month per sub-account; phone, SMS and AI usage billed separately. Receptionist cost based on typical full-time wages.
          </p>
        </div>
      </section>

      <section className="store-section" id="faq">
        <div className="store-wrap faq-grid">
          <div>
            <h2 className="store-h2">
              Frequently <em>asked questions</em>
            </h2>
            <div className="faq-more">
              <AskButton text="I have a question that isn't in the FAQ." label="Ask something else" />
            </div>
          </div>
          <div className="faq">
            {FAQS(v.brand.name, v.settings.showEngine).map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="store-section cta">
        <div className="store-wrap">
          <CtaBand
            title={v.assistant ? "Hear it for yourself, right now." : "Your AI team, live within days."}
            text={v.assistant ? "Talk to our AI assistant by voice or text. It'll explain anything and get you started." : "Pick a plan and we'll handle the rest."}
          />
        </div>
      </section>
    </>
  );
}
