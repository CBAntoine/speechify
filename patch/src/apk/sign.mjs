// Signing Android apps the way Android checks them, with Node's own crypto:
//  - a self-signed certificate for Patch's own app-signing key (made once, kept with Patch's secrets),
//  - JAR signing ("v1": META-INF/MANIFEST.MF, CERT.SF, CERT.RSA) for older TVs (Android 5 and 6),
//  - APK Signature Scheme v2 (a signing block before the ZIP's directory) for Android 7 and later.
// Every app Patch makes is signed with the same key, so a new version installs over the old one.
import crypto from "node:crypto";

// ── DER ────────────────────────────────────────────────────────────────────

const derLen = (n) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : n < 0x10000 ? Buffer.from([0x82, n >> 8, n & 0xff]) : Buffer.from([0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]));
const tlv = (tag, ...content) => {
  const c = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), derLen(c.length), c]);
};
const seq = (...c) => tlv(0x30, ...c);
const set = (...c) => tlv(0x31, ...c);
const nul = () => Buffer.from([0x05, 0x00]);
const octets = (b) => tlv(0x04, b);
const bitString = (b) => tlv(0x03, Buffer.from([0]), b);
const utf8String = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const explicit0 = (...c) => tlv(0xa0, ...c);
function integer(bytes) {
  let b = Buffer.from(bytes);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(dotted) {
  const p = dotted.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const stack = [n & 0x7f];
    for (let v = Math.floor(n / 128); v; v = Math.floor(v / 128)) stack.unshift(0x80 | (v & 0x7f));
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}
const utcTime = (d) => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`, "latin1"));

const OID = { sha256WithRsa: "1.2.840.113549.1.1.11", rsa: "1.2.840.113549.1.1.1", sha256: "2.16.840.1.101.3.4.2.1", commonName: "2.5.4.3", countryName: "2.5.4.6", organizationName: "2.5.4.10", signedData: "1.2.840.113549.1.7.2", data: "1.2.840.113549.1.7.1" };
const printableString = (s) => tlv(0x13, Buffer.from(s, "latin1"));
const algorithm = (o) => seq(oid(o), nul());

/** Read one DER element: { tag, start (of its content), end, next }. */
export function derRead(buf, at = 0) {
  const tag = buf[at];
  let len = buf[at + 1];
  let o = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[o + i];
    o += n;
  }
  return { tag, start: o, end: o + len, next: o + len, whole: buf.subarray(at, o + len) };
}

/** The elements directly inside a DER SEQUENCE/SET. */
export function derChildren(buf, el) {
  const out = [];
  for (let o = el.start; o < el.end; ) {
    const c = derRead(buf, o);
    out.push(c);
    o = c.next;
  }
  return out;
}

// ── Patch's signing key ────────────────────────────────────────────────────

/** A self-signed certificate (DER) for an RSA key: what app signing and Android's wireless debugging need. */
export function certificateFor(key, subject) {
  const privateKey = key instanceof crypto.KeyObject ? key : crypto.createPrivateKey(key);
  const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  // A name, or { C, O, CN } (as Android's adb makes its own: C=US, O=Android, CN=Adb).
  const parts = typeof subject === "string" ? { CN: subject } : subject;
  const name = seq(
    ...(parts.C ? [set(seq(oid(OID.countryName), printableString(parts.C)))] : []),
    ...(parts.O ? [set(seq(oid(OID.organizationName), utf8String(parts.O)))] : []),
    set(seq(oid(OID.commonName), utf8String(parts.CN))),
  );
  const serial = crypto.randomBytes(8);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  const tbs = seq(explicit0(integer([2])), integer(serial), algorithm(OID.sha256WithRsa), name, seq(utcTime(new Date(Date.now() - 86_400_000)), utcTime(new Date(Date.UTC(2049, 11, 31, 23, 59, 59)))), name, spki);
  return seq(tbs, algorithm(OID.sha256WithRsa), bitString(crypto.sign("sha256", tbs, privateKey)));
}

/** The same certificate as PEM text, the form TLS takes. */
export const certificatePem = (der) => `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;

/** A new 2048-bit RSA key and its self-signed certificate: { key (PEM), cert (base64 DER) }. */
export function newSigningKey(commonName = "Patch TV apps") {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 });
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }), cert: certificateFor(privateKey, commonName).toString("base64") };
}

/** The certificate's issuer and serial number (what a JAR signature names its signer by). */
function issuerAndSerial(certDer) {
  const cert = derRead(certDer);
  const tbs = derChildren(certDer, cert)[0];
  const parts = derChildren(certDer, tbs);
  const i = parts[0].tag === 0xa0 ? 1 : 0; // skip the version
  // tbs: serial, signature algorithm, issuer, …  →  IssuerAndSerialNumber ::= { issuer, serial }
  return seq(parts[i + 2].whole, parts[i].whole);
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const b64 = (b) => sha256(b).toString("base64");

// ── JAR signing (v1) ───────────────────────────────────────────────────────

/** Manifest lines are at most 72 bytes; longer ones continue on lines starting with a space. */
function manifestLine(text) {
  const b = Buffer.from(text, "utf8");
  if (b.length <= 72) return `${text}\r\n`;
  const out = [b.subarray(0, 72)];
  for (let o = 72; o < b.length; o += 71) out.push(Buffer.concat([Buffer.from(" "), b.subarray(o, o + 71)]));
  return `${out.map((x) => x.toString("utf8")).join("\r\n")}\r\n`;
}

export const isSignatureFile = (name) => /^META-INF\/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC)|SIG-[^/]*)$/i.test(name);

/**
 * JAR-sign the app's entries ([{ name, data }]): returns the three META-INF files to add.
 * "X-Android-APK-Signed: 2" tells newer Androids a v2 signature must also be there.
 */
export function signV1(entries, { key, cert }) {
  const certDer = Buffer.from(cert, "base64");
  let mf = "Manifest-Version: 1.0\r\nCreated-By: 1.0 (Patch)\r\n\r\n";
  let sfEntries = "";
  for (const e of entries) {
    if (isSignatureFile(e.name)) continue;
    const section = `${manifestLine(`Name: ${e.name}`)}SHA-256-Digest: ${b64(e.data)}\r\n\r\n`;
    mf += section;
    sfEntries += `${manifestLine(`Name: ${e.name}`)}SHA-256-Digest: ${b64(Buffer.from(section, "utf8"))}\r\n\r\n`;
  }
  const mfBytes = Buffer.from(mf, "utf8");
  const sf = Buffer.from(`Signature-Version: 1.0\r\nCreated-By: 1.0 (Patch)\r\nSHA-256-Digest-Manifest: ${b64(mfBytes)}\r\nX-Android-APK-Signed: 2\r\n\r\n${sfEntries}`, "utf8");
  const signature = crypto.sign("sha256", sf, key);
  const signerInfo = seq(integer([1]), issuerAndSerial(certDer), algorithm(OID.sha256), algorithm(OID.rsa), octets(signature));
  const signedData = seq(integer([1]), set(algorithm(OID.sha256)), seq(oid(OID.data)), explicit0(certDer), set(signerInfo));
  const pkcs7 = seq(oid(OID.signedData), explicit0(signedData));
  return [
    { name: "META-INF/MANIFEST.MF", data: mfBytes },
    { name: "META-INF/CERT.SF", data: sf },
    { name: "META-INF/CERT.RSA", data: pkcs7 },
  ];
}

// ── APK Signature Scheme v2 ────────────────────────────────────────────────

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const lp = (b) => Buffer.concat([u32(b.length), b]);

const V2_ID = 0x7109871a;
const RSA_PKCS1_SHA256 = 0x0103;
const MAGIC = Buffer.from("APK Sig Block 42", "latin1");

/** SHA-256 over 1 MB chunks of each section, as v2 defines it. */
export function chunkedDigest(sections) {
  const digests = [];
  for (const s of sections) {
    for (let o = 0; o < s.length; o += 1 << 20) {
      const c = s.subarray(o, o + (1 << 20));
      digests.push(crypto.createHash("sha256").update(Buffer.from([0xa5])).update(u32(c.length)).update(c).digest());
    }
  }
  return crypto.createHash("sha256").update(Buffer.from([0x5a])).update(u32(digests.length)).update(Buffer.concat(digests)).digest();
}

/** Add a v2 signature to a ZIP given as { body, cd, eocd } (writeZip's parts). Returns the APK. */
export function signV2({ body, cd, eocd }, { key, cert }) {
  const certDer = Buffer.from(cert, "base64");
  const publicKey = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
  const digest = chunkedDigest([body, cd, eocd]);
  const signedData = Buffer.concat([lp(lp(Buffer.concat([u32(RSA_PKCS1_SHA256), lp(digest)]))), lp(lp(certDer)), lp(Buffer.alloc(0))]);
  const signature = crypto.sign("sha256", signedData, key);
  const signer = Buffer.concat([lp(signedData), lp(lp(Buffer.concat([u32(RSA_PKCS1_SHA256), lp(signature)]))), lp(publicKey)]);
  const value = lp(lp(signer));
  const pair = Buffer.concat([u64(4 + value.length), u32(V2_ID), value]);
  const blockSize = pair.length + 8 + MAGIC.length;
  const block = Buffer.concat([u64(blockSize), pair, u64(blockSize), MAGIC]);
  const end = Buffer.from(eocd);
  end.writeUInt32LE(body.length + block.length, 16);
  return Buffer.concat([body, block, cd, end]);
}

// ── Checking (for Patch's tests, and to know an app file is intact) ───────

/** Checks an APK's v2 signature. Returns { ok, cert (base64) } or { ok: false, reason }. */
export function verifyV2(apk) {
  let eocd = -1;
  for (let i = apk.length - 22; i >= Math.max(0, apk.length - 0x10015); i--) if (apk.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { ok: false, reason: "not a zip" };
  const cdOffset = apk.readUInt32LE(eocd + 16);
  if (cdOffset < 32 || !apk.subarray(cdOffset - 16, cdOffset).equals(MAGIC)) return { ok: false, reason: "no signing block" };
  const size = Number(apk.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - size - 8;
  if (start < 0 || Number(apk.readBigUInt64LE(start)) !== size) return { ok: false, reason: "broken signing block" };
  let value = null;
  for (let p = start + 8; p < cdOffset - 24; ) {
    const len = Number(apk.readBigUInt64LE(p));
    if (apk.readUInt32LE(p + 8) === V2_ID) value = apk.subarray(p + 12, p + 8 + len);
    p += 8 + len;
  }
  if (!value) return { ok: false, reason: "no v2 signature" };
  const read = (b, o) => {
    const n = b.readUInt32LE(o);
    return [b.subarray(o + 4, o + 4 + n), o + 4 + n];
  };
  const [signers] = read(value, 0);
  const [signer] = read(signers, 0);
  let o = 0;
  let signedData, sigs, pub;
  [signedData, o] = read(signer, o);
  [sigs, o] = read(signer, o);
  [pub] = read(signer, o);
  const [firstSig] = read(sigs, 0);
  const algo = firstSig.readUInt32LE(0);
  const [sig] = read(firstSig, 4);
  const publicKey = crypto.createPublicKey({ key: pub, format: "der", type: "spki" });
  if (algo !== RSA_PKCS1_SHA256 || !crypto.verify("sha256", signedData, publicKey, sig)) return { ok: false, reason: "signature doesn't match" };
  let q = 0;
  let digests, certs;
  [digests, q] = read(signedData, q);
  [certs] = read(signedData, q);
  const [firstDigest] = read(digests, 0);
  const [digest] = read(firstDigest, 4);
  const [cert] = read(certs, 0);
  const end = Buffer.from(apk.subarray(eocd));
  end.writeUInt32LE(start, 16);
  const actual = chunkedDigest([apk.subarray(0, start), apk.subarray(cdOffset, eocd), end]);
  if (!actual.equals(digest)) return { ok: false, reason: "contents changed after signing" };
  const certKey = new crypto.X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  if (!certKey.equals(pub)) return { ok: false, reason: "certificate doesn't match the key" };
  return { ok: true, cert: cert.toString("base64") };
}

/** Checks a v1 (JAR) signature over the given entries ([{ name, data }]). */
export function verifyV1(entries) {
  const get = (n) => entries.find((e) => e.name === n)?.data;
  const mf = get("META-INF/MANIFEST.MF");
  const sf = get("META-INF/CERT.SF");
  const rsa = get("META-INF/CERT.RSA");
  if (!mf || !sf || !rsa) return { ok: false, reason: "missing signature files" };
  const sfText = sf.toString("utf8");
  if (!sfText.includes(`SHA-256-Digest-Manifest: ${b64(mf)}`)) return { ok: false, reason: "manifest digest" };
  const mfText = mf.toString("utf8").replace(/\r\n /g, "");
  for (const e of entries) {
    if (isSignatureFile(e.name)) continue;
    if (!mfText.includes(`Name: ${e.name}\r\nSHA-256-Digest: ${b64(e.data)}\r\n`)) return { ok: false, reason: `digest of ${e.name}` };
  }
  // PKCS#7: ContentInfo → [0] → SignedData → certificates [0], signerInfos SET → encryptedDigest.
  const [, content] = derChildren(rsa, derRead(rsa));
  const sdParts = derChildren(rsa, derChildren(rsa, content)[0]);
  const cert = derChildren(rsa, sdParts.find((p) => p.tag === 0xa0))[0].whole;
  const signerInfo = derChildren(rsa, sdParts.at(-1))[0];
  // The signer is named by { issuer (a Name, a SEQUENCE), serial (an INTEGER) }, in that order.
  const named = derChildren(rsa, derChildren(rsa, signerInfo)[1]);
  if (named[0]?.tag !== 0x30 || named[1]?.tag !== 0x02) return { ok: false, reason: "the signer isn't named by issuer and serial number" };
  const encrypted = derChildren(rsa, signerInfo).at(-1);
  const ok = crypto.verify("sha256", sf, new crypto.X509Certificate(cert).publicKey, rsa.subarray(encrypted.start, encrypted.end));
  return ok ? { ok: true, cert: cert.toString("base64") } : { ok: false, reason: "signature doesn't match" };
}
