/** Brand + public configuration. Everything a visitor's browser may see. */
export const SITE = {
  name: "Neon Atlas",
  tagline: "The talking map of Leonida",
  description:
    "Unofficial GTA VI companion: an interactive map of secrets and Easter eggs, verified tips and tricks, a voice guide you can talk to, and news updated daily.",
  guideName: "Sol",
  url: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),
  disclaimer:
    "Neon Atlas is an unofficial fan site. It is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto and related names are trademarks of their respective owners. The map is an original illustration, not to scale.",
} as const;

export const PUBLIC_CONFIG = {
  adsenseClient: process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "",
  adsenseSlotInline: process.env.NEXT_PUBLIC_ADSENSE_SLOT_INLINE || "",
  adsenseSlotSidebar: process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR || "",
  amazonTag: process.env.NEXT_PUBLIC_AMAZON_TAG || "",
  stripePaymentLink: process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK || "",
  stripePortalUrl: process.env.NEXT_PUBLIC_STRIPE_PORTAL_URL || "",
  crewPassPrice: process.env.NEXT_PUBLIC_CREW_PASS_PRICE || "$4.99/mo",
} as const;

export function amazonSearchUrl(query: string): string {
  const params = new URLSearchParams({ k: query });
  if (PUBLIC_CONFIG.amazonTag) params.set("tag", PUBLIC_CONFIG.amazonTag);
  return `https://www.amazon.com/s?${params.toString()}`;
}
