// Internet health: is it up, how fast, and is the DNS server slowing every page load?
// Speed tests use Cloudflare's public speed-test endpoints (the same ones speed.cloudflare.com uses).
import dns from "node:dns";

const CF = "https://speed.cloudflare.com";

async function timed(fn) {
  const t = performance.now();
  try {
    const r = await fn();
    return { ok: true, ms: performance.now() - t, r };
  } catch (err) {
    return { ok: false, ms: performance.now() - t, err };
  }
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n, d = 0) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export async function internetStatus({ base = CF, traceUrl = "https://www.cloudflare.com/cdn-cgi/trace" } = {}) {
  const trace = await timed(async () => {
    const res = await fetch(traceUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });
  if (!trace.ok) return { online: false };
  const kv = Object.fromEntries(trace.r.split("\n").filter(Boolean).map((l) => l.split("=")));
  const pings = [];
  for (let i = 0; i < 4; i++) {
    const t = await timed(() => fetch(`${base}/__down?bytes=0`, { signal: AbortSignal.timeout(4000), cache: "no-store" }).then((r) => r.arrayBuffer()));
    if (t.ok) pings.push(t.ms);
  }
  return { online: true, publicIp: kv.ip || null, location: kv.loc || null, colo: kv.colo || null, latencyMs: round(Math.min(...pings, trace.ms)) };
}

const DNS_NAMES = ["google.com", "apple.com", "netflix.com", "amazon.com", "wikipedia.org", "youtube.com"];

async function resolveTimes(servers) {
  const r = new dns.promises.Resolver({ timeout: 2500, tries: 1 });
  if (servers) r.setServers(servers);
  const times = [];
  for (const name of DNS_NAMES) {
    const t = await timed(() => r.resolve4(name));
    if (t.ok) times.push(t.ms);
  }
  return { median: round(median(times)), answered: times.length };
}

/** Compares the network's DNS server with two public ones. */
export async function dnsCheck() {
  const [system, cloudflare, google] = await Promise.all([resolveTimes(null), resolveTimes(["1.1.1.1"]), resolveTimes(["8.8.8.8"])]);
  return { servers: dns.getServers(), system, cloudflare, google };
}

async function drain(res, onBytes, signal) {
  const reader = res.body.getReader();
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      onBytes(value.byteLength);
    }
  } catch {
    /* aborted */
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Download + upload throughput. Stops after `seconds` per direction or `maxMB` of data, whichever first,
 * so it never eats a whole data cap.
 */
export async function speedTest({ seconds = 6, maxDownloadMB = 200, maxUploadMB = 50, streams = 4, onProgress, base = CF, traceUrl } = {}) {
  const status = await internetStatus({ base, ...(traceUrl ? { traceUrl } : {}) });
  if (!status.online) return { ok: false, message: "This computer can't reach the internet right now." };

  const pingSamples = [];
  for (let i = 0; i < 6; i++) {
    const t = await timed(() => fetch(`${base}/__down?bytes=0`, { signal: AbortSignal.timeout(4000), cache: "no-store" }).then((r) => r.arrayBuffer()));
    if (t.ok) pingSamples.push(t.ms);
  }
  const latencyMs = round(median(pingSamples));
  const jitterMs = pingSamples.length > 1 ? round(pingSamples.slice(1).reduce((a, t, i) => a + Math.abs(t - pingSamples[i]), 0) / (pingSamples.length - 1)) : null;

  // Download
  let down = 0;
  const dCtl = new AbortController();
  const dStart = performance.now();
  const dTimer = setTimeout(() => dCtl.abort(), seconds * 1000);
  const dWorker = async () => {
    while (!dCtl.signal.aborted && down < maxDownloadMB * 1e6) {
      try {
        const res = await fetch(`${base}/__down?bytes=25000000`, { signal: dCtl.signal, cache: "no-store" });
        await drain(res, (n) => {
          down += n;
          if (down >= maxDownloadMB * 1e6) dCtl.abort();
        }, dCtl.signal);
      } catch {
        break;
      }
    }
  };
  onProgress?.({ phase: "download" });
  await Promise.all(Array.from({ length: streams }, dWorker));
  clearTimeout(dTimer);
  const dSecs = (performance.now() - dStart) / 1000;

  // Upload
  let up = 0;
  const uCtl = new AbortController();
  const uStart = performance.now();
  const uTimer = setTimeout(() => uCtl.abort(), seconds * 1000);
  const chunk = new Uint8Array(4 * 1024 * 1024);
  const uWorker = async () => {
    while (!uCtl.signal.aborted && up < maxUploadMB * 1e6) {
      try {
        const res = await fetch(`${base}/__up`, { method: "POST", body: chunk, signal: uCtl.signal, headers: { "content-type": "application/octet-stream" } });
        await res.arrayBuffer();
        up += chunk.byteLength;
      } catch {
        break;
      }
    }
  };
  onProgress?.({ phase: "upload" });
  await Promise.all(Array.from({ length: Math.min(streams, 3) }, uWorker));
  clearTimeout(uTimer);
  const uSecs = Math.max(0.5, (performance.now() - uStart) / 1000);

  return {
    ok: true,
    downloadMbps: round((down * 8) / 1e6 / Math.max(dSecs, 0.5), 1),
    uploadMbps: round((up * 8) / 1e6 / uSecs, 1),
    latencyMs,
    jitterMs,
    downloadedMB: round(down / 1e6, 1),
    uploadedMB: round(up / 1e6, 1),
    server: status.colo,
    at: new Date().toISOString(),
  };
}
