import type { Metadata } from "next";
import { getStoreView } from "@/lib/store-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const v = await getStoreView();
  const n = v.brand.name;
  const contact = v.brand.email || v.brand.phone || "the contact details on our website";
  return (
    <article className="narrow">
      <h1>Privacy policy</h1>
      <p>This explains what {n} collects through this website and the services we run for you, and what we do with it.</p>

      <h2>What we collect</h2>
      <ul>
        <li>Details you give us: your name, business, email, phone, website and what you're interested in, including when you talk to our AI assistant.</li>
        <li>Conversations with our AI assistant on this site (voice is converted to text so the assistant can answer).</li>
        <li>For customers: your business information, and the calls, chats and recordings your AI services handle, so we can run and improve them.</li>
        <li>Payment details are entered with Stripe or PayPal directly. We never see or store your full card number.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To answer your questions, follow up when you ask us to, and provide the services you buy.</li>
        <li>To bill you and keep records the law requires.</li>
        <li>We don't sell your information.</li>
      </ul>

      <h2>Who processes it for us</h2>
      <p>
        We use trusted providers to run our services: ElevenLabs (voice AI and conversations), Anthropic (AI writing), Stripe and PayPal (payments), our email provider, and our hosting and database providers. They process data on our behalf under their own security and privacy terms.
      </p>

      <h2>How long we keep it</h2>
      <p>We keep enquiries for up to two years, and customer records for as long as you're a customer plus what tax and accounting rules require. Ask us to delete your information anytime.</p>

      <h2>Your choices</h2>
      <p>
        You can ask to see, correct or delete your information, or tell us to stop contacting you, at {contact}. Every marketing email we send includes a way to opt out.
      </p>
    </article>
  );
}
