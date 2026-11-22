// Comparing package versions the way each ecosystem does.

import { compareDebian, compareVersions } from "../core/versions.ts";

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

/** Semantic versioning (npm, crates.io, Go, NuGet, Packagist, Pub, Hex). Extra numeric parts are allowed. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const s = v.trim().replace(/^[v=]+/i, "").split("+")[0];
    const dash = s.indexOf("-");
    const main = (dash === -1 ? s : s.slice(0, dash)).split(".").map((x) => Number.parseInt(x, 10) || 0);
    const pre = dash === -1 ? [] : s.slice(dash + 1).split(".");
    return { main, pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.main.length, y.main.length); i++) {
    const d = (x.main[i] ?? 0) - (y.main[i] ?? 0);
    if (d) return sign(d);
  }
  if (!x.pre.length || !y.pre.length) return sign(y.pre.length - x.pre.length); // a release beats its pre-releases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d) return sign(d);
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** PEP 440, simplified: epochs, releases, a/b/rc pre-releases, post- and dev-releases. */
export function comparePep440(a: string, b: string): number {
  const key = (v: string) => {
    const s = v.trim().toLowerCase().replace(/^v/, "");
    const m = s.match(/^(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|alpha|b|beta|c|rc|pre|preview)[-_.]?(\d*))?(?:(?:[-_.]?(post|rev|r)[-_.]?(\d*))|-(\d+))?(?:[-_.]?dev[-_.]?(\d*))?(?:\+.*)?$/);
    if (!m) return null;
    const pre = m[3] ? ({ a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 } as Record<string, number>)[m[3]] : undefined;
    return {
      epoch: Number(m[1] ?? 0),
      release: m[2].split(".").map(Number),
      pre: pre === undefined ? null : [pre, Number(m[4] || 0)],
      post: m[5] || m[7] ? Number(m[6] || m[7] || 0) : null,
      dev: m[8] !== undefined ? Number(m[8] || 0) : null,
    };
  };
  const x = key(a);
  const y = key(b);
  if (!x || !y) return compareVersions(a, b);
  if (x.epoch !== y.epoch) return sign(x.epoch - y.epoch);
  for (let i = 0; i < Math.max(x.release.length, y.release.length); i++) {
    const d = (x.release[i] ?? 0) - (y.release[i] ?? 0);
    if (d) return sign(d);
  }
  // Order within one release: dev-only < pre-releases < the release < post-releases.
  const rank = (k: NonNullable<typeof x>) => (k.pre === null && k.post === null && k.dev !== null ? 0 : k.pre !== null ? 1 : k.post === null ? 2 : 3);
  const r = rank(x) - rank(y);
  if (r) return sign(r);
  if (x.pre && y.pre) {
    const d = x.pre[0] - y.pre[0] || x.pre[1] - y.pre[1];
    if (d) return sign(d);
  }
  if (x.post !== null && y.post !== null && x.post !== y.post) return sign(x.post - y.post);
  if (x.dev !== y.dev) {
    if (x.dev === null) return 1;
    if (y.dev === null) return -1;
    return sign(x.dev - y.dev);
  }
  return 0;
}

/** RubyGems: a segment with letters marks a pre-release, which sorts before the release. */
export function compareGem(a: string, b: string): number {
  const seg = (v: string) => v.trim().split(/[.-]/).flatMap((p) => p.match(/\d+|[a-z]+/gi) ?? []);
  const x = seg(a);
  const y = seg(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (p === undefined) return q !== undefined && /^[a-z]/i.test(q) ? 1 : -1;
    if (q === undefined) return /^[a-z]/i.test(p) ? -1 : 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d) return sign(d);
    } else if (pn !== qn) return pn ? 1 : -1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export function compareEcosystem(ecosystem: string, a: string, b: string): number {
  switch (ecosystem.split(":")[0]) {
    case "PyPI":
      return comparePep440(a, b);
    case "RubyGems":
      return compareGem(a, b);
    case "Debian":
    case "Ubuntu":
      return compareDebian(a, b);
    case "npm":
    case "crates.io":
    case "Go":
    case "NuGet":
    case "Packagist":
    case "Pub":
    case "Hex":
    case "Maven":
      return compareSemver(a, b);
    default:
      return compareVersions(a, b);
  }
}
