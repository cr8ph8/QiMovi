#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eslint = path.join(root, "node_modules", ".bin", "eslint");
const baselinePath = path.join(root, ".eslint-debt-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const result = spawnSync(eslint, [".", "--format", "json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (result.error) {
  console.error(`Unable to start ESLint: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr);
  console.error("ESLint did not return a valid JSON report.");
  process.exit(1);
}

const errors = [];
const warnings = new Map();
for (const file of report) {
  for (const message of file.messages) {
    const rule = message.ruleId ?? "unused-disable";
    if (message.severity === 2) {
      errors.push(`${path.relative(root, file.filePath)}:${message.line}:${message.column} ${rule}: ${message.message}`);
    } else if (message.severity === 1) {
      warnings.set(rule, (warnings.get(rule) ?? 0) + 1);
    }
  }
}

if (errors.length > 0) {
  console.error(`ESLint found ${errors.length} blocking error(s):`);
  for (const error of errors.slice(0, 50)) console.error(`  ${error}`);
  if (errors.length > 50) console.error(`  ...and ${errors.length - 50} more`);
  process.exit(1);
}

const increases = [];
for (const [rule, count] of warnings) {
  const ceiling = baseline[rule] ?? 0;
  if (count > ceiling) increases.push(`${rule}: ${count} > ${ceiling}`);
}

if (increases.length > 0) {
  console.error("ESLint warning debt increased:");
  for (const increase of increases) console.error(`  ${increase}`);
  process.exit(1);
}

const warningTotal = [...warnings.values()].reduce((sum, count) => sum + count, 0);
const ceilingTotal = Object.values(baseline).reduce((sum, count) => sum + count, 0);
console.log(`ESLint passed: 0 errors; ${warningTotal} warning(s) within the ${ceilingTotal}-warning baseline.`);
