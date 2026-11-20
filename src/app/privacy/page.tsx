import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };

export default function Privacy() {
  return (
    <article className="page">
      <h1>Privacy policy</h1>
      <div className="prose" style={{ marginTop: 24 }}>
        <p className="fine">Template: review with your own counsel before launch.</p>
        <p>
          This policy explains what {SITE.name} collects and why. We collect as little as we can to run the site.
        </p>
        <h2>Voice guide</h2>
        <p>
          When you talk to {SITE.guideName}, your microphone audio and the conversation transcript are processed by our voice
          AI provider, ElevenLabs, to generate responses. Conversations may be retained by the provider under its own policy for
          quality and abuse prevention. We don&apos;t use your voice to identify you. Don&apos;t share personal information in a
          conversation.
        </p>
        <h2>Cookies</h2>
        <ul>
          <li>
            <strong>Essential:</strong> a signed cookie that counts your daily voice sessions, and, if you&apos;re a member, a
            signed Crew Pass cookie.
          </li>
          <li>
            <strong>Advertising:</strong> if ads are enabled, Google AdSense may use cookies to serve and measure ads. You can
            manage ad personalisation in your Google settings. Where required, we&apos;ll ask for consent first.
          </li>
          <li>
            <strong>Visitor statistics:</strong> we count page views with Vercel Web Analytics, which uses no cookies and
            doesn&apos;t identify you across sites.
          </li>
          <li>
            <strong>Affiliate links:</strong> retailers such as Amazon may set cookies when you click a product link, so they
            can attribute purchases to us.
          </li>
        </ul>
        <h2>Email</h2>
        <p>
          If you subscribe to the daily brief or restore a membership, we store your email with our email provider (Resend).
          Every email has a one-click unsubscribe link.
        </p>
        <h2>Payments</h2>
        <p>Crew Pass payments are handled by Stripe. We never see or store your card details.</p>
        <h2>Community submissions</h2>
        <p>
          Finds you submit, including any credit name and proof link, are stored as review tickets and may be published on the
          site.
        </p>
        <h2>Your rights</h2>
        <p>
          You can ask us to access or delete data associated with your email at any time. Contact details are on our About
          page.
        </p>
      </div>
    </article>
  );
}
