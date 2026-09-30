import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyHiggsfieldRuntime } from '../local/server/higgsfield-runtime.mjs';

// Optional, pinned desktop dependency. This copies owned bytes only; it never
// downloads, installs globally, authenticates, or invokes the provider CLI.
export function stageHiggsfieldRuntime({ source, runtime, resources }) {
  if (![source, runtime, resources].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('HIGGSFIELD_STAGING_ABSOLUTE_PATHS_REQUIRED');
  const qualified = verifyHiggsfieldRuntime(source);
  const destination = path.join(runtime, 'local/integrations/higgsfield-cli');
  const notices = path.join(resources, 'Notices/Higgsfield-CLI');
  if (fs.existsSync(destination) || fs.existsSync(notices)) throw new Error('HIGGSFIELD_STAGING_DESTINATION_EXISTS');
  const texts = ['LICENSE', 'THIRD-PARTY-NOTICES.txt'].map(name => {
    const filename = path.join(source, name), stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('HIGGSFIELD_NOTICE_INVALID');
    const bytes = fs.readFileSync(filename);
    if (!bytes.length) throw new Error('HIGGSFIELD_NOTICE_EMPTY');
    return { name, bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(notices, { recursive: true });
  fs.copyFileSync(qualified.filename, path.join(destination, 'hf')); fs.chmodSync(path.join(destination, 'hf'), 0o755);
  texts.forEach(text => fs.writeFileSync(path.join(notices, text.name), text.bytes, { flag: 'wx' }));
  const { filename, ...identity } = qualified;
  const receipt = { schemaVersion: 1, ...identity, notices: texts.map(({ name, sha256 }) => ({ name, sha256 })), credentialsBundled: false };
  fs.writeFileSync(path.join(destination, 'runtime.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  verifyHiggsfieldRuntime(destination);
  return receipt;
}
