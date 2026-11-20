import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { ToastProvider } from "@/components/client";
import { integrations } from "@/lib/config";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Rainmaker", template: "%s · Rainmaker" },
  description: "Find local-business clients, run your pipeline and build tailored ads with Claude agents.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const db = await readDb();
  const i = integrations();
  const inbox = db.drafts.filter((d) => d.status === "pending").length;
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <div className="app">
            <Sidebar inbox={inbox} claude={i.claude} runtime={i.agentRuntime} agencyName={db.profile.agencyName} />
            <main className="main">{children}</main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
