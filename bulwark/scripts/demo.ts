// `npm run demo`: a pretend home network on this computer, scanned and shown in the dashboard.
// Nothing outside this machine is touched.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHost } from "../src/core/host.ts";
import { runScan } from "../src/core/scan.ts";
import { StateStore } from "../src/core/state.ts";
import { startServer } from "../src/server.ts";
import { startFakeLan } from "../tests/helpers/fake-lan.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lan = await startFakeLan();
const targets = Object.values(lan.ips);
const extraSsdp = [{ ip: lan.ips.router, location: lan.upnpLocation, server: "Linux/3.4 UPnP/1.0 MiniUPnPd/1.8", st: "urn:schemas-upnp-org:device:InternetGatewayDevice:1" }];
const host = await createHost();
const state = new StateStore(process.env.BULWARK_DEMO_HOME ?? path.join(root, ".state", "demo"));

console.log("Scanning the pretend network…");
const scan = await runScan(host, { local: false, network: { targets, authorized: false, confirmedOwnership: true, noMulticast: true, extraSsdp } });
await state.saveScan(scan);
await startServer({ host, state, port: Number(process.env.PORT) || 7078, bind: "127.0.0.1", demo: { targets, extraSsdp } });
