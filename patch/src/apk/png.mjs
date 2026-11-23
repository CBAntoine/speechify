// A tiny PNG writer, for TV app icons and banners when none was drawn by the dashboard: a soft
// two-colour gradient with the app's first letter.
import zlib from "node:zlib";
import { crc32 } from "./zip.mjs";

/** RGBA pixels (width × height × 4 bytes) → PNG bytes. */
export function encodePng(width, height, rgba) {
  const row = width * 4;
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (row + 1) + 1, y * row, y * row + row);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// 5×7 capital letters and digits.
const FONT = {
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01110100011000010000100001000101110",
  D: "11110100011000110001100011000111110", E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111", H: "10001100011000111111100011000110001", I: "01110001000010000100001000010001110",
  J: "00111000100001000010000101001001100", K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001", N: "10001110011010110011100011000110001", O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000", Q: "01110100011000110001101011001001101", R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100", U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100", W: "10001100011000110101101011010101010", X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111", 0: "01110100011001110101110011000101110",
  1: "00100011000010000100001000010001110", 2: "01110100010000100010001000100011111", 3: "11110000010000101110000010000111110",
  4: "00010001100101010010111110001000010", 5: "11111100001111000001000011000101110", 6: "00110010001000011110100011000101110",
  7: "11111000010001000100010000100001000", 8: "01110100011000101110100011000101110", 9: "01110100011000101111000010001001100",
};

const hex = (c) => {
  const m = String(c || "").match(/^#?([0-9a-f]{6})$/i);
  const n = parseInt(m ? m[1] : "5b6cff", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * A plain picture for an app: diagonal gradient from `color` to a darker shade, the first letter
 * of `name` in white in the middle. Used for both the icon (square) and the TV banner (16:9).
 */
export function letterImage(width, height, { name = "", color = "#5b6cff" } = {}) {
  const [r, g, b] = hex(color);
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      const k = 1 - 0.45 * t;
      const o = (y * width + x) * 4;
      px[o] = r * k;
      px[o + 1] = g * k;
      px[o + 2] = b * k;
      px[o + 3] = 255;
    }
  }
  const letter = (String(name).toUpperCase().match(/[A-Z0-9]/) || ["P"])[0];
  const glyph = FONT[letter];
  const cell = Math.floor(Math.min(width / 9, height / 11));
  const left = Math.floor((width - cell * 5) / 2);
  const top = Math.floor((height - cell * 7) / 2);
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (glyph[gy * 5 + gx] !== "1") continue;
      for (let y = top + gy * cell; y < top + (gy + 1) * cell; y++) {
        for (let x = left + gx * cell; x < left + (gx + 1) * cell; x++) {
          const o = (y * width + x) * 4;
          px[o] = px[o + 1] = px[o + 2] = 255;
        }
      }
    }
  }
  return encodePng(width, height, px);
}
