// Makes a throwaway self-signed TLS certificate in memory (for the simulated Chromecast), so no
// private key ever needs to live in the repository and no openssl install is needed.
import crypto from "node:crypto";

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n) {
    b.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | b.length, ...b]);
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
function oid(s) {
  const parts = s.split(".").map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >> 7;
    while (v) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}
const utf8 = (s) => tlv(0x0c, Buffer.from(s));
const utc = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));
const bitstr = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));

export function selfSigned(cn = "patch-simulator") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const algo = seq(oid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256
  const name = seq(set(seq(oid("2.5.4.3"), utf8(cn))));
  const serial = crypto.randomBytes(8);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  const tbs = seq(tlv(0xa0, int(Buffer.from([2]))), int(serial), algo, name, seq(utc(new Date(Date.now() - 86_400_000)), utc(new Date(Date.now() + 3650 * 86_400_000))), name, spki);
  const cert = seq(tbs, algo, bitstr(crypto.sign("sha256", tbs, privateKey)));
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${cert.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}
