/**
 * A compact view of a parsed backup for drafting firewall changes: the
 * objects, policies in evaluation order, and routes. Small enough to send
 * from the browser and to give Claude in one request.
 */
import { findSections, type Block, type ParsedConfig } from "./fortios.ts";

const first = (b: Block, key: string): string | undefined => b.settings[key]?.values[0];
const all = (b: Block, key: string): string[] | undefined => b.settings[key]?.values;
const entries = (b: Block) => b.children.filter((c) => c.kind === "edit");

function pick(b: Block, keys: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of keys) {
    const v = all(b, k);
    if (v) out[k] = v.length === 1 ? v[0] : v;
  }
  return out;
}

function section(config: ParsedConfig, path: string, vdom: string | null, keys: string[]) {
  const out: Record<string, Record<string, string | string[]>> = {};
  for (const s of findSections(config, path)) {
    if (s.vdom !== null && vdom !== null && s.vdom !== vdom) continue;
    for (const e of entries(s.block)) out[e.name] = pick(e, keys);
  }
  return out;
}

export interface ChangeContext {
  device: { hostname: string | null; model: string | null; version: string | null };
  vdom: string;
  interfaces: Record<string, Record<string, string | string[]>>;
  zones: Record<string, Record<string, string | string[]>>;
  addresses: Record<string, Record<string, string | string[]>>;
  address_groups: Record<string, Record<string, string | string[]>>;
  services: Record<string, Record<string, string | string[]>>;
  service_groups: Record<string, Record<string, string | string[]>>;
  vips: Record<string, Record<string, string | string[]>>;
  schedules: Record<string, Record<string, string | string[]>>;
  /** In evaluation order, top to bottom. A policy with no action is a deny rule. */
  policies: Record<string, string | string[]>[];
  routes: Record<string, string | string[]>[];
  truncated: boolean;
}

export function changeContext(config: ParsedConfig, vdom = config.vdoms[0] ?? "root", maxPolicies = 400): ChangeContext {
  const policySection = findSections(config, "firewall policy").find((s) => s.vdom === vdom || (!config.vdom_mode && s.vdom === "root"));
  const policyEntries = policySection ? entries(policySection.block) : [];
  const policies = policyEntries.slice(0, maxPolicies).map((p) => ({
    id: p.name,
    ...pick(p, ["name", "status", "srcintf", "dstintf", "srcaddr", "dstaddr", "service", "action", "schedule", "groups", "users", "utm-status", "ips-sensor", "logtraffic", "nat", "comments"]),
  }));
  const hostname = findSections(config, "system global").map((s) => first(s.block, "hostname")).find(Boolean) ?? null;
  const routes = findSections(config, "router static")
    .filter((s) => s.vdom === vdom || s.vdom === "root")
    .flatMap((s) => entries(s.block).map((r) => ({ id: r.name, dst: all(r, "dst") ?? "0.0.0.0 0.0.0.0 (default route)", ...pick(r, ["gateway", "device"]) })));
  return {
    device: { hostname, model: config.header.model, version: config.header.version },
    vdom,
    interfaces: section(config, "system interface", null, ["vdom", "alias", "role", "type", "ip", "allowaccess", "interface"]),
    zones: section(config, "system zone", vdom, ["interface"]),
    addresses: section(config, "firewall address", vdom, ["type", "subnet", "start-ip", "end-ip", "fqdn", "associated-interface"]),
    address_groups: section(config, "firewall addrgrp", vdom, ["member"]),
    services: section(config, "firewall service custom", vdom, ["protocol", "tcp-portrange", "udp-portrange", "icmptype"]),
    service_groups: section(config, "firewall service group", vdom, ["member"]),
    vips: section(config, "firewall vip", vdom, ["extintf", "extip", "mappedip", "portforward", "extport", "mappedport"]),
    schedules: { ...section(config, "firewall schedule onetime", vdom, ["start", "end"]), ...section(config, "firewall schedule recurring", vdom, ["day", "start", "end"]) },
    policies,
    routes,
    truncated: policyEntries.length > maxPolicies,
  };
}
