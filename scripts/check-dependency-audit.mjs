#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  readFileSync(path.join(root, ".dependency-audit-baseline.json"), "utf8"),
);
const runtime = path.basename(process.execPath).startsWith("bun") ? process.execPath : "bun";
const result = spawnSync(runtime, ["audit", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

if (result.error) {
  console.error(`Unable to run Bun audit: ${result.error.message}`);
  process.exit(1);
}

let audit;
try {
  audit = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr);
  console.error("Bun audit did not return valid JSON.");
  process.exit(1);
}

const severities = ["critical", "high", "moderate", "low"];
const allowed = new Set(
  (baseline.allowedAdvisories ?? []).map(
    (entry) => `${entry.package}:${entry.id}:${entry.severity}`,
  ),
);
const currentAdvisories = Object.entries(audit).flatMap(([packageName, advisories]) =>
  advisories.map((advisory) => ({ packageName, ...advisory })),
);
const unexpected = currentAdvisories.filter(
  (advisory) => !allowed.has(`${advisory.packageName}:${advisory.id}:${advisory.severity}`),
);
const critical = currentAdvisories.filter((advisory) => advisory.severity === "critical").length;
if (critical > 0 || unexpected.length > 0) {
  if (critical > 0) console.error(`Dependency audit found ${critical} critical advisory entries.`);
  if (unexpected.length > 0) {
    console.error("Dependency audit found advisories outside the ID-pinned baseline:");
    for (const advisory of unexpected) {
      console.error(
        `  ${advisory.packageName} ${advisory.severity} ${advisory.id}: ${advisory.title}`,
      );
    }
  }
  process.exit(1);
}

const totals = Object.fromEntries(
  severities.map((severity) => [
    severity,
    currentAdvisories.filter((advisory) => advisory.severity === severity).length,
  ]),
);
console.log(
  `Dependency audit passed: ${totals.critical} critical, ${totals.high} high, ${totals.moderate} moderate, ${totals.low} low; every advisory matches the ID-pinned baseline.`,
);
