// Finding Android's Wireless debugging on one device without hearing its announcements.
//
// Android picks the ports for its pairing window and for its encrypted connection at random, each
// time, and says which over multicast DNS. When those announcements don't reach Patch (a router that
// drops them, a phone that missed them, a scan made before Wireless debugging was on), Patch knocks on
// each port in the range Android picks from, then asks whatever answers what it is:
//   - the pairing window speaks TLS from the first byte, with the certificate adb makes for itself
//     (C=US, O=Android, CN=Adb: adb's crypto/x509_generator.cpp);
//   - the encrypted connection is adbd, which answers adb's hello (CNXN) by asking for TLS (STLS).
import net from "node:net";
import tls from "node:tls";
import { CMD, MAX_DATA, MessageParser, VERSION, encodeMessage } from "./adb.mjs";
import { openPorts } from "./knock.mjs";

export { PICKED_PORTS } from "./knock.mjs";

/** Whether this port is adb's pairing window: TLS 1.3 straight away, with adb's own certificate. */
export function isPairingWindow(ip, port, { key, cert, timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const s = tls.connect({ host: ip, port, key, cert, rejectUnauthorized: false, minVersion: "TLSv1.3", maxVersion: "TLSv1.3" });
    const end = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => end(false), timeout);
    s.once("secureConnect", () => {
      const who = s.getPeerCertificate()?.subject || {};
      end(who.CN === "Adb" && who.O === "Android");
    });
    s.once("error", () => end(false));
    s.once("close", () => end(false));
  });
}

/** Whether this port is adbd on Wireless debugging: it answers adb's hello by asking for TLS. */
export function isWirelessAdb(ip, port, { timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const s = net.connect({ host: ip, port });
    const end = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => end(false), timeout);
    const parser = new MessageParser((m) => end(m.command === CMD.STLS));
    s.once("connect", () => s.write(encodeMessage(CMD.CNXN, VERSION, MAX_DATA, "host::\0")));
    s.on("data", (b) => {
      try {
        parser.push(b);
      } catch {
        end(false); // not adb
      }
    });
    s.once("error", () => end(false));
    s.once("close", () => end(false));
  });
}

/**
 * Where Wireless debugging listens on this device now: { pairing, connect, answered }. pairing is the
 * pairing window's port (while "Pair device with pairing code" is open), connect the encrypted
 * connection's. key and cert are Patch's, which the pairing window asks for.
 */
export async function findWirelessDebugging(ip, { key, cert, from, to, ...o } = {}) {
  const { open, answered } = await openPorts(ip, { ...(from ? { from } : {}), ...(to ? { to } : {}), ...o });
  const found = { pairing: null, connect: null, answered, open };
  await Promise.all(
    open.map(async (port) => {
      // Asked one way, then the other: the pairing window doesn't speak adb, and adbd doesn't start with TLS.
      if (await isPairingWindow(ip, port, { key, cert })) found.pairing ??= port;
      else if (await isWirelessAdb(ip, port)) found.connect ??= port;
    }),
  );
  return found;
}
