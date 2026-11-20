import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/chrome";
import { PUBLIC_CONFIG, SITE } from "@/lib/site";

// Leads with the phrases people search for; the brand itself is the head keyword.
const HOME_TITLE = `${SITE.name}: Interactive Map, Easter Eggs, Tips & News`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: HOME_TITLE,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "GTA 6 map",
    "GTA 6 secrets map",
    "GTA 6 interactive map",
    "GTA VI interactive map",
    "GTA 6 secrets",
    "GTA 6 easter eggs",
    "GTA 6 tips",
    "Leonida map",
    "Vice City map",
    "GTA 6 news",
  ],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: HOME_TITLE,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image", title: HOME_TITLE, description: SITE.description },
  alternates: { canonical: "/" },
  // Paste the codes Google Search Console / Bing Webmaster Tools give you (HTML-tag method).
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } } : {}),
  },
};

export const viewport: Viewport = {
  themeColor: "#07070d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        {PUBLIC_CONFIG.adsenseClient && (
          <Script
            id="adsense"
            async
            strategy="afterInteractive"
            crossOrigin="anonymous"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBLIC_CONFIG.adsenseClient}`}
          />
        )}
      </body>
    </html>
  );
}
