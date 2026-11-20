/** On Vercel, the project's production domain (no protocol), exposed at build time. */
const vercelHost = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;

/** Brand + public configuration. Everything a visitor's browser may see. */
export const SITE = {
  name: "GTA 6 Secrets Map",
  tagline: "The talking map of Leonida",
  description:
    "Interactive GTA 6 map with every secret and Easter egg, verified tips and tricks, daily GTA 6 news, and Sol, a voice guide you can talk to. Unofficial fan site.",
  guideName: "Sol",
  url: (process.env.NEXT_PUBLIC_SITE_URL || (vercelHost ? `https://${vercelHost}` : "http://localhost:3000")).replace(/\/$/, ""),
  disclaimer:
    "GTA 6 Secrets Map is an unofficial fan site. It is not affiliated with, endorsed or sponsored by Rockstar Games or Take-Two Interactive. Grand Theft Auto and related names are trademarks of their respective owners. The map shows real-world Florida (OpenStreetMap, Natural Earth) as a stand-in for Leonida; the in-game layout differs.",
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
