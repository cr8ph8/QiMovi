import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Official release qualified separately from the MCP-host model catalog.
// Updating this pin requires repeating the CLI adapter checks.
export const HIGGSFIELD_RUNTIME = Object.freeze({
  version: '1.1.24', platform: 'darwin', architecture: 'arm64', binary: 'hf',
  binarySha256: 'c0ec3a6dafbf6c23e4803c8c7d382adc7cb7d94de4a3f82f613811d4bd94b9c7',
  archiveSha256: 'cf23707ea8f437c93102d891125c10318c5812233f60b4c3bfda2d1d5334fe4b',
  release: 'https://github.com/higgsfield-ai/cli/releases/tag/v1.1.24',
});

export function verifyHiggsfieldRuntime(directory) {
  return verifyHiggsfieldExecutable(path.join(directory, HIGGSFIELD_RUNTIME.binary));
}

export function verifyHiggsfieldExecutable(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw new Error('HIGGSFIELD_RUNTIME_INVALID');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  if (hash !== HIGGSFIELD_RUNTIME.binarySha256) throw new Error('HIGGSFIELD_RUNTIME_HASH_MISMATCH');
  return { filename, ...HIGGSFIELD_RUNTIME };
}

export function bundledHiggsfieldRuntime() {
  const directory = fileURLToPath(new URL('../integrations/higgsfield-cli/', import.meta.url));
  if (!fs.existsSync(directory)) return null;
  try { return verifyHiggsfieldRuntime(directory); } catch { return { invalid: true }; }
}
