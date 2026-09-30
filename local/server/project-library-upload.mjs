import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { check } from './storage.mjs';
import { importProjectLibraryUpload } from './project-library.mjs';

export const LIBRARY_UPLOAD_LIMIT = 256 * 1024 * 1024;
// Owner authentication and origin checking happen in the shared HTTP handler.
export function createProjectLibraryUploadService(store) {
  let active, closing = false;
  return {
    async import(req) {
      check(!closing && !active, 'PROJECT_LIBRARY_IMPORT_BUSY', 409);
      const project = store.project();
      check(req.headers['x-library-project-id'] === project.id && req.headers['x-library-source-hash'] === String(project.sourceHash), 'PROJECT_LIBRARY_PROJECT_MISMATCH', 409);
      check(req.headers['content-type'] === 'application/octet-stream', 'PROJECT_LIBRARY_UPLOAD_TYPE_INVALID', 415);
      const declared = req.headers['x-library-byte-length'], expected = req.headers['x-library-sha256'];
      check(typeof declared === 'string' && /^[1-9][0-9]*$/.test(declared) && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected), 'PROJECT_LIBRARY_UPLOAD_HEADERS_INVALID', 422);
      const size = Number(declared);
      check(Number.isSafeInteger(size) && size <= LIBRARY_UPLOAD_LIMIT, 'PROJECT_LIBRARY_UPLOAD_TOO_LARGE', 413);
      if (req.headers['content-length']) check(req.headers['content-length'] === declared, 'PROJECT_LIBRARY_UPLOAD_LENGTH_MISMATCH', 422);
      let originalFilename;
      try { originalFilename = decodeURIComponent(req.headers['x-library-filename']); } catch { check(false, 'PROJECT_LIBRARY_FILENAME_INVALID', 422); }
      check(typeof originalFilename === 'string' && originalFilename.length > 0 && originalFilename.length <= 240 && !/[\x00-\x1f\x7f/\\]/.test(originalFilename) && !['.', '..', 'undefined'].includes(originalFilename), 'PROJECT_LIBRARY_FILENAME_INVALID', 422);
      const filename = path.join(store.directory, 'blobs', `library-intake-${crypto.randomUUID()}.tmp`);
      let fd, complete;
      const done = new Promise(resolve => { complete = resolve; });
      active = { req, done };
      try {
        fd = fs.openSync(filename, 'wx', 0o600);
        const hash = crypto.createHash('sha256'); let bytes = 0;
        for await (const chunk of req) {
          check(!closing, 'PROJECT_LIBRARY_UPLOAD_INTERRUPTED', 409);
          bytes += chunk.length; check(bytes <= size, 'PROJECT_LIBRARY_UPLOAD_TOO_LARGE', 413);
          hash.update(chunk); let offset = 0;
          while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
        }
        check(!closing && !req.aborted && req.complete, 'PROJECT_LIBRARY_UPLOAD_INTERRUPTED', 409);
        check(bytes === size && hash.digest('hex') === expected, 'PROJECT_LIBRARY_UPLOAD_BYTES_MISMATCH', 422);
        fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        return importProjectLibraryUpload(store, { filename, originalFilename });
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        fs.rmSync(filename, { force: true }); active = null; complete();
      }
    },
    async close() { closing = true; if (active) { const current = active; current.req.destroy(); await current.done; } },
  };
}
