#!/usr/bin/env node
// Makes TV apps the way Patch does on a phone, from the template this build just made: a notes
// board (and a second version of it, to check it installs over the first) and a quiz. The Android
// build then checks them with Google's own apksigner and aapt2, and installs them on the emulator.
// Usage: node make-tvapps.mjs <template.apk> <out dir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [templatePath, outDir] = process.argv.slice(2);
const { startApp } = await import(path.join(PATCH, "src/app.mjs"));

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-tvapps-"));
const app = await startApp({ port: 0, dataDir, autoScan: false, overrides: { tvappTemplate: fs.readFileSync(templatePath) }, log: () => {} });
const make = async (input) => {
  const r = await app.tvapps.create(input);
  if (!r.ok) throw new Error(r.message);
  return r.app;
};
const save = async (a, file) => {
  const { apk } = await app.tvapps.apk(a.id);
  fs.writeFileSync(path.join(outDir, file), apk);
  console.log(`Made ${file}: “${a.name}” (${a.package}, version ${a.version}, ${apk.length} bytes)`);
};

try {
  const notes = await make({ name: "Family notes", kind: "notes", emoji: "📝", content: "Dinner at 7\nBins out on Tuesday\nPatch made this app" });
  await save(notes, "tvapp-notes.apk");
  await app.tvapps.update(notes.id, { content: "Dinner at 7\nBins out on Tuesday\nPatch made this app\nThis is version two" });
  await save(app.tvapps.get(notes.id), "tvapp-notes-v2.apk");
  const quiz = await make({
    name: "Patch quiz",
    kind: "quiz",
    emoji: "❓",
    content: "Which planet is called the red planet? | Mars | Venus | Jupiter\nHow many legs does a spider have? | Eight | Six | Ten\nWhat do bees make? | Honey | Milk | Silk",
  });
  await save(quiz, "tvapp-quiz.apk");
  fs.writeFileSync(path.join(outDir, "tvapps.json"), JSON.stringify({ notes: notes.package, quiz: quiz.package }, null, 2));
} finally {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
