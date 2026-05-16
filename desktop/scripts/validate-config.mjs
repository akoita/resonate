import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const requiredFiles = [
  "src/main.cjs",
  "src/preload.cjs",
  "src/runtime-config.cjs",
  "scripts/write-runtime-config.mjs",
  "electron-builder.yml",
  "README.md",
];

for (const file of requiredFiles) {
  if (!existsSync(path.join(desktopRoot, file))) {
    throw new Error(`Missing desktop file: ${file}`);
  }
}

const packageJson = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
);

if (packageJson.main !== "src/main.cjs") {
  throw new Error("desktop/package.json must point main at src/main.cjs");
}

for (const script of ["dev", "start", "lint", "prepare:runtime-config", "package:dir", "dist"]) {
  if (!packageJson.scripts?.[script]) {
    throw new Error(`Missing desktop npm script: ${script}`);
  }
}

const runtimeSource = readFileSync(
  path.join(desktopRoot, "src/runtime-config.cjs"),
  "utf8",
);

if (!runtimeSource.includes("RESONATE_DESKTOP_WEB_URL")) {
  throw new Error("Desktop runtime must be configured through env vars.");
}

if (!runtimeSource.includes("runtime-config.json")) {
  throw new Error("Desktop runtime must read packaged runtime config.");
}

console.log("Desktop shell configuration is valid.");
