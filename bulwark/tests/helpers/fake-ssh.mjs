#!/usr/bin/env node
// A stand-in for OpenSSH's ssh client, for tests: it reads the options Bulwark passes, keeps a
// pretend shared connection (a file at the ControlPath), checks passwords through SSH_ASKPASS like
// ssh does, and runs the "remote" command right here with sh. Never point it at real files.
//
//   FAKE_SSH_PASSWORD  the account needs this password (no key login)
//   FAKE_SSH_UID       pretend `id -u` says this (to be someone other than root)
//   FAKE_SSH_SUDO=1    pretend passwordless sudo works
//   FAKE_SSH_LOG       append every call, as JSON lines

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";

const argv = process.argv.slice(2);
const opts = {};
let user = "";
let port = "22";
let op = null;
let master = false;
let i = 0;
while (i < argv.length) {
  const a = argv[i];
  if (a === "--") {
    i++;
    break;
  }
  if (a === "-o") {
    const [k, ...v] = argv[i + 1].split("=");
    opts[k] = v.join("=");
    i += 2;
  } else if (a === "-p") (port = argv[i + 1]), (i += 2);
  else if (a === "-l") (user = argv[i + 1]), (i += 2);
  else if (a === "-O") (op = argv[i + 1]), (i += 2);
  else if (a === "-N") (master = true), i++;
  else if (a === "-f" || a === "-T") i++;
  else break;
}
const host = argv[i];
const command = argv.slice(i + 1).join(" ");
if (process.env.FAKE_SSH_LOG) fs.appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify({ user, host, port, op, master, opts, command }) + "\n");

const socket = opts.ControlPath ? opts.ControlPath.replace("%C", createHash("sha1").update(`${user}@${host}:${port}`).digest("hex")) : null;
const deny = () => {
  process.stderr.write(`${user}@${host}: Permission denied (publickey,password).\n`);
  process.exit(255);
};

if (op === "check") process.exit(socket && fs.existsSync(socket) ? 0 : 255);
if (op === "exit") {
  if (socket) fs.rmSync(socket, { force: true });
  process.exit(0);
}
if (master) {
  const want = process.env.FAKE_SSH_PASSWORD;
  if (want) {
    if (!process.env.SSH_ASKPASS || opts.BatchMode === "yes") deny();
    const given = spawnSync(process.env.SSH_ASKPASS, [`${user}@${host}'s password: `], { env: process.env }).stdout.toString().replace(/\n$/, "");
    if (given !== want) deny();
  }
  if (socket) fs.writeFileSync(socket, "pretend connection");
  process.exit(0);
}
// Without the shared connection, only a key would work, and password-only accounts have none.
if (process.env.FAKE_SSH_PASSWORD && !(socket && fs.existsSync(socket))) deny();

const prelude = [
  process.env.FAKE_SSH_UID ? `id() { if [ "$1" = "-u" ]; then echo ${Number(process.env.FAKE_SSH_UID)}; else command id "$@"; fi; };` : "",
  process.env.FAKE_SSH_SUDO === "1" ? `sudo() { [ "$1" = "-n" ] && shift; "$@"; };` : `sudo() { echo "sudo: a password is required" >&2; return 1; };`,
].join(" ");
const r = spawnSync("sh", ["-c", `${prelude} ${command}`], { stdio: "inherit" });
process.exit(r.status ?? 1);
