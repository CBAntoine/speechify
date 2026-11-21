import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import { ToastProvider } from "@/components/client";
import { INSTALL_CAPTURE_SCRIPT, PwaSetup } from "@/components/pwa";

export const metadata: Metadata = {
  title: { default: "Rainmaker", template: "%s · Rainmaker" },
  description: "Find local-business clients, run your pipeline and build tailored ads with Claude agents.",
  applicationName: "Rainmaker",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Rainmaker", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <PwaSetup />
      </body>
    </html>
  );
}
