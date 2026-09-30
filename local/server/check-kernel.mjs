import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, sha256 } from './storage.mjs';

const root = fileURLToPath(new URL('../kernel/', import.meta.url));
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'SOURCE_PROVENANCE.json')));
for (const item of provenance.files) {
  const bytes = fs.readFileSync(path.join(root, item.path));
  check(bytes.length === item.bytes && sha256(bytes) === item.sha256, `VENDORED_BYTES_CHANGED:${item.path}`);
}
// These eight suites are self-contained. The original full suite additionally
// reads sibling production-template-library and exact ARCHi output fixtures.
const names = ['artifact-instances', 'evidence-lifecycle', 'kernel', 'schema-parity', 'source-admission-runtime', 'source-authority-boundary', 'source-intake-contract', 'source-intake-runtime'];
const result = spawnSync(process.execPath, ['--test', ...names.map(name => path.join(root, 'tests', `${name}.test.mjs`))], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
