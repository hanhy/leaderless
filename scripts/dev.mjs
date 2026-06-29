import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function loadEnvFile() {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index === -1) return [line, ""];
        const key = line.slice(0, index).trim().replace(/^export\s+/, "");
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
        return [key, value];
      })
  );
}

const env = { ...loadEnvFile(), ...process.env };
const apiPort = env.API_PORT ?? "8787";
const vitePort = env.VITE_PORT ?? "5173";

const processes = [
  spawn("node", ["server.mjs"], {
    env: { ...env, API_PORT: apiPort },
    stdio: "inherit"
  }),
  spawn("npx", ["vite", "--host", "127.0.0.1", "--port", vitePort, "--strictPort"], {
    env: { ...env, API_PORT: apiPort },
    stdio: "inherit"
  })
];

function shutdown(signal) {
  for (const child of processes) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exitCode = code;
    }
  });
}
