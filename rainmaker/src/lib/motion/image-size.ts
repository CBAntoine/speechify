// The width and height of a PNG, JPEG, GIF or WebP from its first bytes, so
// we can warn about pictures too small for a sharp 4K render. Pure.

export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  const ok = (w: number, h: number) => (w > 0 && h > 0 && w < 100_000 && h < 100_000 ? { w, h } : undefined);
  if (b.length < 24) return undefined;
  // PNG: the IHDR chunk comes first.
  if (b[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") return ok(u32be(16), u32be(20));
  // GIF
  if (ascii(0, 3) === "GIF") return ok(u16le(6), u16le(8));
  // WebP: lossy, lossless or extended.
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8 " && b.length >= 30) return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (kind === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (kind === "VP8X" && b.length >= 30) return ok(u24le(24) + 1, u24le(27) + 1);
    return undefined;
  }
  // JPEG: walk the markers to the frame header (SOF0–SOF15, not DHT, JPG or DAC).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        i += m === 0xff ? 1 : 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(u16be(i + 7), u16be(i + 5));
      i += 2 + u16be(i + 2);
    }
  }
  return undefined;
}

/** Short side under this looks soft at 4K; under the lower bar, soft even at 1080p. */
export const SHARP_4K = 1500;
export const SHARP_HD = 700;

export function sharpness(img: { w?: number; h?: number }): "4k" | "hd" | "low" | "unknown" {
  if (!img.w || !img.h) return "unknown";
  const short = Math.min(img.w, img.h);
  return short >= SHARP_4K ? "4k" : short >= SHARP_HD ? "hd" : "low";
}

/** Logos are judged by their long side: a wide logo is naturally short. */
export function logoSharpness(img: { w?: number; h?: number }): "4k" | "hd" | "low" | "unknown" {
  if (!img.w || !img.h) return "unknown";
  const long = Math.max(img.w, img.h);
  return long >= 1000 ? "4k" : long >= 500 ? "hd" : "low";
}
