import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `npm run demo`: Mainstreet on fictional businesses, in its own data folder
// (data/demo), with two weeks of history. Nothing is ever sent. Add
// `-- --reset` to start the demo over.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.DEMO = "1";
process.env.DATA_DIR ??= path.join(root, "data", "demo");
process.env.LOOP_SECONDS ??= "10";
if (process.argv.includes("--reset")) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const { seedDemoHistory } = await import("../src/seed.ts");
const made = seedDemoHistory();
if (made) console.log(`  Seeded ${made} fictional leads of history.`);
await import("../src/server.ts");
