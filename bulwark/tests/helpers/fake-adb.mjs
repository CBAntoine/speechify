#!/usr/bin/env node
// A stand-in for Android's `adb`, simulating one Android TV, for tests and the demo. It keeps the
// device's settings in a JSON file (FAKE_ADB_STATE), so changes stick between calls.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const stateFile = process.env.FAKE_ADB_STATE ?? path.join(os.tmpdir(), "bulwark-fake-adb.json");
const initial = {
  serial: "192.168.1.60:5555",
  connected: true,
  props: {
    "ro.product.model": "Chromecast HD",
    "ro.product.manufacturer": "Google",
    "ro.build.characteristics": "tv,nosdcard",
    "ro.build.version.release": "12",
    "ro.build.version.sdk": "31",
    "ro.build.version.security_patch": "2024-08-01",
    "ro.boot.verifiedbootstate": "green",
    "ro.boot.flash.locked": "1",
    "ro.crypto.state": "encrypted",
    "ro.crypto.type": "file",
    "init.svc.adbd": "running",
    "service.adb.tcp.port": "5555",
  },
  settings: { "global/adb_enabled": "1", "global/package_verifier_enable": "0", "global/device_name": "Living Room TV", "global/development_settings_enabled": "1" },
  appops: { "com.example.browser": "allow", "com.android.vending": "allow" },
  packages: [
    ["com.netflix.ninja", "com.android.vending"],
    ["com.example.iptv", "null"],
    ["com.example.browser", "com.android.vending"],
  ],
};
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : initial;
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
if (!fs.existsSync(stateFile)) save();
const out = (s) => process.stdout.write(s.endsWith("\n") ? s : s + "\n");

function split(cmd) {
  const args = [];
  const re = /'((?:[^']|'\\'')*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) args.push(m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]);
  return args;
}

function shell(args) {
  const [cmd, ...rest] = args;
  const key = (ns, k) => `${ns}/${k}`;
  switch (cmd) {
    case "getprop":
      if (rest[0]) return out(state.props[rest[0]] ?? "");
      return out(Object.entries(state.props).map(([k, v]) => `[${k}]: [${v}]`).join("\n"));
    case "settings": {
      const [op, ns, k, v] = rest;
      if (op === "get") return out(state.settings[key(ns, k)] ?? "null");
      if (op === "put") {
        state.settings[key(ns, k)] = v;
        if (ns === "global" && k === "adb_enabled" && v === "0") {
          state.connected = false;
          state.props["service.adb.tcp.port"] = "-1";
        }
        save();
        return;
      }
      if (op === "delete") {
        delete state.settings[key(ns, k)];
        save();
        return;
      }
      process.exit(1);
    }
    case "cmd":
      if (rest[0] === "appops" && rest[1] === "query-op") return out(Object.entries(state.appops).filter(([, m]) => m === rest[3]).map(([p]) => p).join("\n"));
      if (rest[0] === "appops" && rest[1] === "set") {
        state.appops[rest[2]] = rest[4];
        save();
        return;
      }
      if (rest[0] === "lock_settings") return out("false");
      process.exit(1);
    case "pm":
      if (rest[0] === "path") return out(rest[1] === "com.android.vending" ? "package:/product/app/Phonesky/Phonesky.apk" : "");
      if (rest[0] === "list") return out(state.packages.map(([p, i]) => `package:${p}  installer=${i}`).join("\n"));
      process.exit(1);
    case "dumpsys":
      if (rest[0] === "package" && rest[1] === "com.google.android.webview") return out("    versionName=120.0.6099.230\n    lastUpdateTime=2024-01-10 08:00:00");
      return out("");
    case "getenforce":
      return out("Enforcing");
    case "sh":
      return out("");
    case "echo":
      return out(rest.join(" "));
    default:
      process.exit(127);
  }
}

const argv = process.argv.slice(2);
if (argv[0] === "devices") {
  out("List of devices attached");
  if (state.connected) out(`${state.serial}\tdevice product:sabrina model:Chromecast_HD device:sabrina transport_id:1`);
  out("");
} else if (argv[0] === "connect") {
  state.connected = true;
  save();
  out(`connected to ${argv[1]}`);
} else if (argv[0] === "pair") {
  out(`Successfully paired to ${argv[1]} [guid=adb-XYZ]`);
} else if (argv[0] === "-s" && argv[2] === "shell") {
  if (argv[1] !== state.serial || !state.connected) {
    process.stderr.write(`error: device '${argv[1]}' not found\n`);
    process.exit(1);
  }
  shell(split(argv.slice(3).join(" ")));
} else {
  process.stderr.write(`fake adb: unsupported ${argv.join(" ")}\n`);
  process.exit(1);
}
