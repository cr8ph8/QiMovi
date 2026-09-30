import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { STUDIO_MEDIA_MAX_BYTES, STUDIO_MEDIA_MIMES } from '../contracts/studio-media.mjs';
import { matchesStudioMediaContainer } from './studio-media.mjs';

// Internal runner helpers: never expose callTool/requestImpl or arbitrary URLs as
// a public HTTP proxy. The runner supplies only owned blobs and observed job URLs.
export const HIGGSFIELD_MEDIA_MAX_BYTES = STUDIO_MEDIA_MAX_BYTES;
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, status = 422) => Object.assign(new Error(code), { code, status });
const need = (value, code, status) => { if (!value) throw fail(code, status); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function boundedJson(value) {
  let count = 0;
  const visit = (item, depth) => {
    need(++count <= 100000 && depth <= 48, 'HIGGSFIELD_MCP_DATA_LIMIT');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number') { need(Number.isFinite(item), 'HIGGSFIELD_MCP_DATA_INVALID'); return; }
    need(Array.isArray(item) || object(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'HIGGSFIELD_MCP_DATA_INVALID');
    for (const key of Object.keys(item)) {
      need(!['__proto__', 'prototype', 'constructor'].includes(key), 'HIGGSFIELD_MCP_DATA_INVALID');
      visit(item[key], depth + 1);
    }
  };
  visit(value, 0);
  const json = JSON.stringify(value);
  need(Buffer.byteLength(json) <= 4 * 1024 * 1024, 'HIGGSFIELD_MCP_DATA_LIMIT');
  return JSON.parse(json);
}

/** MCP CallToolResult projection, never a guessed REST/CLI envelope. Structured
 * data wins; otherwise require exactly one object-valued JSON text block. Other
 * human-readable text is allowed, never executed or used as approval evidence.
 */
export function mcpToolData(result) {
  need(object(result), 'HIGGSFIELD_MCP_RESULT_INVALID');
  need(!own(result, 'isError') || typeof result.isError === 'boolean', 'HIGGSFIELD_MCP_RESULT_INVALID');
  need(result.isError !== true, 'HIGGSFIELD_MCP_TOOL_FAILED', 502);
  result = boundedJson(result);
  let data;
  if (own(result, 'structuredContent')) {
    need(object(result.structuredContent), 'HIGGSFIELD_MCP_DATA_INVALID');
    data = result.structuredContent;
  } else {
    need(Array.isArray(result.content), 'HIGGSFIELD_MCP_DATA_MISSING');
    const candidates = [];
    for (const item of result.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      let parsed;
      try { parsed = JSON.parse(item.text); } catch { continue; }
      if (object(parsed)) candidates.push(parsed);
    }
    need(candidates.length === 1, 'HIGGSFIELD_MCP_DATA_AMBIGUOUS');
    data = boundedJson(candidates[0]);
  }
  need(!own(data, 'error') || data.error === null || data.error === '', 'HIGGSFIELD_MCP_TOOL_FAILED', 502);
  return data;
}

const reserved = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) reserved.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) reserved.addSubnet(address, prefix, 'ipv6');

// Exported for deterministic policy tests; no DNS or account access occurs here.
export function isPublicMediaAddress(address) {
  const family = isIP(address);
  return family === 4 ? !reserved.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !reserved.check(address, 'ipv6');
}

export function mediaUrl(value) {
  need(typeof value === 'string' && value.length > 0 && value.length <= 16384, 'HIGGSFIELD_MEDIA_URL_INVALID');
  let url;
  try { url = new URL(value); } catch { throw fail('HIGGSFIELD_MEDIA_URL_INVALID'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443'), 'HIGGSFIELD_MEDIA_URL_INVALID');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  need(host && !host.endsWith('.localhost') && host !== 'localhost', 'HIGGSFIELD_MEDIA_URL_NOT_PUBLIC');
  if (isIP(host)) need(isPublicMediaAddress(host), 'HIGGSFIELD_MEDIA_URL_NOT_PUBLIC');
  return url;
}

function aborted(signal) { if (signal?.aborted) throw fail('HIGGSFIELD_MEDIA_ABORTED', 409); }

/** No redirect following, proxy environment, cookies or provider Authorization.
 * All DNS answers must be public; one validated answer is pinned in lookup, while
 * TLS still verifies the original hostname. DNS cannot be queried a second time
 * between validation and connect. Only this request's socket is owned/cancelled.
 */
export async function requestPublicMedia({ url: input, method, bytes, mimeType, signal, maxBytes = HIGGSFIELD_MEDIA_MAX_BYTES, timeoutMs = 120000 }, { lookupImpl = dns.lookup, httpsRequestImpl = https.request } = {}) {
  const url = mediaUrl(input);
  need(['GET', 'PUT'].includes(method) && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= HIGGSFIELD_MEDIA_MAX_BYTES, 'HIGGSFIELD_MEDIA_REQUEST_INVALID');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 180000, 'HIGGSFIELD_MEDIA_REQUEST_INVALID');
  need(method === 'GET' ? bytes === undefined && mimeType === undefined : Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= HIGGSFIELD_MEDIA_MAX_BYTES && STUDIO_MEDIA_MIMES.includes(mimeType), 'HIGGSFIELD_MEDIA_REQUEST_INVALID');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let removeAbort = () => {};
  try {
    aborted(combined);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const answers = await Promise.race([
      isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : lookupImpl(host, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        const stop = () => reject(fail('HIGGSFIELD_MEDIA_ABORTED', 409));
        combined.addEventListener('abort', stop, { once: true });
        removeAbort = () => combined.removeEventListener('abort', stop);
      }),
    ]);
    removeAbort(); aborted(combined);
    need(Array.isArray(answers) && answers.length > 0 && answers.length <= 64 && answers.every(answer => isPublicMediaAddress(answer.address)), 'HIGGSFIELD_MEDIA_URL_NOT_PUBLIC');
    const pinned = answers[0];
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; error ? reject(error) : resolve(result); };
      const req = httpsRequestImpl(url, {
        method, agent: false, signal: combined, rejectUnauthorized: true,
        headers: method === 'PUT' ? { 'Content-Type': mimeType, 'Content-Length': String(bytes.length), 'Accept-Encoding': 'identity' } : { Accept: 'image/*,video/*,audio/*,application/octet-stream', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, callback) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      }, response => {
        if (response.statusCode !== 200) {
          response.destroy(); req.destroy();
          finish(fail(response.statusCode >= 300 && response.statusCode < 400 ? 'HIGGSFIELD_MEDIA_REDIRECT_REJECTED' : 'HIGGSFIELD_MEDIA_HTTP_ERROR', 502)); return;
        }
        const size = response.headers['content-length'];
        if (size !== undefined && (!/^\d+$/.test(size) || Number(size) > maxBytes)) {
          response.destroy(); req.destroy(); finish(fail('HIGGSFIELD_MEDIA_TOO_LARGE', 413)); return;
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          response.destroy(); req.destroy(); finish(fail('HIGGSFIELD_MEDIA_ENCODING_REJECTED', 502)); return;
        }
        const chunks = []; let length = 0;
        response.on('data', chunk => {
          length += chunk.length;
          if (length > maxBytes) { response.destroy(); req.destroy(); finish(fail('HIGGSFIELD_MEDIA_TOO_LARGE', 413)); return; }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (!response.complete || size !== undefined && Number(size) !== length) { finish(fail('HIGGSFIELD_MEDIA_TRANSFER_INCOMPLETE', 502)); return; }
          finish(null, { statusCode: 200, headers: { 'content-type': response.headers['content-type'] ?? '', 'content-length': String(length) }, bytes: Buffer.concat(chunks, length) });
        });
        response.on('error', () => finish(fail(combined.aborted ? 'HIGGSFIELD_MEDIA_ABORTED' : 'HIGGSFIELD_MEDIA_TRANSFER_INCOMPLETE', 502)));
      });
      req.on('error', () => finish(fail(combined.aborted ? 'HIGGSFIELD_MEDIA_ABORTED' : 'HIGGSFIELD_MEDIA_UNAVAILABLE', 502)));
      req.end(bytes);
    });
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('HIGGSFIELD_')) throw error;
    throw fail('HIGGSFIELD_MEDIA_UNAVAILABLE', 502);
  } finally { clearTimeout(timer); removeAbort(); }
}

function container(bytes, mimeType) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= HIGGSFIELD_MEDIA_MAX_BYTES && STUDIO_MEDIA_MIMES.includes(mimeType), 'HIGGSFIELD_MEDIA_TYPE_OR_SIZE_INVALID');
  need(matchesStudioMediaContainer(bytes, mimeType), 'HIGGSFIELD_MEDIA_CONTAINER_MISMATCH');
  // Container recognition is deliberately the same as local reference intake.
  // It is not codec decoding, measured duration, final QC or a usage licence.
}

/** onAllocated MUST persist the safe allocation receipt before bytes are sent.
 * IDs are scoped by the calling runner's frozen provider workspace. There is no
 * automatic retry on allocation, PUT or confirmation failure.
 */
export async function uploadOwnedMedia({ callTool, blob, filename, signal, onAllocated, includeBackendUrl = false, requestImpl = requestPublicMedia }) {
  need(typeof callTool === 'function' && typeof onAllocated === 'function' && typeof requestImpl === 'function', 'HIGGSFIELD_MEDIA_CALLBACK_REQUIRED');
  need(object(blob) && Buffer.isBuffer(blob.bytes) && typeof blob.sha256 === 'string' && /^[a-f0-9]{64}$/.test(blob.sha256), 'HIGGSFIELD_MEDIA_BLOB_INVALID');
  const bytes = Buffer.from(blob.bytes), mimeType = blob.mimeType, hash = blob.sha256;
  container(bytes, mimeType);
  need(sha256(bytes) === hash, 'HIGGSFIELD_MEDIA_HASH_MISMATCH');
  need(typeof filename === 'string' && filename.trim().length > 0 && filename.length <= 240 && filename.isWellFormed() && !/[\x00-\x1f\x7f/\\]/.test(filename) && !['.', '..'].includes(filename), 'HIGGSFIELD_MEDIA_FILENAME_INVALID');
  const suffix = filename.toLowerCase().split('.').at(-1);
  need(suffix === extensions[mimeType] || mimeType === 'image/jpeg' && suffix === 'jpeg' || mimeType === 'audio/wav' && suffix === 'wave', 'HIGGSFIELD_MEDIA_FILENAME_TYPE_MISMATCH');
  const mediaType = mimeType.split('/')[0];
  aborted(signal);
  const allocationResponse = await callTool('media_upload', { filename, content_type: mimeType, method: 'upload_url' });
  const allocation = mcpToolData(allocationResponse);
  need(Array.isArray(allocation.uploads) && allocation.uploads.length === 1, 'HIGGSFIELD_MEDIA_ALLOCATION_INVALID');
  const upload = allocation.uploads[0];
  need(object(upload) && uuid(upload.media_id) && upload.method === 'PUT' && upload.content_type === mimeType && Number.isFinite(upload.expires_in_seconds) && upload.expires_in_seconds > 0, 'HIGGSFIELD_MEDIA_ALLOCATION_INVALID');
  mediaUrl(upload.upload_url);
  const receipt = { mediaId: upload.media_id, mediaType, sha256: hash, mimeType, byteLength: bytes.length,
    allocationResponseSha256: sha256(JSON.stringify(allocationResponse)), expiresInSeconds: upload.expires_in_seconds, status: 'ALLOCATED' };
  // Never store the signed PUT URL, generated instructions or request credentials.
  await onAllocated(Object.freeze({ ...receipt }));
  aborted(signal);
  const sent = await requestImpl({ url: upload.upload_url, method: 'PUT', bytes, mimeType, signal, maxBytes: 1024 * 1024 });
  need(sent?.statusCode === 200, 'HIGGSFIELD_MEDIA_PUT_NOT_CONFIRMED', 502);
  aborted(signal);
  const confirmationResponse = await callTool('media_confirm', { media_id: receipt.mediaId, type: mediaType });
  const confirmation = mcpToolData(confirmationResponse);
  need(Array.isArray(confirmation.results) && confirmation.results.length === 1, 'HIGGSFIELD_MEDIA_CONFIRMATION_INVALID');
  const confirmed = confirmation.results[0];
  need(object(confirmed) && confirmed.media_id === receipt.mediaId && (!own(confirmed, 'type') || confirmed.type === mediaType), 'HIGGSFIELD_MEDIA_CONFIRMATION_MISMATCH');
  // Actual retained media_confirm responses (2026-08-20/21) say "uploaded".
  // Current metadata declares only status:string; new values fail closed pending
  // qualification rather than interpreting arbitrary non-error strings as success.
  need(confirmed.status === 'uploaded', 'HIGGSFIELD_MEDIA_CONFIRMATION_STATUS_UNQUALIFIED', 502);
  const result = { ...receipt, status: 'uploaded', confirmationResponseSha256: sha256(JSON.stringify(confirmationResponse)) };
  if (includeBackendUrl) {
    // Elements needs the explicit backend media URL as well as the confirmed ID.
    // Never infer it from a signed PUT URL or alter its query parameters.
    const backendUrl = confirmed.url ?? upload.url;
    need(typeof backendUrl === 'string', 'HIGGSFIELD_MEDIA_BACKEND_URL_MISSING', 502);
    mediaUrl(backendUrl);
    need(backendUrl !== upload.upload_url, 'HIGGSFIELD_MEDIA_BACKEND_URL_UNQUALIFIED', 502);
    result.mediaUrl = backendUrl;
  }
  return result;
}

export async function downloadGeneratedMedia({ url, outputType, signal, requestImpl = requestPublicMedia }) {
  need(['image', 'video', 'audio'].includes(outputType) && typeof requestImpl === 'function', 'HIGGSFIELD_MEDIA_OUTPUT_TYPE_INVALID');
  mediaUrl(url); aborted(signal);
  const response = await requestImpl({ url, method: 'GET', signal, maxBytes: HIGGSFIELD_MEDIA_MAX_BYTES });
  need(response?.statusCode === 200 && Buffer.isBuffer(response.bytes), 'HIGGSFIELD_MEDIA_DOWNLOAD_FAILED', 502);
  aborted(signal);
  const bytes = Buffer.from(response.bytes);
  need(bytes.length > 0 && bytes.length <= HIGGSFIELD_MEDIA_MAX_BYTES, 'HIGGSFIELD_MEDIA_TOO_LARGE', 413);
  const rawContentType = response.headers?.['content-type'];
  need(typeof rawContentType === 'string', 'HIGGSFIELD_MEDIA_RESPONSE_TYPE_MISSING');
  const declared = rawContentType.split(';', 1)[0].trim().toLowerCase();
  const observed = STUDIO_MEDIA_MIMES.filter(mime => mime.startsWith(outputType + '/') && matchesStudioMediaContainer(bytes, mime));
  need(observed.length === 1, 'HIGGSFIELD_MEDIA_CONTAINER_MISMATCH');
  const mimeType = observed[0];
  need(declared === mimeType || declared === 'application/octet-stream' || mimeType === 'audio/wav' && ['audio/x-wav', 'audio/wave'].includes(declared), 'HIGGSFIELD_MEDIA_RESPONSE_TYPE_MISMATCH');
  container(bytes, mimeType);
  const hash = sha256(bytes);
  return { bytes, mimeType, sha256: hash, filename: `generated-${hash.slice(0, 16)}.${extensions[mimeType]}` };
}
