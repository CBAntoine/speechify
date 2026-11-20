// Turning the model codes devices announce into the names people know: "iPhone15,2" → "iPhone 14
// Pro", "AFTKA" → "Fire TV Stick 4K Max". Codes that aren't listed fall back to the product family.

const APPLE = {
  // iPhone
  "iPhone10,1": "iPhone 8", "iPhone10,4": "iPhone 8", "iPhone10,2": "iPhone 8 Plus", "iPhone10,5": "iPhone 8 Plus", "iPhone10,3": "iPhone X", "iPhone10,6": "iPhone X",
  "iPhone11,2": "iPhone XS", "iPhone11,4": "iPhone XS Max", "iPhone11,6": "iPhone XS Max", "iPhone11,8": "iPhone XR",
  "iPhone12,1": "iPhone 11", "iPhone12,3": "iPhone 11 Pro", "iPhone12,5": "iPhone 11 Pro Max", "iPhone12,8": "iPhone SE (2nd generation)",
  "iPhone13,1": "iPhone 12 mini", "iPhone13,2": "iPhone 12", "iPhone13,3": "iPhone 12 Pro", "iPhone13,4": "iPhone 12 Pro Max",
  "iPhone14,4": "iPhone 13 mini", "iPhone14,5": "iPhone 13", "iPhone14,2": "iPhone 13 Pro", "iPhone14,3": "iPhone 13 Pro Max", "iPhone14,6": "iPhone SE (3rd generation)",
  "iPhone14,7": "iPhone 14", "iPhone14,8": "iPhone 14 Plus", "iPhone15,2": "iPhone 14 Pro", "iPhone15,3": "iPhone 14 Pro Max",
  "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus", "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
  "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max", "iPhone17,5": "iPhone 16e",
  // iPad
  "iPad7,11": "iPad (7th generation)", "iPad7,12": "iPad (7th generation)", "iPad11,6": "iPad (8th generation)", "iPad11,7": "iPad (8th generation)",
  "iPad12,1": "iPad (9th generation)", "iPad12,2": "iPad (9th generation)", "iPad13,18": "iPad (10th generation)", "iPad13,19": "iPad (10th generation)",
  "iPad11,1": "iPad mini (5th generation)", "iPad11,2": "iPad mini (5th generation)", "iPad14,1": "iPad mini (6th generation)", "iPad14,2": "iPad mini (6th generation)",
  "iPad11,3": "iPad Air (3rd generation)", "iPad11,4": "iPad Air (3rd generation)", "iPad13,1": "iPad Air (4th generation)", "iPad13,2": "iPad Air (4th generation)",
  "iPad13,16": "iPad Air (5th generation)", "iPad13,17": "iPad Air (5th generation)", "iPad14,8": "iPad Air 11-inch (M2)", "iPad14,9": "iPad Air 11-inch (M2)",
  "iPad14,10": "iPad Air 13-inch (M2)", "iPad14,11": "iPad Air 13-inch (M2)",
  "iPad13,4": "iPad Pro 11-inch (3rd generation)", "iPad13,5": "iPad Pro 11-inch (3rd generation)", "iPad13,6": "iPad Pro 11-inch (3rd generation)", "iPad13,7": "iPad Pro 11-inch (3rd generation)",
  "iPad13,8": "iPad Pro 12.9-inch (5th generation)", "iPad13,9": "iPad Pro 12.9-inch (5th generation)", "iPad13,10": "iPad Pro 12.9-inch (5th generation)", "iPad13,11": "iPad Pro 12.9-inch (5th generation)",
  "iPad14,3": "iPad Pro 11-inch (4th generation)", "iPad14,4": "iPad Pro 11-inch (4th generation)", "iPad14,5": "iPad Pro 12.9-inch (6th generation)", "iPad14,6": "iPad Pro 12.9-inch (6th generation)",
  "iPad16,3": "iPad Pro 11-inch (M4)", "iPad16,4": "iPad Pro 11-inch (M4)", "iPad16,5": "iPad Pro 13-inch (M4)", "iPad16,6": "iPad Pro 13-inch (M4)",
  // Apple TV and HomePod
  "AppleTV5,3": "Apple TV HD", "AppleTV6,2": "Apple TV 4K (1st generation)", "AppleTV11,1": "Apple TV 4K (2nd generation)", "AppleTV14,1": "Apple TV 4K (3rd generation)",
  "AudioAccessory1,1": "HomePod", "AudioAccessory1,2": "HomePod", "AudioAccessory5,1": "HomePod mini", "AudioAccessory6,1": "HomePod (2nd generation)",
  // Macs
  "MacBookAir10,1": "MacBook Air (M1, 2020)", "Mac14,2": "MacBook Air 13-inch (M2, 2022)", "Mac14,15": "MacBook Air 15-inch (M2, 2023)",
  "Mac15,12": "MacBook Air 13-inch (M3, 2024)", "Mac15,13": "MacBook Air 15-inch (M3, 2024)", "Mac16,12": "MacBook Air 13-inch (M4, 2025)", "Mac16,13": "MacBook Air 15-inch (M4, 2025)",
  "MacBookPro17,1": "MacBook Pro 13-inch (M1, 2020)", "MacBookPro18,1": "MacBook Pro 16-inch (2021)", "MacBookPro18,2": "MacBook Pro 16-inch (2021)",
  "MacBookPro18,3": "MacBook Pro 14-inch (2021)", "MacBookPro18,4": "MacBook Pro 14-inch (2021)", "Mac14,7": "MacBook Pro 13-inch (M2, 2022)",
  "Mac14,5": "MacBook Pro 14-inch (2023)", "Mac14,9": "MacBook Pro 14-inch (2023)", "Mac14,6": "MacBook Pro 16-inch (2023)", "Mac14,10": "MacBook Pro 16-inch (2023)",
  "Mac15,3": "MacBook Pro 14-inch (M3, 2023)", "Mac15,6": "MacBook Pro 14-inch (M3 Pro/Max, 2023)", "Mac15,8": "MacBook Pro 14-inch (M3 Pro/Max, 2023)", "Mac15,10": "MacBook Pro 14-inch (M3 Pro/Max, 2023)",
  "Mac15,7": "MacBook Pro 16-inch (M3 Pro/Max, 2023)", "Mac15,9": "MacBook Pro 16-inch (M3 Pro/Max, 2023)", "Mac15,11": "MacBook Pro 16-inch (M3 Pro/Max, 2023)",
  "Mac16,1": "MacBook Pro 14-inch (M4, 2024)", "Mac16,6": "MacBook Pro 14-inch (M4 Pro/Max, 2024)", "Mac16,8": "MacBook Pro 14-inch (M4 Pro/Max, 2024)",
  "Mac16,5": "MacBook Pro 16-inch (M4 Pro/Max, 2024)", "Mac16,7": "MacBook Pro 16-inch (M4 Pro/Max, 2024)",
  "Macmini9,1": "Mac mini (M1, 2020)", "Mac14,3": "Mac mini (M2, 2023)", "Mac14,12": "Mac mini (M2 Pro, 2023)", "Mac16,10": "Mac mini (M4, 2024)", "Mac16,11": "Mac mini (M4 Pro, 2024)",
  "iMac21,1": "iMac 24-inch (M1, 2021)", "iMac21,2": "iMac 24-inch (M1, 2021)", "Mac15,4": "iMac 24-inch (M3, 2023)", "Mac15,5": "iMac 24-inch (M3, 2023)", "Mac16,2": "iMac 24-inch (M4, 2024)", "Mac16,3": "iMac 24-inch (M4, 2024)",
  "Mac13,1": "Mac Studio (2022)", "Mac13,2": "Mac Studio (2022)", "Mac14,13": "Mac Studio (2023)", "Mac14,14": "Mac Studio (2023)", "Mac14,8": "Mac Pro (2023)",
};

const APPLE_FAMILY = [
  [/^iPhone/, "iPhone", "phone"], [/^iPad/, "iPad", "tablet"], [/^AppleTV/, "Apple TV", "streamer"], [/^AudioAccessory/, "HomePod", "speaker"],
  [/^Watch/, "Apple Watch", "watch"], [/^MacBookAir/, "MacBook Air", "computer"], [/^MacBookPro/, "MacBook Pro", "computer"], [/^MacBook/, "MacBook", "computer"],
  [/^iMac/, "iMac", "computer"], [/^Macmini/, "Mac mini", "computer"], [/^MacPro/, "Mac Pro", "computer"], [/^Mac\d/, "Mac", "computer"],
  [/^(TimeCapsule|AirPort)/, "AirPort base station", "network"],
];

/** "iPhone15,2" → { name: "iPhone 14 Pro", kind: "phone", exact: true } (or the family when unlisted). */
export function appleModel(code) {
  const c = String(code || "").trim();
  const fam = APPLE_FAMILY.find(([re]) => re.test(c));
  if (!fam) return null;
  const name = Object.hasOwn(APPLE, c) ? APPLE[c] : null;
  return { name: name || fam[1], kind: fam[2], exact: !!name, code: c };
}

const FIRE_TV = {
  AFTB: "Fire TV (1st generation)", AFTS: "Fire TV (2nd generation)", AFTN: "Fire TV (3rd generation)", AFTM: "Fire TV Stick (1st generation)",
  AFTT: "Fire TV Stick (2nd generation)", AFTSSS: "Fire TV Stick (3rd generation)", AFTSS: "Fire TV Stick Lite", AFTMM: "Fire TV Stick 4K",
  AFTKA: "Fire TV Stick 4K Max", AFTKM: "Fire TV Stick 4K (2nd generation)", AFTKRT: "Fire TV Stick 4K Max (2nd generation)", AFTA: "Fire TV Cube (1st generation)",
  AFTR: "Fire TV Cube (2nd generation)", AFTGAZL: "Fire TV Cube (3rd generation)",
};

/** "AFTKA" → { name: "Fire TV Stick 4K Max", kind: "streamer" }; unknown AFT… codes are usually Fire TV Edition TVs. */
export function fireTvModel(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^AFT/.test(c)) return null;
  if (Object.hasOwn(FIRE_TV, c)) return { name: FIRE_TV[c], kind: "streamer", exact: true, code: c };
  return { name: "Fire TV (built into a TV)", kind: "tv", exact: false, code: c };
}

/** Spotify Connect's deviceType values. */
export const SPOTIFY_TYPES = { SPEAKER: "speaker", TV: "tv", AVR: "speaker", STB: "streamer", AUDIO_DONGLE: "speaker", GAME_CONSOLE: "console", CAST_VIDEO: "streamer", CAST_AUDIO: "speaker", COMPUTER: "computer", SMARTPHONE: "phone", TABLET: "tablet", AUTOMOBILE: "unknown", SMARTWATCH: "watch" };
