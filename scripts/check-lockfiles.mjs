#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const managerMatch = /^bun@(.+)$/.exec(packageJson.packageManager ?? "");
const errors = [];

if (!existsSync(path.join(root, "bun.lock"))) {
  errors.push("bun.lock is required.");
}

for (const filename of [
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]) {
  if (existsSync(path.join(root, filename))) {
    errors.push(`${filename} is not allowed; Bun's text lockfile is canonical.`);
  }
}

if (!managerMatch) {
  errors.push('package.json must declare an exact "packageManager": "bun@<version>".');
} else if (process.versions.bun !== managerMatch[1]) {
  errors.push(
    `Bun runtime ${process.versions.bun ?? "unknown"} does not match packageManager bun@${managerMatch[1]}.`,
  );
}

if (errors.length > 0) {
  console.error("Lockfile policy failed:");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`Lockfile policy passed: bun.lock only; Bun ${managerMatch[1]}.`);
