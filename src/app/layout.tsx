import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { SiteFooter, SiteHeader } from "@/components/chrome";
import { PUBLIC_CONFIG, SITE } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name}: GTA 6 Interactive Map, Secrets, Tips & Daily News (Unofficial)`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "GTA 6 map",
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
    title: `${SITE.name}: the talking map of Leonida`,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image", title: `${SITE.name}: the talking map of Leonida`, description: SITE.description },
  alternates: { canonical: "/" },
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
