import type { Metadata } from "next";
import { ANNUAL_MONTHS } from "@/lib/catalog";
import { getStoreView } from "@/lib/store-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Terms & refunds" };

export default async function TermsPage() {
  const v = await getStoreView();
  const n = v.brand.name;
  const contact = v.brand.email || v.brand.phone || "the contact details on our website";
  return (
    <article className="narrow">
      <h1>Terms of service & refund policy</h1>
      <p>These terms apply when you buy a plan or service from {n} through this website.</p>

      <h2>What you're buying</h2>
      <p>
        {n} designs, builds and runs AI services for your business, such as AI phone and chat agents, voiceovers, dubbing, podcasts, music, ad creative and ad campaigns. Each product page lists what's included every month. Some services are built on third-party technology (for example ElevenLabs for voice, Stripe and PayPal for payments); you buy the service from {n}, not from those companies.
      </p>

      <h2>Billing</h2>
      <p>
        Plans renew automatically every month, or every year on yearly billing (yearly costs {ANNUAL_MONTHS} months' price for 12 months), until cancelled. One-time setup fees are charged with the first payment and may be waived on yearly billing where the store says so. Usage beyond what a plan includes, such as extra call minutes, is billed at the rate shown on the store and we tell you before it happens. Prices are in {v.settings.currency.toUpperCase()} and exclude applicable taxes.
      </p>

      <h2>Cancelling</h2>
      <p>
        You can cancel anytime by contacting us at {contact}. PayPal subscriptions can also be cancelled from your PayPal account. Cancellation stops future payments; your service keeps running until the end of the period you've paid for.
      </p>

      <h2>Refunds</h2>
      <ul>
        <li>If you cancel before we've started your setup, we refund the setup fee and the first payment in full.</li>
        <li>Once setup work has started, setup fees are non-refundable.</li>
        <li>Monthly and yearly fees already paid aren't refunded for partial periods, unless the law where you live says otherwise.</li>
        <li>If something we built doesn't work as described, tell us and we'll fix it promptly. If we can't, we'll refund that month.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Give us accurate information about your business; the AI answers from it.</li>
        <li>Outbound calls, texts and WhatsApp messages only go to people who agreed to hear from you. You're responsible for that consent.</li>
        <li>Voice cloning and AI likenesses need the written consent of the person whose voice or face is used.</li>
        <li>Don't use the services for anything illegal, deceptive or harmful, including impersonating real people.</li>
      </ul>

      <h2>AI and accuracy</h2>
      <p>
        AI agents identify themselves as virtual assistants. They answer from the information you approve, but can make mistakes: they don't give medical, legal or financial advice and aren't an emergency service. Review important outputs before relying on them.
      </p>

      <h2>Ownership</h2>
      <p>You own the voiceovers, videos, images, scripts and ads we make for your business. We may keep copies to provide and improve your service.</p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, {n}'s total liability for any claim is limited to the fees you paid in the three months before it arose, and we're not liable for indirect or consequential losses such as lost profits.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; changes apply from your next billing period and we'll tell you about material ones. Questions: {contact}
        {v.brand.mailingAddress ? `, or by mail at ${v.brand.mailingAddress}` : ""}. These terms are governed by the laws where {n} is based{v.brand.city ? ` (${v.brand.city})` : ""}.
      </p>
    </article>
  );
}
