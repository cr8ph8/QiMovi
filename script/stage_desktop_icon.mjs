import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const iconSizes = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

/** Package the retained artwork with Apple's native icon tools; no runtime dependencies. */
export function stageDesktopIcon({ source, resources }) {
  if (!path.isAbsolute(source) || !path.isAbsolute(resources)) throw new Error('Icon source and resource directory must be absolute paths.');
  const bytes = fs.readFileSync(source);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Desktop icon artwork must be a PNG.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== height || width < 1024) throw new Error('Desktop icon artwork must be square and at least 1024 × 1024 pixels.');
  fs.mkdirSync(resources, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qimovi-icon-'));
  const iconset = path.join(temporary, 'QiMovi.iconset');
  const destination = path.join(resources, 'QiMovi.icns');
  try {
    fs.mkdirSync(iconset);
    for (const [filename, size] of iconSizes) {
      execFileSync('/usr/bin/sips', ['--resampleHeightWidth', String(size), String(size), source, '--out', path.join(iconset, filename)], { stdio: 'pipe' });
    }
    const generated = path.join(temporary, 'QiMovi.icns');
    execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', generated, iconset], { stdio: 'pipe' });
    const icon = fs.readFileSync(generated);
    if (icon.length <= 8 || icon.toString('ascii', 0, 4) !== 'icns' || icon.readUInt32BE(4) !== icon.length) {
      throw new Error('Apple iconutil did not produce a valid ICNS container.');
    }
    fs.copyFileSync(generated, destination);
    return {
      filename: 'QiMovi.icns',
      source: path.basename(source), width, height,
      sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sha256: crypto.createHash('sha256').update(icon).digest('hex'),
      representations: iconSizes.map(([filename, pixels]) => ({ filename, pixels })),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, resources] = process.argv.slice(2);
  if (!source || !resources) throw new Error('Usage: stage_desktop_icon.mjs AbsoluteSourcePNG AbsoluteResourceDirectory');
  console.log(JSON.stringify(stageDesktopIcon({ source, resources }), null, 2));
}
