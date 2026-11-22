// What to do about each kind of device, including the ones Bulwark can't look inside from the
// network (an iPhone shows nothing; that doesn't mean it's up to date).

import type { NetDevice } from "../core/types.ts";

const ADVICE: Record<string, string[]> = {
  Router: [
    "Log in to the router and install its firmware updates (or turn on automatic updates).",
    "Make sure its admin password isn't the one printed on the label, and turn off WPS and remote administration.",
    "Use WPA2 or WPA3 for the Wi-Fi, and a guest network for visitors and smart gadgets.",
  ],
  Computer: [
    "Run Bulwark on it for a full check (it runs on Windows, macOS and Linux), or check it over SSH from here if it's a Mac or Linux machine.",
    "Keep automatic updates on.",
  ],
  "Phone or tablet": [
    "Bulwark can't look inside phones and tablets from the network. On the device, install system updates (Settings → General → Software Update on Apple; Settings → System → Software update on Android).",
    "Keep a screen lock on, and install apps only from the app store.",
    "Android phones and tablets can be checked in full in the Phones & TVs tab.",
  ],
  "Phone or laptop": [
    "This device uses a private (made-up) hardware address, as phones and laptops do for privacy, and has nothing open to the network. Name it if you recognise it.",
    "On the device itself, keep system updates on.",
  ],
  "Android device": ["Android phones, tablets and TVs can be checked in full in the Phones & TVs tab."],
  "TV or streaming device": [
    "Turn on automatic updates in the TV's settings.",
    "Android TV, Google TV and Fire TV can be checked in full in the Phones & TVs tab.",
  ],
  Camera: [
    "Update the camera's firmware in its app, and change any default password.",
    "Don't forward its ports on the router; use the maker's app for viewing it from outside.",
  ],
  Printer: [
    "Update its firmware from its web page or the maker's app, and set an admin password there.",
    "Turn off services you don't use (FTP, Telnet, raw port 9100, Wi-Fi Direct).",
  ],
  Speaker: ["Keep automatic updates on in its app."],
  "Smart home device": [
    "Update it in its app, and use a strong, unique password for the app account.",
    "If your router has a guest or IoT network, put smart gadgets on it, away from your computers.",
  ],
  "Game console": ["Keep automatic system updates on, and turn on two-step sign-in for the console account."],
  NAS: [
    "Update the NAS firmware and turn on automatic updates.",
    "Don't expose it to the internet through port forwarding; use the maker's VPN app for remote access.",
    "Keep an offline backup: NAS boxes are a favourite ransomware target.",
  ],
  Device: ["Bulwark couldn't tell what this is. If you don't recognise it, look for it in your router's list of connected devices."],
};

export function adviceFor(d: Pick<NetDevice, "kind" | "isSelf">): string[] {
  if (d.isSelf) return [];
  return ADVICE[d.kind] ?? ADVICE.Device;
}
