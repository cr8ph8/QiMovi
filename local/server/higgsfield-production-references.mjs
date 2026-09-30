import { isIP } from 'node:net';
import { isPublicMediaAddress, mcpToolData, mediaUrl } from './higgsfield-mcp-media.mjs';

// This helper resolves existing selections only. It never chooses a voice,
// creates an Element, uploads media or grants permission to use a reference.
const voiceModels = new Set(['seed_audio', 'text2speech_v2', 'qwen_audio_tts']);
const elementModels = new Set(['nano_banana_pro', 'nano_banana_2', 'gpt_image_2', 'seedream_v4_5', 'seedream_v5_lite', 'cinematic_studio_2_5', 'kling3_0', 'cinematic_studio_3_0', 'cinematic_studio_video_v2', 'seedance_2_0']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value) && value.isWellFormed();
const need = (value, code, status = 502) => { if (!value) throw Object.assign(new Error(code), { code, status }); };

export function productionReferenceRequirements(params) {
  need(object(params) && text(params.model, 200, true) && typeof params.prompt === 'string' && params.prompt.length <= 200000 && params.prompt.isWellFormed() && !params.prompt.includes('\0'), 'STUDIO_REFERENCE_REQUEST_INVALID', 422);
  let voice = null;
  if (voiceModels.has(params.model) || own(params, 'voice_id') || own(params, 'voice_type')) {
    need(voiceModels.has(params.model), 'HIGGSFIELD_VOICE_MODEL_UNSUPPORTED', 422);
    need(text(params.voice_id, 200, true) && ['preset', 'element'].includes(params.voice_type), 'HIGGSFIELD_SELECTED_VOICE_PAIR_REQUIRED', 422);
    voice = { voice_id: params.voice_id, voice_type: params.voice_type };
  }
  const delimiters = [...params.prompt.matchAll(/<{3,}|>{3,}/g)].map(match => match[0]);
  const markers = [...params.prompt.matchAll(/<<<([^<>]*)>>>/g)].map(match => match[1]);
  if (delimiters.length) {
    need(delimiters.every(run => run === '<<<' || run === '>>>') && delimiters.length === markers.length * 2 && markers.every(uuid) && !/<<<|>>>/.test(params.prompt.replace(/<<<([^<>]*)>>>/g, '')), 'HIGGSFIELD_ELEMENT_MARKER_INVALID', 422);
    need(elementModels.has(params.model), 'HIGGSFIELD_ELEMENT_MODEL_UNSUPPORTED', 422);
  }
  const elementIds = [...new Set(markers.map(id => id.toLowerCase()))].sort();
  need(elementIds.length <= 16, 'HIGGSFIELD_ELEMENT_LIMIT', 422);
  return { voice, elementIds };
}

// Keep transformations/content selectors in the identity. Only common signed
// access parameters are discarded; the exact original URL stays in evidence.
const ephemeralQuery = new Set(['signature', 'sig', 'expires', 'expiry', 'expiration', 'token', 'access_token', 'auth', 'authorization', 'policy', 'key-pair-id', 'awsaccesskeyid', 'googleaccessid', 'se', 'st', 'sp', 'sv', 'sr', 'spr', 'sip', 'skoid', 'sktid', 'skt', 'ske', 'sks', 'skv']);
function stableUrl(value) {
  need(text(value, 16384, true), 'HIGGSFIELD_REFERENCE_URL_INVALID');
  let url;
  try { url = new URL(value); } catch { need(false, 'HIGGSFIELD_REFERENCE_URL_INVALID'); }
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443'), 'HIGGSFIELD_REFERENCE_URL_INVALID');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  need(host && host.includes('.') && host !== 'localhost' && !/\.(?:localhost|local|internal|home|lan|test|invalid)$/.test(host) && (!isIP(host) || isPublicMediaAddress(host)), 'HIGGSFIELD_REFERENCE_URL_NOT_PUBLIC');
  const stable = [...url.searchParams].filter(([key]) => !ephemeralQuery.has(key.toLowerCase()) && !/^(?:x-amz-|x-goog-)/i.test(key)).sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  url.search = '';
  for (const [key, value] of stable) url.searchParams.append(key, value);
  return url.href;
}

function voiceIdentity(row) {
  need(object(row) && text(row.voice_id, 200, true) && ['preset', 'element'].includes(row.voice_type) && text(row.name, 500, true) && (row.gender === null || text(row.gender, 100, true)), 'HIGGSFIELD_VOICES_INVALID');
  const identity = { voice_id: row.voice_id, voice_type: row.voice_type, name: row.name, gender: row.gender };
  for (const key of ['preview_url', 'logo_url']) if (own(row, key)) identity[key] = stableUrl(row[key]);
  return identity;
}

export function elementIdentity(row, expectedId, { requireCompleted = true } = {}) {
  need(object(row) && uuid(row.id) && row.id.toLowerCase() === expectedId, 'HIGGSFIELD_ELEMENT_ID_MISMATCH');
  need(text(row.name, 500, true) && text(row.category, 200, true) && (row.description === null || typeof row.description === 'string' && row.description.length <= 16000 && row.description.isWellFormed() && !row.description.includes('\0')) && typeof row.created_at === 'number' && Number.isFinite(row.created_at) && row.created_at >= 0 && row.created_at <= Number.MAX_SAFE_INTEGER && text(row.status, 100, true), 'HIGGSFIELD_ELEMENT_INVALID');
  if (requireCompleted) need(row.status === 'completed', 'HIGGSFIELD_ELEMENT_NOT_READY', 409);
  need(Array.isArray(row.medias) && (row.status !== 'completed' || row.medias.length > 0) && row.medias.length <= 100 && Array.isArray(row.video_medias) && row.video_medias.length <= 100, 'HIGGSFIELD_ELEMENT_MEDIA_INVALID');
  const medias = (items) => {
    const seen = new Set();
    return items.map(item => {
      need(object(item) && uuid(item.id) && text(item.type, 100, true), 'HIGGSFIELD_ELEMENT_MEDIA_INVALID');
      const id = item.id.toLowerCase(), key = `${item.type}:${id}`;
      need(!seen.has(key), 'HIGGSFIELD_ELEMENT_MEDIA_DUPLICATE'); seen.add(key);
      return { id, type: item.type, url: stableUrl(item.url) };
    });
  };
  return { id: expectedId, name: row.name, category: row.category, description: row.description, status: row.status, created_at: row.created_at, medias: medias(row.medias), video_medias: medias(row.video_medias) };
}

/** Private creation runner input. Public Element lookup remains list/get only. */
export function validateReferenceCreateArguments(args) {
  need(object(args) && args.action === 'create' && Object.keys(args).every(key => ['action', 'name', 'category', 'description', 'medias'].includes(key)), 'STUDIO_REFERENCE_CREATE_INPUT_INVALID', 422);
  need(!own(args, 'name') || text(args.name, 32, true), 'STUDIO_REFERENCE_NAME_INVALID', 422);
  need(!own(args, 'category') || ['auto', 'character', 'environment', 'prop'].includes(args.category), 'STUDIO_REFERENCE_CATEGORY_INVALID', 422);
  need(!own(args, 'description') || typeof args.description === 'string' && args.description.length <= 16000 && args.description.isWellFormed() && !args.description.includes('\0'), 'STUDIO_REFERENCE_DESCRIPTION_INVALID', 422);
  need(Array.isArray(args.medias) && args.medias.length > 0 && args.medias.length <= 8, 'STUDIO_REFERENCE_IMAGES_REQUIRED', 422);
  const ids = new Set();
  for (const row of args.medias) {
    need(object(row) && Object.keys(row).sort().join(',') === 'id,type,url' && uuid(row.id) && row.type === 'media_input' && !ids.has(row.id.toLowerCase()), 'STUDIO_REFERENCE_MEDIA_INVALID', 422);
    mediaUrl(row.url); stableUrl(row.url); ids.add(row.id.toLowerCase());
  }
  return args;
}

export async function resolveProductionReferences({ params, callTool, evidence }) {
  const requirements = productionReferenceRequirements(params), evidenceHashes = [];
  need(typeof callTool === 'function' && typeof evidence === 'function', 'STUDIO_REFERENCE_RESOLVER_INVALID', 422);
  const read = async (action, input) => {
    const raw = await callTool(action, input), hash = await evidence(raw);
    need(digest(hash), 'STUDIO_REFERENCE_EVIDENCE_INVALID');
    if (!evidenceHashes.includes(hash)) evidenceHashes.push(hash);
    return mcpToolData(raw);
  };
  let voice = null;
  if (requirements.voice) {
    const voices = new Map(), cursors = new Set(); let cursor;
    for (let page = 0; page < 20; page++) {
      const data = await read('list_voices', { size: 100, ...(cursor === undefined ? {} : { cursor }) });
      need(Array.isArray(data.voices) && data.voices.length <= 100 && typeof data.has_more === 'boolean', 'HIGGSFIELD_VOICES_PAGE_INVALID');
      need(!own(data, 'next_cursor') || typeof data.next_cursor === 'string' && data.next_cursor.length <= 4096 && data.next_cursor.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(data.next_cursor), 'HIGGSFIELD_VOICES_PAGE_INVALID');
      for (const item of data.voices) {
        const entry = voiceIdentity(item), key = JSON.stringify([entry.voice_type, entry.voice_id]), previous = voices.get(key);
        need(!previous || JSON.stringify(previous) === JSON.stringify(entry), 'HIGGSFIELD_VOICE_IDENTITY_CONFLICT');
        voices.set(key, entry);
        if (entry.voice_id === requirements.voice.voice_id && entry.voice_type === requirements.voice.voice_type) voice = entry;
      }
      if (!data.has_more) {
        need(!data.next_cursor, 'HIGGSFIELD_VOICES_CURSOR_INCONSISTENT');
        break;
      }
      need(data.voices.length > 0 && text(data.next_cursor, 4096, true), 'HIGGSFIELD_VOICES_CURSOR_INCONSISTENT');
      need(!cursors.has(data.next_cursor), 'HIGGSFIELD_VOICES_CURSOR_LOOP');
      cursors.add(data.next_cursor); cursor = data.next_cursor;
      need(page < 19, 'HIGGSFIELD_VOICES_PAGE_LIMIT');
    }
    need(voice, 'HIGGSFIELD_SELECTED_VOICE_NOT_FOUND', 409);
  }
  const elements = [];
  for (const id of requirements.elementIds) {
    const data = await read('show_reference_elements', { action: 'get', element_id: id });
    need(Array.isArray(data.items) && data.items.length === 1 && (!own(data, 'next_cursor') || data.next_cursor === null) && !own(data, 'element'), 'HIGGSFIELD_ELEMENT_RESPONSE_INVALID');
    elements.push(elementIdentity(data.items[0], id));
  }
  return { voice, elements, evidenceHashes };
}
