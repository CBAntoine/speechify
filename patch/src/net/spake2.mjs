// SPAKE2 over edwards25519, done exactly the way BoringSSL does it (crypto/curve25519/spake25519.cc),
// because that's what Android's Wireless debugging uses to check the six-digit pairing code: each
// side proves it knows the code without sending it, and both end up with the same secret key.
//
// Plain BigInt arithmetic, no tables: pairing happens once per device, so speed doesn't matter.
import crypto from "node:crypto";

const P = 2n ** 255n - 19n;
/** The order of the prime-order subgroup ("l"). */
export const L = 2n ** 252n + 27742317777372353535851937790883648493n;

const mod = (a, m = P) => {
  const r = a % m;
  return r < 0n ? r + m : r;
};
function pow(b, e, m = P) {
  let r = 1n;
  b = mod(b, m);
  for (; e > 0n; e >>= 1n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
  }
  return r;
}
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const D2 = mod(2n * D);
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

export const leToBig = (b) => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
};
const bigToLe = (n, len = 32) => {
  const out = Buffer.alloc(len);
  for (let i = 0; i < len; i++, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
};

// Points in extended coordinates: x = X/Z, y = Y/Z, x·y = T/Z.
const ZERO = { X: 0n, Y: 1n, Z: 1n, T: 0n };

/** a + b (the unified formula, which also doubles: complete for this curve). */
export function add(a, b) {
  const A = mod((a.Y - a.X) * (b.Y - b.X));
  const B = mod((a.Y + a.X) * (b.Y + b.X));
  const C = mod(a.T * D2 * b.T);
  const DD = mod(a.Z * 2n * b.Z);
  const E = B - A;
  const F = DD - C;
  const G = DD + C;
  const H = B + A;
  return { X: mod(E * F), Y: mod(G * H), Z: mod(F * G), T: mod(E * H) };
}
export const negate = (p) => ({ X: mod(-p.X), Y: p.Y, Z: p.Z, T: mod(-p.T) });

/** k·p, for any k ≥ 0 (the whole number, not reduced: some of SPAKE2's points aren't in the prime-order group). */
export function multiply(k, p) {
  let r = ZERO;
  for (let q = p; k > 0n; k >>= 1n, q = add(q, q)) if (k & 1n) r = add(r, q);
  return r;
}

/** The usual 32-byte form: y, with the lowest bit of x in the top bit. */
export function encode(p) {
  const zi = inv(p.Z);
  const x = mod(p.X * zi);
  const out = bigToLe(mod(p.Y * zi));
  if (x & 1n) out[31] |= 0x80;
  return out;
}

/** The point a 32-byte form stands for, or null when it isn't on the curve. */
export function decode(bytes) {
  const b = Buffer.from(bytes);
  if (b.length !== 32) return null;
  const sign = b[31] >> 7;
  b[31] &= 0x7f;
  const y = mod(leToBig(b));
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  let x = mod(u * pow(v, 3n) * pow(u * pow(v, 7n), (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === mod(-u)) x = mod(x * SQRT_M1);
  else if (vx2 !== u) return null;
  if (x === 0n && sign) return null;
  if (Number(x & 1n) !== sign) x = mod(-x);
  return { X: x, Y: y, Z: 1n, T: mod(x * y) };
}

export const BASE = decode(Buffer.from("5866666666666666666666666666666666666666666666666666666666666666", "hex"));
// BoringSSL's two fixed points, each found by hashing a seed until it lands on the curve
// ("edwards25519 point generation seed (M)" and "(N)"); the tests check them against its tables.
export const M = decode(Buffer.from("5ada7e4bf6ddd9adb6626d32131c6b5c51a1e347a3478f53cfcf441b88eed12e", "hex"));
export const N = decode(Buffer.from("10e3df0ae37d8e7a99b5fe74b44672103dbddcbd06af680d71329a11693bc778", "hex"));

const sha512 = (b) => crypto.createHash("sha512").update(b).digest();

/**
 * One side of a SPAKE2 exchange. "alice" is the side that pairs (Patch), "bob" the side that shows
 * the code (the device). Names are the exact bytes both sides use (Android's end in a NUL).
 */
export class Spake2 {
  constructor(role, myName, theirName) {
    if (role !== "alice" && role !== "bob") throw new Error("role must be alice or bob");
    this.role = role;
    this.myName = Buffer.from(myName);
    this.theirName = Buffer.from(theirName);
  }

  /** The 32-byte message to send. `random` (64 bytes) is only given by tests. */
  generateMessage(password, random = crypto.randomBytes(64)) {
    // A random scalar, times eight (the cofactor) so the other side's small-order part drops out.
    this.privateKey = (leToBig(random) % L) * 8n;
    this.passwordHash = sha512(Buffer.from(password));
    // BoringSSL makes the password's scalar a multiple of eight by adding l, 2l and 4l as needed:
    // the same point in the prime-order group, and exactly what the other side computes.
    let s = leToBig(this.passwordHash) % L;
    if (s & 1n) s += L;
    if (s & 2n) s += 2n * L;
    if (s & 4n) s += 4n * L;
    this.passwordScalar = s;
    const mask = multiply(s, this.role === "alice" ? M : N);
    this.myMessage = encode(add(multiply(this.privateKey, BASE), mask));
    return this.myMessage;
  }

  /** The other side's message → the shared 64-byte key. Throws if it isn't a point on the curve. */
  processMessage(theirMessage) {
    const theirs = Buffer.from(theirMessage);
    const star = theirs.length === 32 ? decode(theirs) : null;
    if (!star) throw new Error("The other side's pairing message wasn't valid.");
    const theirMask = multiply(this.passwordScalar, this.role === "alice" ? N : M);
    const shared = encode(multiply(this.privateKey, add(star, negate(theirMask))));
    const h = crypto.createHash("sha512");
    const part = (b) => {
      const len = Buffer.alloc(8);
      len.writeBigUInt64LE(BigInt(b.length));
      h.update(len);
      h.update(b);
    };
    if (this.role === "alice") [this.myName, this.theirName, this.myMessage, theirs].forEach(part);
    else [this.theirName, this.myName, theirs, this.myMessage].forEach(part);
    part(shared);
    part(this.passwordHash);
    return h.digest();
  }
}
