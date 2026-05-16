import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const webUrl = process.env.RESONATE_DESKTOP_WEB_URL || "http://localhost:3001";
const startWeb =
  !["0", "false", "no"].includes(
    String(process.env.RESONATE_DESKTOP_START_WEB ?? "true").toLowerCase(),
  );

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok || response.status < 500) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const children = [];
const stopChildren = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

if (startWeb) {
  children.push(
    spawnChild("npm", ["--prefix", "web", "run", "dev"], {
      cwd: repoRoot,
      env: process.env,
    }),
  );
}

await waitForUrl(webUrl);

const electronBin = path.join(
  desktopRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

if (!existsSync(electronBin)) {
  throw new Error("Electron binary not found. Run `npm ci` in desktop/ first.");
}

children.push(
  spawnChild(electronBin, [desktopRoot], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      RESONATE_DESKTOP_WEB_URL: webUrl,
    },
  }),
);
