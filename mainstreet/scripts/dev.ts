import { spawn, type ChildProcess } from "node:child_process";

// Development: the server (restarts on change) plus Vite's hot-reloading
// dashboard, which proxies the API to the server.

const kids: ChildProcess[] = [
  spawn(process.execPath, ["--watch-path=src", "--disable-warning=ExperimentalWarning", "src/server.ts"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "web/vite.config.ts"], { stdio: "inherit", env: process.env }),
];

console.log(`\n  Dashboard with hot reload: http://localhost:${process.env.WEB_PORT || 5173}  (API on :${process.env.PORT || 8787})\n`);

function stop() {
  for (const k of kids) k.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const k of kids) k.on("exit", (code) => code && stop());
