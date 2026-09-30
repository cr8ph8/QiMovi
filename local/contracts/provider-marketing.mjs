// Shared browser/server projections of read-only provider catalogs. Display
// availability is not ownership, permission, generation or creative approval.
export const MARKETING_KINDS = Object.freeze(['brand', 'product', 'presenter', 'hook', 'setting', 'style', 'format']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code, status = 502) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const string = (value, max = 16000, nonempty = false) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !value.includes('\0') && (!nonempty || value.trim().length > 0);
const id = value => string(value, 200, true) && !/[\u0000-\u0020\u007f<>]/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const actions = { brand: 'marketing_list_brand_kits', product: 'marketing_list_products', presenter: 'marketing_list_avatars', hook: 'marketing_list_hooks', setting: 'marketing_list_settings', style: 'marketing_list_ad_formats', format: 'marketing_list_video_presets' };
const authQuery = new Set(['signature', 'sig', 'expires', 'expiry', 'expiration', 'token', 'access_token', 'auth', 'authorization', 'policy', 'key-pair-id', 'awsaccesskeyid', 'googleaccessid', 'se', 'st', 'sp', 'sv', 'sr', 'spr', 'sip', 'skoid', 'sktid', 'skt', 'ske', 'sks', 'skv']);

function bounded(value) {
  let count = 0;
  const visit = (entry, depth) => {
    need(++count <= 100000 && depth <= 32, 'HIGGSFIELD_MARKETING_DATA_LIMIT');
    if (entry === null || typeof entry === 'boolean') return;
    if (typeof entry === 'string') { need(entry.isWellFormed() && !entry.includes('\0'), 'HIGGSFIELD_MARKETING_DATA_INVALID'); return; }
    if (typeof entry === 'number') { need(Number.isFinite(entry), 'HIGGSFIELD_MARKETING_DATA_INVALID'); return; }
    need(Array.isArray(entry) || object(entry) && [Object.prototype, null].includes(Object.getPrototypeOf(entry)), 'HIGGSFIELD_MARKETING_DATA_INVALID');
    for (const key of Object.keys(entry)) {
      need(!['__proto__', 'prototype', 'constructor'].includes(key), 'HIGGSFIELD_MARKETING_DATA_INVALID');
      visit(entry[key], depth + 1);
    }
  };
  visit(value, 0);
  need(new TextEncoder().encode(JSON.stringify(value)).length <= 2 * 1024 * 1024, 'HIGGSFIELD_MARKETING_DATA_LIMIT');
}

function url(value) {
  need(string(value, 16384, true) && !/[\u0000-\u0020\u007f]/.test(value), 'HIGGSFIELD_MARKETING_URL_INVALID');
  let parsed;
  try { parsed = new URL(value); } catch { need(false, 'HIGGSFIELD_MARKETING_URL_INVALID'); }
  const host = parsed.hostname.toLowerCase();
  need(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash && (!parsed.port || parsed.port === '443') && host.includes('.') && !/\.(?:localhost|local|internal|home|lan|invalid)$/.test(host), 'HIGGSFIELD_MARKETING_URL_INVALID');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    need(a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19].includes(b)), 'HIGGSFIELD_MARKETING_URL_INVALID');
  }
  return parsed;
}

function stableUrl(value) {
  const parsed = url(value), pairs = [...parsed.searchParams].filter(([key]) => !authQuery.has(key.toLowerCase()) && !/^(?:x-amz-|x-goog-)/i.test(key)).sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  parsed.search = ''; for (const [key, value] of pairs) parsed.searchParams.append(key, value);
  return parsed.href;
}

function identity(value, key = '') {
  if (typeof value === 'string') {
    // Prompts, names and descriptions remain verbatim even if they contain URLs.
    return /^https?:\/\//i.test(value) && !['prompt', 'description', 'name', 'title', 'brand_name'].includes(key) ? stableUrl(value) : value;
  }
  if (Array.isArray(value)) return value.map(item => identity(item, key));
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).filter(key => key !== 'is_pinned').sort().map(key => [key, identity(value[key], key)]));
}

function validateCursor(kind, cursor) {
  need(MARKETING_KINDS.includes(kind), 'HIGGSFIELD_MARKETING_KIND_INVALID', 422);
  if (cursor === null) return;
  const valid = kind === 'product' ? exact(cursor, ['offset']) && integer(cursor.offset)
    : kind === 'presenter' ? exact(cursor, ['user_cursor', 'preset_cursor']) && [cursor.user_cursor, cursor.preset_cursor].every(value => value === null || integer(value)) && [cursor.user_cursor, cursor.preset_cursor].some(integer)
      : ['brand', 'hook', 'setting'].includes(kind) && exact(cursor, ['cursor']) && integer(cursor.cursor);
  need(valid, 'HIGGSFIELD_MARKETING_CURSOR_INVALID', 422);
}

export function marketingRequest(kind, cursor = null) {
  validateCursor(kind, cursor);
  const args = kind === 'product' ? { limit: 100, offset: cursor?.offset ?? 0 }
    : kind === 'presenter' ? { size: 100, ...(cursor?.user_cursor === null || cursor?.user_cursor === undefined ? {} : { user_cursor: cursor.user_cursor }), ...(cursor?.preset_cursor === null || cursor?.preset_cursor === undefined ? {} : { preset_cursor: cursor.preset_cursor }) }
      : ['style', 'format'].includes(kind) ? {} : { size: 100, ...(cursor === null ? {} : { cursor: cursor.cursor }) };
  return { action: actions[kind], arguments: args };
}

function nextPage(kind, data, cursor, length) {
  for (const key of ['cursor', 'user_cursor', 'preset_cursor']) if (own(data, key)) need(data[key] === null || integer(data[key]), 'HIGGSFIELD_MARKETING_PAGE_INVALID');
  if (own(data, 'has_more')) need(typeof data.has_more === 'boolean', 'HIGGSFIELD_MARKETING_PAGE_INVALID');
  if (own(data, 'total_count')) need(integer(data.total_count), 'HIGGSFIELD_MARKETING_PAGE_INVALID');
  if (kind === 'format' || kind === 'style') {
    need(data.has_more !== true && (data.cursor === null || data.cursor === undefined) && (!own(data, 'total_count') || data.total_count === length), 'HIGGSFIELD_MARKETING_CURSOR_INCONSISTENT'); return null;
  }
  if (kind === 'product') {
    need(integer(data.total_count), 'HIGGSFIELD_MARKETING_PAGE_INVALID');
    const end = (cursor?.offset ?? 0) + length;
    need(end <= data.total_count && (end >= data.total_count || length > 0) && (!own(data, 'has_more') || data.has_more === (end < data.total_count)), 'HIGGSFIELD_MARKETING_CURSOR_INCONSISTENT');
    return end < data.total_count ? { offset: end } : null;
  }
  if (kind === 'presenter') {
    need(own(data, 'user_cursor') && own(data, 'preset_cursor') && typeof data.has_more === 'boolean', 'HIGGSFIELD_MARKETING_PAGE_INVALID');
    const more = data.user_cursor !== null || data.preset_cursor !== null;
    need(more === data.has_more && (!more || length > 0), 'HIGGSFIELD_MARKETING_CURSOR_INCONSISTENT');
    if (!more) return null;
    const next = { user_cursor: data.user_cursor, preset_cursor: data.preset_cursor };
    need(cursor === null || JSON.stringify(next) !== JSON.stringify(cursor), 'HIGGSFIELD_MARKETING_CURSOR_LOOP');
    for (const key of ['user_cursor', 'preset_cursor']) if (cursor?.[key] !== null && cursor?.[key] !== undefined && next[key] !== null) need(next[key] >= cursor[key], 'HIGGSFIELD_MARKETING_CURSOR_LOOP');
    return next;
  }
  // Brand kits currently report a terminal cursor without has_more. Never infer
  // another page from requested size: some setup catalogs ignore that size.
  need(own(data, 'cursor') || typeof data.has_more === 'boolean', 'HIGGSFIELD_MARKETING_PAGE_INVALID');
  const more = data.cursor !== null && data.cursor !== undefined;
  need(!own(data, 'has_more') || data.has_more === more, 'HIGGSFIELD_MARKETING_CURSOR_INCONSISTENT');
  if (!more) return null;
  need(length > 0 && (cursor === null || data.cursor !== cursor.cursor), 'HIGGSFIELD_MARKETING_CURSOR_LOOP');
  return { cursor: data.cursor };
}

function normalizeItem(kind, row) {
  need(object(row), 'HIGGSFIELD_MARKETING_ITEM_INVALID');
  if (kind === 'format') {
    need(id(row.slug) && string(row.format, 500, true) && string(row.description) && string(row.icon, 16384, true) && Number.isFinite(row.min_duration_seconds) && Number.isFinite(row.max_duration_seconds) && row.min_duration_seconds > 0 && row.max_duration_seconds >= row.min_duration_seconds && row.max_duration_seconds <= 180 && string(row.preset_source, 200, true), 'HIGGSFIELD_MARKETING_FORMAT_INVALID');
    const metadata = { slug: row.slug, format: row.format, description: row.description, icon: row.icon, min_duration_seconds: row.min_duration_seconds, max_duration_seconds: row.max_duration_seconds, preset_source: row.preset_source };
    return { id: row.slug, name: row.format, description: row.description, status: 'AVAILABLE', selectable: true, previewUrl: url(row.icon).href, identity: identity(metadata) };
  }
  need(id(row.id), 'HIGGSFIELD_MARKETING_ITEM_INVALID');
  let name, description = '', status = 'AVAILABLE', selectable = true, preview = null;
  if (kind === 'brand') {
    need(string(row.status, 100, true), 'HIGGSFIELD_MARKETING_BRAND_UNQUALIFIED');
    name = [row.name, row.brand_name, row.title].find(value => string(value, 500, true)) ?? row.id;
    if (own(row, 'description')) need(row.description === null || string(row.description), 'HIGGSFIELD_MARKETING_ITEM_INVALID');
    description = row.description ?? ''; status = row.status; selectable = status === 'completed';
    preview = [row.preview_url, row.logo_url, row.thumbnail_url].find(value => typeof value === 'string' && value.length) ?? null;
  } else if (kind === 'product') {
    need(uuid(row.id) && string(row.title, 500, true) && Array.isArray(row.images) && row.images.length <= 100 && row.images.every(value => typeof value === 'string') && string(row.status, 100, true) && (row.description === null || string(row.description)), 'HIGGSFIELD_MARKETING_PRODUCT_UNQUALIFIED');
    row.images.forEach(url); name = row.title; description = row.description ?? ''; status = row.status; selectable = status === 'completed' && row.images.length > 0; preview = row.images[0] ?? null;
  } else if (kind === 'presenter') {
    need(uuid(row.id) && string(row.name, 500, true) && ['preset', 'custom'].includes(row.type) && (row.gender === null || string(row.gender, 100)) && typeof row.is_pinned === 'boolean', 'HIGGSFIELD_MARKETING_PRESENTER_INVALID');
    name = row.name; preview = row.preview_url; url(preview);
    if (own(row, 'status')) { need(string(row.status, 100, true), 'HIGGSFIELD_MARKETING_PRESENTER_INVALID'); status = row.status; selectable = status === 'completed'; }
  } else if (kind === 'hook' || kind === 'setting') {
    need(string(row.name, 500, true) && string(row.type, 200, true) && string(row.prompt, 32000, true) && row.entity_type === kind && string(row.source, 100, true) && typeof row.is_pinned === 'boolean' && (row.job_id === null || id(row.job_id)) && (row.job_status === null || string(row.job_status, 100, true)), 'HIGGSFIELD_MARKETING_SETUP_INVALID');
    name = row.name; description = row.prompt; preview = row.thumbnail_url ?? row.video_url ?? null;
    for (const key of ['thumbnail_url', 'video_url']) if (row[key] !== null && row[key] !== undefined) url(row[key]);
    status = row.job_status ?? (row.source === 'preset' ? 'AVAILABLE' : 'UNKNOWN'); selectable = status === 'completed' || row.source === 'preset' && row.job_id === null && row.job_status === null;
  } else if (kind === 'style') {
    need(string(row.name, 500, true) && string(row.type, 200, true) && Number.isFinite(row.priority) && (row.media === null || object(row.media) && row.media.type === 'static' && Number.isSafeInteger(row.media.width) && row.media.width > 0 && Number.isSafeInteger(row.media.height) && row.media.height > 0), 'HIGGSFIELD_MARKETING_STYLE_INVALID');
    name = row.name; description = row.type; preview = row.media?.url ?? null; if (preview !== null) url(preview);
  }
  return { id: row.id, name, description, status, selectable, previewUrl: preview === null ? null : url(preview).href, identity: identity(row) };
}

export function normalizeMarketingPage(kind, data, cursor = null) {
  validateCursor(kind, cursor); bounded(data);
  need(object(data) && (!own(data, 'error') || data.error === null || data.error === ''), 'HIGGSFIELD_MARKETING_TOOL_FAILED');
  const rows = kind === 'format' ? data.formats : data.items;
  need(Array.isArray(rows) && rows.length <= 1000, 'HIGGSFIELD_MARKETING_PAGE_INVALID');
  const items = rows.map(row => normalizeItem(kind, row)), seen = new Map();
  for (const item of items) {
    need(!seen.has(item.id) || JSON.stringify(seen.get(item.id).identity) === JSON.stringify(item.identity), 'HIGGSFIELD_MARKETING_IDENTITY_CONFLICT');
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return { items: [...seen.values()], nextCursor: nextPage(kind, data, cursor, rows.length) };
}

export function marketingRequirements(params) {
  need(object(params) && string(params.model, 200, true), 'STUDIO_MARKETING_REQUEST_INVALID', 422);
  if (!['ms_image', 'marketing_studio_video'].includes(params.model)) return { selections: [], active: false };
  const selections = [];
  for (const key of ['assets', 'folder_id', 'avatars', 'products', 'product_id', 'ad_reference_id', 'preset_id']) need(!own(params, key), 'HIGGSFIELD_MARKETING_UNQUALIFIED_INPUT', 422);
  const add = (kind, value) => { need(id(value), 'HIGGSFIELD_MARKETING_SELECTION_INVALID', 422); selections.push({ kind, id: value }); };
  if (params.model === 'ms_image') {
    need(id(params.style_id), 'HIGGSFIELD_MARKETING_STYLE_SELECTION_REQUIRED', 422); add('style', params.style_id);
    need(!own(params, 'batch_size') || params.batch_size === 1, 'HIGGSFIELD_MARKETING_SINGLE_IMAGE_REQUIRED', 422);
    for (const key of ['mode', 'avatar_ids', 'hook_id', 'setting_id']) need(!own(params, key), 'HIGGSFIELD_MARKETING_UNQUALIFIED_INPUT', 422);
  } else {
    need(id(params.mode), 'HIGGSFIELD_MARKETING_FORMAT_SELECTION_REQUIRED', 422); add('format', params.mode);
    for (const key of ['style_id', 'brand_kit_id', 'batch_size']) need(!own(params, key), 'HIGGSFIELD_MARKETING_UNQUALIFIED_INPUT', 422);
    if (own(params, 'hook_id') || own(params, 'setting_id')) need(['ugc', 'ugc_how_to', 'ugc_unboxing', 'ugc_virtual_try_on'].includes(params.mode), 'HIGGSFIELD_MARKETING_SETUP_MODE_CONFLICT', 422);
  }
  for (const [key, kind, max] of [['product_ids', 'product', 4], ['avatar_ids', 'presenter', 1]]) if (own(params, key)) {
    need(Array.isArray(params[key]) && params[key].length <= max && params[key].every(uuid) && new Set(params[key].map(value => value.toLowerCase())).size === params[key].length, 'HIGGSFIELD_MARKETING_SELECTION_INVALID', 422);
    params[key].forEach(value => add(kind, value));
  }
  if (params.model === 'marketing_studio_video' && params.product_ids?.length) need(params.avatar_ids?.length === 1, 'HIGGSFIELD_MARKETING_PRESENTER_SELECTION_REQUIRED', 422);
  for (const [key, kind] of [['brand_kit_id', 'brand'], ['hook_id', 'hook'], ['setting_id', 'setting']]) if (own(params, key)) add(kind, params[key]);
  return { selections, active: true };
}
