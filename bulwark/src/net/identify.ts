// Turning the clues a device gives off (model codes, makers) into a name and a kind people recognise.

const APPLE: [RegExp, string, string][] = [
  [/^MacBookAir/i, "MacBook Air", "Computer"],
  [/^MacBookPro/i, "MacBook Pro", "Computer"],
  [/^MacBook/i, "MacBook", "Computer"],
  [/^iMac/i, "iMac", "Computer"],
  [/^Macmini/i, "Mac mini", "Computer"],
  [/^MacPro/i, "Mac Pro", "Computer"],
  [/^Mac\d/i, "Mac", "Computer"],
  [/^iPhone/i, "iPhone", "Phone or tablet"],
  [/^iPad/i, "iPad", "Phone or tablet"],
  [/^iPod/i, "iPod", "Phone or tablet"],
  [/^AppleTV/i, "Apple TV", "TV or streaming device"],
  [/^AudioAccessory/i, "HomePod", "Speaker"],
  [/^Watch/i, "Apple Watch", "Phone or tablet"],
  [/^RealityDevice/i, "Apple Vision Pro", "Phone or tablet"],
];

/** "MacBookPro18,3" → MacBook Pro, a computer. */
export function appleModel(code: string | undefined): { name: string; kind: string } | undefined {
  if (!code || !/^[A-Za-z]+\d+,\d+$/.test(code)) return undefined;
  const hit = APPLE.find(([re]) => re.test(code));
  return hit ? { name: hit[1], kind: hit[2] } : undefined;
}

/** macOS major version from the Darwin version Macs announce (osxvers=24 → macOS 15). */
export function macosFromDarwin(darwin: number): string | undefined {
  if (!Number.isInteger(darwin) || darwin < 10) return undefined;
  if (darwin >= 25) return String(darwin + 1); // Darwin 25 is macOS 26 (Tahoe): Apple jumped to year-based numbers.
  if (darwin >= 20) return String(darwin - 9); // Darwin 20 → macOS 11 (Big Sur) … Darwin 24 → macOS 15.
  return `10.${darwin - 4}`; // Darwin 19 → 10.15 (Catalina).
}
