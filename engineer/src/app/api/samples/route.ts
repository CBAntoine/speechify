import fs from "node:fs/promises";
import path from "node:path";
import { route } from "@/lib/http";

// The made-up sample firewall, for demos. Loaded into the browser like any
// other backup, so it goes through the same redaction and upload path.

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const dir = path.join(process.cwd(), "samples");
  const read = (name: string) => fs.readFile(path.join(dir, name), "utf8");
  return Response.json({
    backup: { name: "branch-office.conf", text: await read("branch-office.conf") },
    hits: { name: "branch-office-hits.json", text: await read("branch-office-hits.json"), days: 90, exportedAt: "2026-11-22T14:05:00.000Z" },
    deviations: { name: "deviations.json", text: await read("deviations.json") },
  });
});
