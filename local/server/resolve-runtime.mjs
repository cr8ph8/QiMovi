import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const RESOLVE_APP_PATHS = Object.freeze(['/Applications/DaVinci Resolve.app', '/Applications/DaVinci Resolve/DaVinci Resolve.app']);
export const RESOLVE_PYTHON_PATHS = Object.freeze(['/usr/bin/python3', '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']);
const exec = promisify(execFile);
const validPath = value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value) && value.length <= 4096;
const cleanText = value => typeof value === 'string' && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
async function accessible(filename, permission = constants.R_OK) { try { await fs.access(filename, permission); return true; } catch { return false; } }
async function metadata(appPath) {
  try {
    const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents/Info.plist')], { timeout: 3000, maxBuffer: 128 * 1024, windowsHide: true });
    const info = JSON.parse(stdout);
    return { version: cleanText(info.CFBundleShortVersionString), productName: cleanText(info.CFBundleDisplayName ?? info.CFBundleName) };
  } catch { return { version: null, productName: null }; }
}

/** Paths are trusted server constructor configuration, never browser input. */
export async function detectResolveInstallation({ appPaths = RESOLVE_APP_PATHS, pythonPaths = RESOLVE_PYTHON_PATHS, platform = process.platform, readMetadata = metadata } = {}) {
  if (!Array.isArray(appPaths) || !appPaths.every(validPath) || !Array.isArray(pythonPaths) || !pythonPaths.every(validPath)) throw Object.assign(new Error('RESOLVE_CONFIGURATION_INVALID'), { code: 'RESOLVE_CONFIGURATION_INVALID', status: 422 });
  const result = { found: false, appPath: null, version: null, productName: null, sdkAvailable: false, pythonAvailable: false, pythonPath: null };
  if (platform !== 'darwin') return result;
  for (const candidate of appPaths) {
    if (await accessible(path.join(candidate, 'Contents/Info.plist'))) { result.found = true; result.appPath = await fs.realpath(candidate); Object.assign(result, await readMetadata(result.appPath)); break; }
  }
  for (const candidate of pythonPaths) if (await accessible(candidate, constants.X_OK)) { result.pythonAvailable = true; result.pythonPath = await fs.realpath(candidate); break; }
  if (result.appPath) result.sdkAvailable = await accessible(path.join(result.appPath, 'Contents/Resources/Developer/Scripting/Modules/DaVinciResolveScript.py')) && await accessible(path.join(result.appPath, 'Contents/Libraries/Fusion/fusionscript.so'));
  return result;
}
