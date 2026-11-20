// Where Patch is running: a computer (macOS, Windows, Linux) or an Android phone, inside the Patch app.
// The Android app runs this same server and shows the dashboard; it passes in what only Android can
// see (the Wi-Fi network, the router, DNS servers, the phone's name) as PATCH_* environment variables.
import fs from "node:fs";
import { isPrivateIPv4, parseCidr } from "./util.mjs";

/** True inside the Android app (Node reports "android"; PATCH_PLATFORM lets tests act like a phone). */
export const onPhone = () => process.platform === "android" || process.env.PATCH_PLATFORM === "android";

/** How Patch talks about the device it runs on: "this phone" or "this computer". */
export const here = () => (onPhone() ? "this phone" : "this computer");

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isIpv4 = (s) => IPV4.test(s) && s.split(".").every((n) => Number(n) <= 255);
const clean = (s, max = 60) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

/**
 * The Wi-Fi network as the Android app sees it: PATCH_WIFI="192.168.1.23/24", PATCH_GATEWAY, PATCH_DNS.
 * Android hides some of this from ordinary programs, so the app reads it and hands it over. The app also
 * keeps PATCH_NETWORK_FILE (JSON with the same three values) up to date when the phone changes networks;
 * it wins over the values given at start-up. An empty "wifi" there means the phone is off Wi-Fi.
 */
export function networkFromEnv(env = process.env) {
  if (env.PATCH_NETWORK_FILE) {
    try {
      const f = JSON.parse(fs.readFileSync(env.PATCH_NETWORK_FILE, "utf8"));
      env = { ...env, PATCH_WIFI: f.wifi ?? "", PATCH_GATEWAY: f.gateway ?? "", PATCH_DNS: f.dns ?? "" };
    } catch {
      /* not written yet: use the start-up values */
    }
  }
  const m = clean(env.PATCH_WIFI).match(/^([\d.]+)\/(\d{1,2})$/);
  const wifi = m && isIpv4(m[1]) && isPrivateIPv4(m[1]) && Number(m[2]) >= 8 && Number(m[2]) <= 30 ? { address: m[1], prefix: Number(m[2]), cidr: parseCidr(`${m[1]}/${m[2]}`).cidr } : null;
  const gateway = isIpv4(clean(env.PATCH_GATEWAY)) ? clean(env.PATCH_GATEWAY) : null;
  const dns = clean(env.PATCH_DNS, 200).split(/[,\s]+/).filter(isIpv4).slice(0, 4);
  return { wifi, gateway, dns };
}

/** The phone's own name and model, from the Android app (e.g. "Galaxy S24 Ultra", "samsung", "SM-S928B"). */
export function phoneIdentity(env = process.env) {
  const brand = clean(env.PATCH_DEVICE_BRAND);
  return {
    name: clean(env.PATCH_DEVICE_NAME) || null,
    brand: brand ? brand[0].toUpperCase() + brand.slice(1) : null,
    model: clean(env.PATCH_DEVICE_MODEL) || null,
    android: clean(env.PATCH_ANDROID_VERSION) || null,
  };
}

// On the phone, web pages and videos for "this phone" open through the app (it hands them to Android,
// which picks the browser or the YouTube app). The server sets the opener once the dashboard can hear it.
let opener = null;

export function setPhoneOpener(fn) {
  opener = fn;
}

/** Asks the Patch app to open a web address on the phone. False if no Patch screen is open to do it. */
export function openOnPhone(url) {
  return opener ? opener(url) === true : false;
}
