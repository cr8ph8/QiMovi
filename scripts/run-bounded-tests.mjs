#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitest = path.join(root, "node_modules", ".bin", "vitest");
const timeoutMs = Number.parseInt(process.env.TEST_SUITE_TIMEOUT_MS ?? "180000", 10);
const reporter = process.env.VITEST_REPORTER ?? "dot";
const forceKillGraceMs = 5_000;

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("TEST_SUITE_TIMEOUT_MS must be a positive integer.");
  process.exit(2);
}

const child = spawn(vitest, ["run", `--reporter=${reporter}`, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, CI: process.env.CI ?? "true" },
  stdio: "inherit",
  detached: process.platform !== "win32",
});

let timedOut = false;
let forceKillTimer;

function signalChild(signal) {
  if (!child.pid) return;

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may not have established a process group yet; fall back to
      // signaling the direct process so the timeout still fails closed.
    }
  }

  child.kill(signal);
}

const timer = setTimeout(() => {
  timedOut = true;
  console.error(`\nTest suite exceeded ${timeoutMs}ms; terminating the Vitest process group.`);
  signalChild("SIGTERM");

  forceKillTimer = setTimeout(() => {
    console.error(
      `Vitest did not exit within ${forceKillGraceMs}ms of SIGTERM; forcing process-group shutdown.`,
    );
    signalChild("SIGKILL");
  }, forceKillGraceMs);
}, timeoutMs);

child.on("error", (error) => {
  clearTimeout(timer);
  clearTimeout(forceKillTimer);
  console.error(`Unable to start Vitest: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  clearTimeout(forceKillTimer);
  if (timedOut) process.exit(124);
  if (signal) {
    console.error(`Vitest exited after signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
