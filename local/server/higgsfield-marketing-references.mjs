import { marketingRequest, normalizeMarketingPage, marketingRequirements } from '../contracts/provider-marketing.mjs';
import { mcpToolData } from './higgsfield-mcp-media.mjs';

export { marketingRequirements } from '../contracts/provider-marketing.mjs';
const need = (value, code, status = 502) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// The caller fixes the authenticated workspace and checks actual tool schemas.
// Only these explicit catalog/get methods can run; no recipe supplies a tool,
// sample asset, prompt, presenter, product or executable generation argument.
export async function resolveMarketingReferences({ params, callTool, evidence }) {
  const requirements = marketingRequirements(params);
  need(typeof callTool === 'function' && typeof evidence === 'function', 'STUDIO_MARKETING_RESOLVER_INVALID', 422);
  const evidenceHashes = [], found = new Map();
  const read = async (action, args) => {
    const raw = await callTool(action, args), hash = await evidence(raw);
    need(digest(hash), 'STUDIO_MARKETING_EVIDENCE_INVALID');
    if (!evidenceHashes.includes(hash)) evidenceHashes.push(hash);
    return mcpToolData(raw);
  };
  for (const kind of new Set(requirements.selections.map(row => row.kind))) {
    if (kind === 'brand') {
      for (const selected of requirements.selections.filter(row => row.kind === kind)) {
        const data = await read('marketing_get_brand_kit', { brand_kit_id: selected.id });
        need(own(data, 'item') && data.item !== null, 'HIGGSFIELD_MARKETING_BRAND_UNQUALIFIED');
        const normalized = normalizeMarketingPage('brand', { items: [data.item], cursor: null }).items[0];
        need(normalized.id === selected.id, 'HIGGSFIELD_MARKETING_SELECTION_MISMATCH');
        need(normalized.selectable, 'HIGGSFIELD_MARKETING_SELECTION_NOT_READY', 409);
        found.set(`${kind}:${selected.id}`, normalized);
      }
      continue;
    }
    const items = new Map(), cursors = new Set(); let cursor = null;
    for (let index = 0; index < 20; index++) {
      const request = marketingRequest(kind, cursor), raw = await read(request.action, request.arguments), page = normalizeMarketingPage(kind, raw, cursor);
      for (const row of page.items) {
        const previous = items.get(row.id);
        need(!previous || JSON.stringify(previous.identity) === JSON.stringify(row.identity), 'HIGGSFIELD_MARKETING_IDENTITY_CONFLICT');
        items.set(row.id, row);
      }
      if (page.nextCursor === null) break;
      const key = JSON.stringify(page.nextCursor);
      need(!cursors.has(key), 'HIGGSFIELD_MARKETING_CURSOR_LOOP');
      cursors.add(key); cursor = page.nextCursor;
      need(index < 19, 'HIGGSFIELD_MARKETING_PAGE_LIMIT');
    }
    for (const selected of requirements.selections.filter(row => row.kind === kind)) {
      const item = items.get(selected.id);
      need(item, 'HIGGSFIELD_MARKETING_SELECTION_NOT_FOUND', 409);
      need(item.selectable, 'HIGGSFIELD_MARKETING_SELECTION_NOT_READY', 409);
      if (kind === 'format' && own(params, 'duration')) need(Number.isSafeInteger(params.duration) && params.duration >= item.identity.min_duration_seconds && params.duration <= item.identity.max_duration_seconds, 'HIGGSFIELD_MARKETING_FORMAT_DURATION', 409);
      found.set(`${kind}:${selected.id}`, item);
    }
  }
  return { selections: requirements.selections.map(({ kind, id }) => { const row = found.get(`${kind}:${id}`); return { kind, id, name: row.name, identity: row.identity }; }), evidenceHashes };
}
