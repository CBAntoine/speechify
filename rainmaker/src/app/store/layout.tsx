import type { Metadata } from "next";
import Link from "next/link";
import { StoreClient } from "@/components/store/StoreClient";
import { TalkButton } from "@/components/store/parts";
import { getStoreView } from "@/lib/store-view";
import "./store.css";

// The public sales storefront. Branded with the agency's own name (from
// Settings), never ElevenLabs': products are the agency's services.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const v = await getStoreView();
  const title = `${v.brand.name}: AI receptionists, voice and ads, done for you`;
  return {
    title: { default: title, template: `%s · ${v.brand.name}` },
    description: v.settings.subheadline,
    applicationName: v.brand.name,
    robots: { index: v.settings.enabled, follow: true },
    openGraph: { title, description: v.settings.subheadline, type: "website", siteName: v.brand.name },
  };
}

function initials(name: string): string {
  const w = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "AI").slice(0, 2)).toUpperCase();
}

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const v = await getStoreView();
  const year = new Date().getFullYear();
  return (
    <div className="store">
      <StoreClient view={v}>
        {v.payments.testMode && <div className="store-test-banner">Test mode: checkouts use Stripe or PayPal test accounts, so no real money moves.</div>}
        <header className="store-header">
          <div className="store-wrap">
            <Link href="/store" className="store-logo" aria-label={`${v.brand.name} home`}>
              <span className="store-logo-mark">{initials(v.brand.name)}</span>
              <span className="truncate">{v.brand.name}</span>
            </Link>
            <nav className="store-nav" aria-label="Store">
              <a href="/store#plans">Plans</a>
              <a href="/store#services">Services</a>
              <a href="/store#how">How it works</a>
              <a href="/store#compare">Compare</a>
              <a href="/store#faq">FAQ</a>
            </nav>
            <span className="spacer" />
            <TalkButton mode="voice" label="Talk to AI" className="btn btn-talk hide-sm" />
            <a className="btn primary" href="/store#plans">
              Get started
            </a>
          </div>
        </header>

        <main>{children}</main>

        <footer className="store-footer">
          <div className="store-wrap">
            <div>
              <div className="store-logo" style={{ marginBottom: 10 }}>
                <span className="store-logo-mark">{initials(v.brand.name)}</span>
                {v.brand.name}
              </div>
              <p style={{ margin: 0, maxWidth: 380, lineHeight: 1.55 }}>
                Done-for-you AI phone agents, voice, video and ads for {v.brand.city ? `businesses in ${v.brand.city} and beyond` : "local businesses"}.
              </p>
            </div>
            <div>
              <h4>Contact</h4>
              <ul>
                {v.brand.email && (
                  <li>
                    <a href={`mailto:${v.brand.email}`}>{v.brand.email}</a>
                  </li>
                )}
                {v.brand.phone && (
                  <li>
                    <a href={`tel:${v.brand.phone.replace(/[^\d+]/g, "")}`}>{v.brand.phone}</a>
                  </li>
                )}
                {v.brand.calendarUrl && (
                  <li>
                    <a href={v.brand.calendarUrl} target="_blank" rel="noopener">
                      Book a call
                    </a>
                  </li>
                )}
                {v.brand.mailingAddress && <li>{v.brand.mailingAddress}</li>}
              </ul>
            </div>
            <div>
              <h4>Company</h4>
              <ul>
                <li>
                  <Link href="/store/terms">Terms & refunds</Link>
                </li>
                <li>
                  <Link href="/store/privacy">Privacy</Link>
                </li>
                <li>
                  <Link href="/login">Team sign in</Link>
                </li>
              </ul>
            </div>
            <div className="legal">
              © {year} {v.brand.name}. Prices in {v.settings.currency.toUpperCase()}, before tax.
              {v.settings.showEngine &&
                ` Our voice products are built on ElevenLabs technology. ElevenLabs is a trademark of ElevenLabs Inc.; ${v.brand.name} is an independent agency, not affiliated with or endorsed by ElevenLabs.`}{" "}
              GoHighLevel is a trademark of HighLevel Inc.
            </div>
          </div>
        </footer>
      </StoreClient>
    </div>
  );
}
