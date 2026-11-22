import { Check, PhoneCall, Sparkles } from "lucide-react";
import { AskButton, PlanCards, ProductCatalog, TalkButton } from "@/components/store/parts";
import { dollars } from "@/lib/catalog";
import { getStoreView } from "@/lib/store-view";

export const dynamic = "force-dynamic";

/** "*words*" in the headline setting become the gradient highlight. */
function Headline({ text }: { text: string }) {
  const parts = text.split("*");
  return <>{parts.map((p, i) => (i % 2 ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}</>;
}

function ExampleCall() {
  return (
    <div className="call-card" aria-label="Example call with an AI receptionist">
      <div className="call-card-head">
        <span className="offer-icon">
          <PhoneCall size={20} />
        </span>
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
          <Check size={16} /> Booking request and call summary sent to the front desk
        </div>
      </div>
      <div className="call-note">Illustration of a typical call. Talk to our assistant to hear the real thing.</div>
    </div>
  );
}

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
              <Sparkles size={14} /> {v.settings.showEngine ? "Done-for-you AI, built on ElevenLabs voices" : "Done-for-you AI for local businesses"}
            </span>
            <h1 className="store-h1">
              <Headline text={v.settings.headline} />
            </h1>
            <p className="store-lede">{v.settings.subheadline}</p>
            <div className="store-cta-row">
              <TalkButton mode="voice" />
              <TalkButton mode="text" className="btn xl" />
              <a className={`btn xl ${v.assistant ? "" : "primary"}`} href="#plans">
                Plans from {dollars(plansFrom, { currency: c })}/mo
              </a>
              {!v.assistant && v.brand.calendarUrl && (
                <a className="btn xl" href={v.brand.calendarUrl} target="_blank" rel="noopener">
                  Book a call
                </a>
              )}
            </div>
            <div className="store-trust">
              <span>
                <Check size={16} /> Answers 24/7
              </span>
              <span>
                <Check size={16} /> 90+ languages
              </span>
              <span>
                <Check size={16} /> Live in days
              </span>
              <span>
                <Check size={16} /> No contracts
              </span>
            </div>
          </div>
          <ExampleCall />
        </div>
      </section>

      <section className="store-section alt" id="plans">
        <div className="store-wrap">
          <PlanCards />
        </div>
      </section>

      <section className="store-section" id="services">
        <div className="store-wrap">
          <div className="store-kicker">Services</div>
          <h2 className="store-h2">{v.settings.showEngine ? "Every ElevenLabs-powered service, done for you" : "Every service, done for you"}</h2>
          <p className="store-sub">
            Need just one thing? Every service is available on its own, built and run by us. Not sure which fits?{" "}
            {v.assistant ? `Ask ${v.settings.assistantName}: it knows every product in detail.` : "Book a call and we'll tell you."}
          </p>
          <ProductCatalog />
        </div>
      </section>

      <section className="store-section alt" id="how">
        <div className="store-wrap">
          <div className="store-kicker">How it works</div>
          <h2 className="store-h2">You talk to us for 20 minutes. We do the rest.</h2>
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
          <div className="store-kicker">Compare</div>
          <h2 className="store-h2">Better than doing it yourself</h2>
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

      <section className="store-section alt" id="faq">
        <div className="store-wrap">
          <div className="store-kicker">FAQ</div>
          <h2 className="store-h2">Questions, answered</h2>
          <div className="faq">
            {FAQS(v.brand.name, v.settings.showEngine).map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <AskButton text="I have a question that isn't in the FAQ." label="Ask something else" />
          </div>
        </div>
      </section>

      <section className="store-section">
        <div className="store-wrap">
          <div className="cta-band">
            <div>
              <h2>{v.assistant ? "Hear it for yourself" : "Ready when you are"}</h2>
              <p>{v.assistant ? "Talk to our AI assistant right now, by voice or text. It'll explain anything and get you started." : "Pick a plan and we'll have your AI live within days."}</p>
            </div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <TalkButton mode="voice" label="Start talking" className="btn xl" />
              {!v.assistant && (
                <a className="btn xl" href="#plans">
                  See plans
                </a>
              )}
              {v.brand.calendarUrl && (
                <a className="btn xl ghost-light" href={v.brand.calendarUrl} target="_blank" rel="noopener">
                  Book a call
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
