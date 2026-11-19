export type Confidence = "confirmed" | "reported" | "theory";
export type Placement = "exact" | "approximate" | "unplaced";
export type CategoryId = "easter-egg" | "secret" | "collectible" | "wildlife" | "story" | "service" | "tip";
export type RegionId = "vice-city" | "leonida-keys" | "grassrivers" | "port-gellhorn" | "ambrosia" | "mount-kalaga";
export type TipTopic = "money" | "police" | "combat" | "exploration" | "vehicles" | "settings" | "story";

export interface Source {
  label: string;
  url: string;
  date?: string;
}

export interface Region {
  id: RegionId;
  name: string;
  short: string;
  tagline: string;
  description: string[];
  color: string;
  /** Label position as [lng, lat]. */
  label: [number, number];
  labelAnchor: "start" | "middle" | "end";
  confidence: Confidence;
  sources: Source[];
}

export interface MapLocation {
  id: string;
  name: string;
  category: CategoryId;
  region: RegionId | null;
  confidence: Confidence;
  placement: Placement;
  /** Position on the real-world stand-in map (WGS84). */
  lng?: number;
  lat?: number;
  /** Search-zone radius in kilometres, for approximate placements. */
  radiusKm?: number;
  area?: string;
  summary: string;
  details: string[];
  steps?: string[];
  requirements?: string[];
  tags?: string[];
  spoiler?: boolean;
  sources: Source[];
  addedAt: string;
  updatedAt?: string;
}

export interface Tip {
  id: string;
  title: string;
  body: string;
  topic: TipTopic;
  confidence: Confidence;
  locationId?: string;
  sources: Source[];
  addedAt: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary?: string;
  tags: string[];
}

export interface DailyBrief {
  date: string;
  headline: string;
  bullets: { text: string; url?: string }[];
  model?: string;
}

export interface NewsFile {
  updatedAt: string;
  brief?: DailyBrief;
  items: NewsItem[];
}

export interface GearItem {
  id: string;
  name: string;
  blurb: string;
  query: string;
  badge?: string;
}
