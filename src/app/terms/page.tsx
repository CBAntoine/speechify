import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of use", alternates: { canonical: "/terms" } };

export default function Terms() {
  return (
    <article className="page">
      <h1>Terms of use</h1>
      <div className="prose" style={{ marginTop: 24 }}>
        <p className="fine">Template: review with your own counsel before launch.</p>
        <p>{SITE.disclaimer}</p>
        <h2>The guide</h2>
        <p>
          Content is provided for entertainment and informational purposes. Game details change with patches; labels like
          &quot;Reported&quot; and &quot;Theory&quot; mean exactly that. AI-generated answers from {SITE.guideName} may be wrong.
        </p>
        <h2>Acceptable use</h2>
        <p>
          Don&apos;t abuse the voice guide (automated access, attempts to extract or overload the service), submit false finds,
          or post anything unlawful. We may limit or end access for abuse.
        </p>
        <h2>Crew Pass</h2>
        <p>
          Memberships renew automatically until cancelled. You can cancel at any time and keep your perks until the end of
          the paid period. Daily voice allowances are fair-use limits and may change with notice.
        </p>
        <h2>Submissions</h2>
        <p>
          By submitting a find you grant us a non-exclusive licence to publish it, with credit if you provide a name.
        </p>
        <h2>Links and affiliates</h2>
        <p>
          We link to third-party sites and may earn commission from qualifying purchases. We&apos;re not responsible for
          third-party content.
        </p>
      </div>
    </article>
  );
}
