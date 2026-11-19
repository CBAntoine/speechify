import type { MetadataRoute } from "next";
import { LOCATIONS, NEWS, REGIONS } from "@/lib/data";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date(NEWS.updatedAt);
  const page = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "daily") => ({
    url: `${SITE.url}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });
  return [
    page("/", 1),
    page("/map", 0.9),
    page("/news", 0.9, "hourly"),
    page("/tips", 0.8),
    page("/crew-pass", 0.5, "weekly"),
    page("/about", 0.3, "monthly"),
    ...REGIONS.map((r) => page(`/regions/${r.id}`, 0.7)),
    ...LOCATIONS.map((l) => ({
      url: `${SITE.url}/locations/${l.id}`,
      lastModified: new Date(l.updatedAt ?? l.addedAt),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
