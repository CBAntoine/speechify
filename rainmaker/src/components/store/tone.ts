// Which gradient palette (tone-* classes in globals.css) an offer's orb uses.
// Each category has its own family of colours, and products within it get
// different shades, so the store reads as one system.

const FAMILY: Record<string, string[]> = {
  agents: ["lagoon", "sky", "aqua"],
  content: ["ember", "peach", "dawn", "rose", "mocha"],
  business: ["mist", "pearl"],
  marketing: ["iris", "candy"],
  plans: ["sky", "ember", "iris"],
};

const PLAN_TONE: Record<string, string> = { "plan-launch": "sky", "plan-growth": "ember", "plan-scale": "iris" };

/** The first tone of a category: its dot on tabs. */
export function categoryTone(category: string): string {
  return `tone-${(FAMILY[category] ?? FAMILY.agents)[0]}`;
}

/** A stable tone for one offer, from its category family. */
export function toneOf(offer: { id: string; category: string }, index?: number): string {
  if (PLAN_TONE[offer.id]) return `tone-${PLAN_TONE[offer.id]}`;
  const family = FAMILY[offer.category] ?? FAMILY.agents;
  let i = index;
  if (i === undefined) {
    let h = 0;
    for (const ch of offer.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    i = h;
  }
  return `tone-${family[i % family.length]}`;
}
