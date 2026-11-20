// Files the person sends from the dashboard (an app file to install on a TV, photos for a TV photo
// frame). They're kept in the data folder until Patch restarts or for a day, whichever is first.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DAY = 24 * 60 * 60_000;

export class Uploads {
  constructor(dir) {
    this.dir = dir;
    this.files = new Map();
    // Anything left from an earlier run is no longer reachable: start clean.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Save a request's body (a stream of bytes). Returns { id, name, label, path, size }. */
  async save(stream, { name = "file", max = 250 * 1024 * 1024 } = {}) {
    this.cleanup();
    const id = crypto.randomBytes(9).toString("base64url");
    const file = path.join(this.dir, id);
    const out = fs.createWriteStream(file, { mode: 0o600 });
    let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > max) throw Object.assign(new Error(`That file is too big (the most is ${Math.round(max / 1048576)} MB).`), { status: 413 });
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    } catch (err) {
      out.destroy();
      await fsp.rm(file, { force: true });
      throw err;
    }
    if (!size) {
      await fsp.rm(file, { force: true });
      throw Object.assign(new Error("That file is empty."), { status: 400 });
    }
    const clean = String(name).replace(/[\\/]/g, "_").replace(/[^\w .()+-]/g, "").trim().slice(0, 120) || "file";
    const entry = { id, name: clean, label: clean.replace(/\.[a-z0-9]{1,5}$/i, ""), path: file, size, at: Date.now() };
    this.files.set(id, entry);
    return entry;
  }

  get(id) {
    const f = this.files.get(String(id || ""));
    return f && fs.existsSync(f.path) ? f : null;
  }

  cleanup() {
    for (const [id, f] of this.files) {
      if (Date.now() - f.at > DAY) {
        fs.rmSync(f.path, { force: true });
        this.files.delete(id);
      }
    }
  }
}
