import type { FontPairId, IconName, PaletteId, VariantId } from "./types.ts";

// Runtime lists of the design-system ids, for the Builder's output schema.
// They must match the union types in types.ts (tests check the renderer
// knows every one).

export const PALETTE_IDS = ["harbor", "clinic", "forest", "ember", "citrus", "blush", "slate", "gold", "terracotta", "sky"] as const satisfies readonly PaletteId[];
export const FONT_PAIR_IDS = ["modern", "editorial", "friendly", "strong", "elegant", "geometric"] as const satisfies readonly FontPairId[];
export const VARIANT_IDS = ["bold", "classic", "fresh"] as const satisfies readonly VariantId[];
export const ICON_NAMES = [
  "tooth", "heart", "shield", "star", "clock", "calendar", "phone", "map", "wrench", "bolt", "drop", "flame", "leaf", "home", "car",
  "scissors", "sparkle", "paw", "utensils", "coffee", "dumbbell", "briefcase", "scale", "check", "users", "sun", "snowflake", "hammer", "brush", "camera",
] as const satisfies readonly IconName[];
