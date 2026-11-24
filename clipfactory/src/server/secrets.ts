import fs from "node:fs";
import path from "node:path";
import { APP_ROOT } from "./paths.ts";

// Logins and API credentials live in .secrets/ (git-ignored, owner-only files).

export const secretsDir = () => [APP_ROOT, ".secrets"].join(path.sep);
export const secretFile = (name: string) => [secretsDir(), name].join(path.sep);

export function writeSecret(name: string, data: unknown) {
  fs.mkdirSync(secretsDir(), { recursive: true, mode: 0o700 });
  const file = secretFile(name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readSecret<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(secretFile(name), "utf8")) as T;
  } catch {
    return null;
  }
}

export function removeSecret(name: string) {
  fs.rmSync(secretFile(name), { force: true });
}
