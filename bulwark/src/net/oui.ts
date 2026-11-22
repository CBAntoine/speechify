// Who made a device, from the first half of its network card's address (MAC). Phones and laptops
// usually hide behind a made-up "private" address, so this mostly names routers, TVs, printers,
// cameras and smart home gear, which keep their real one.

import { isRandomMac } from "./local.ts";
import { OUI_DATA } from "./oui-data.ts";

export interface Vendor {
  vendor: string;
  /** What that maker's devices usually are, when it makes mostly one kind. */
  kind?: string;
}

let table: Map<string, Vendor> | null = null;

function load(): Map<string, Vendor> {
  const t = new Map<string, Vendor>();
  for (const line of OUI_DATA.split("\n")) {
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const [vendor, kind] = line.slice(0, bar).split("~");
    const info: Vendor = kind ? { vendor, kind } : { vendor };
    for (const p of line.slice(bar + 1).split(",")) t.set(p, info);
  }
  return t;
}

export function vendorOf(mac: string | undefined): Vendor | undefined {
  if (!mac) return undefined;
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12 || isRandomMac(mac)) return undefined;
  table ??= load();
  return table.get(hex.slice(0, 9)) ?? table.get(hex.slice(0, 7)) ?? table.get(hex.slice(0, 6));
}
