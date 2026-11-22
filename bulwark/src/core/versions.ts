// Version comparison. Uses dpkg's algorithm, which also orders upstream strings like
// "9.6p1", "1.0.1f" and "2019.78" the way their projects mean them.

function order(c: string | undefined): number {
  if (c === undefined || c === "") return 0;
  if (c >= "0" && c <= "9") return 0;
  if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z")) return c.charCodeAt(0);
  if (c === "~") return -1;
  return c.charCodeAt(0) + 256;
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

function verrevcmp(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    let firstDiff = 0;
    while ((i < a.length && !isDigit(a[i])) || (j < b.length && !isDigit(b[j]))) {
      const ac = order(a[i]);
      const bc = order(b[j]);
      if (ac !== bc) return ac - bc;
      i++;
      j++;
    }
    while (a[i] === "0") i++;
    while (b[j] === "0") j++;
    while (isDigit(a[i]) && isDigit(b[j])) {
      if (!firstDiff) firstDiff = a.charCodeAt(i) - b.charCodeAt(j);
      i++;
      j++;
    }
    if (isDigit(a[i])) return 1;
    if (isDigit(b[j])) return -1;
    if (firstDiff) return firstDiff;
  }
  return 0;
}

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Compares upstream versions: -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  return sign(verrevcmp(a, b));
}

function splitDebian(v: string): { epoch: number; upstream: string; revision: string } {
  let rest = v.trim();
  let epoch = 0;
  const colon = rest.indexOf(":");
  if (colon > 0 && /^\d+$/.test(rest.slice(0, colon))) {
    epoch = Number(rest.slice(0, colon));
    rest = rest.slice(colon + 1);
  }
  const dash = rest.lastIndexOf("-");
  if (dash > 0) return { epoch, upstream: rest.slice(0, dash), revision: rest.slice(dash + 1) };
  return { epoch, upstream: rest, revision: "" };
}

/** Compares full Debian package versions (epoch:upstream-revision): -1, 0 or 1. */
export function compareDebian(a: string, b: string): number {
  const x = splitDebian(a);
  const y = splitDebian(b);
  if (x.epoch !== y.epoch) return sign(x.epoch - y.epoch);
  const u = verrevcmp(x.upstream, y.upstream);
  if (u) return sign(u);
  return sign(verrevcmp(x.revision, y.revision));
}

export function versionInRange(v: string, range: { gte?: string; lt?: string; eq?: string; lte?: string }): boolean {
  if (range.eq !== undefined && compareVersions(v, range.eq) !== 0) return false;
  if (range.gte !== undefined && compareVersions(v, range.gte) < 0) return false;
  if (range.lt !== undefined && compareVersions(v, range.lt) >= 0) return false;
  if (range.lte !== undefined && compareVersions(v, range.lte) > 0) return false;
  return true;
}
