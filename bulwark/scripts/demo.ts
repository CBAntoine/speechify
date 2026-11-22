// `npm run demo`: a pretend home network and two pretend code projects on this computer,
// scanned and shown in the dashboard. Nothing outside this machine is changed.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHost } from "../src/core/host.ts";
import { runScan } from "../src/core/scan.ts";
import { StateStore } from "../src/core/state.ts";
import { startServer } from "../src/server.ts";
import { startFakeLan } from "../tests/helpers/fake-lan.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.BULWARK_DEMO_HOME ?? path.join(root, ".state", "demo");

// Two small projects with dependencies that have well-known vulnerabilities.
const projects = path.join(home, "projects");
await fs.mkdir(path.join(projects, "web-shop"), { recursive: true });
await fs.mkdir(path.join(projects, "inventory-api"), { recursive: true });
await fs.writeFile(path.join(projects, "web-shop", "package.json"), JSON.stringify({ name: "web-shop", private: true, dependencies: { lodash: "^4.17.20", minimist: "^1.2.5" } }, null, 2) + "\n");
await fs.writeFile(
  path.join(projects, "web-shop", "package-lock.json"),
  JSON.stringify(
    {
      name: "web-shop",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "web-shop", dependencies: { lodash: "^4.17.20", minimist: "^1.2.5" } },
        "node_modules/lodash": { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz" },
        "node_modules/minimist": { version: "1.2.5", resolved: "https://registry.npmjs.org/minimist/-/minimist-1.2.5.tgz" },
      },
    },
    null,
    2,
  ) + "\n",
);
await fs.writeFile(path.join(projects, "inventory-api", "requirements.txt"), "flask==2.2.2\nrequests==2.19.0  # HTTP client\nurllib3==1.26.4\n");

const lan = await startFakeLan();
const targets = Object.values(lan.ips);
const extraSsdp = [{ ip: lan.ips.router, location: lan.upnpLocation, server: "Linux/3.4 UPnP/1.0 MiniUPnPd/1.8", st: "urn:schemas-upnp-org:device:InternetGatewayDevice:1" }];
const host = await createHost();
const state = new StateStore(home);

console.log("Scanning the pretend network and projects…");
const scan = await runScan(host, {
  local: false,
  code: { roots: [projects], cacheDir: path.join(home, "osv-cache") },
  network: { targets, authorized: false, confirmedOwnership: true, noMulticast: true, extraSsdp },
});
await state.saveScan(scan);
await startServer({ host, state, port: Number(process.env.PORT) || 7078, bind: "127.0.0.1", demo: { targets, extraSsdp, codeRoots: [projects] } });
