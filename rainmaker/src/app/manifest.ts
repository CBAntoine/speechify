import type { MetadataRoute } from "next";

// Makes Rainmaker installable: on Android, Chrome offers "Install app" and it
// opens full screen from its own icon. share_target puts Rainmaker in the
// share sheet, so you can send a business from Google Maps or Chrome to it.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Rainmaker",
    short_name: "Rainmaker",
    description: "Find local-business clients, run your pipeline and build tailored ads with Claude agents.",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f2",
    theme_color: "#2f49c4",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Find clients", short_name: "Find", url: "/prospects?source=shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Pipeline", url: "/pipeline?source=shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Inbox", url: "/inbox?source=shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Ad Studio", short_name: "Ads", url: "/ads?source=shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
