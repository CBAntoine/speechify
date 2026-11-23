import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/anton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clip Factory /18",
  description: "Turn a gameplay VOD with a facecam into captioned 9:16 shorts with 18 open-source repos, orchestrated by Claude.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b11",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
