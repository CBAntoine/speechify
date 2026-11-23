// Knocking on a device's ports: which ones are open, quickly, many at a time. A refusal still proves
// the device is there (it answered); a device that says nothing at all is asleep or out of reach.
import net from "node:net";

/** The range Linux, and so Android, picks a listening port from when a program asks for any port. */
export const PICKED_PORTS = { from: 32768, to: 60999 };

/** How one port answers a knock: "open", "refused" (nothing there, but the device answered), or "silent". */
export function knock(ip, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    let settled = false;
    const end = (state) => {
      if (settled) return;
      settled = true;
      s.destroy();
      resolve(state);
    };
    s.setTimeout(timeout, () => end("silent"));
    s.once("connect", () => end("open"));
    s.once("error", (e) => end(e.code === "ECONNREFUSED" ? "refused" : "silent"));
  });
}

/**
 * The open TCP ports on one host between from and to: { open, answered }. answered is false when the
 * host said nothing at all (asleep, or out of reach), and then it stops early instead of waiting on
 * every port. budget caps the whole knock in milliseconds.
 */
export async function openPorts(ip, { from = PICKED_PORTS.from, to = PICKED_PORTS.to, concurrency = 384, timeout = 1500, budget = 45_000 } = {}) {
  // First a few knocks: a device that's there turns a knock away at once.
  const first = await Promise.all([from, Math.floor((from + to) / 2), to].map((p) => knock(ip, p, timeout)));
  if (first.every((s) => s === "silent")) return { open: [], answered: false };
  const open = [];
  first.forEach((s, i) => s === "open" && open.push([from, Math.floor((from + to) / 2), to][i]));
  const skip = new Set([from, Math.floor((from + to) / 2), to]);
  const started = Date.now();
  let next = from;
  const worker = async () => {
    while (next <= to && Date.now() - started < budget) {
      const port = next++;
      if (skip.has(port)) continue;
      if ((await knock(ip, port, timeout)) === "open") open.push(port);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, to - from + 1) }, worker));
  return { open: [...new Set(open)].sort((a, b) => a - b), answered: true, complete: next > to };
}


/** The open ports among a list (the well-known ones, say): { open, answered }. */
export async function openPortsIn(ip, ports, { concurrency = 64, timeout = 1500 } = {}) {
  const list = [...new Set(ports)];
  const open = [];
  let answered = false;
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const port = list[i++];
      const state = await knock(ip, port, timeout);
      if (state !== "silent") answered = true;
      if (state === "open") open.push(port);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return { open: open.sort((a, b) => a - b), answered };
}
