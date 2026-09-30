import { validateContextBundle, validateCompiledContext, renderContextBundle } from '../../local/contracts/context-bundle.mjs';
import { WorkspaceError } from './api';
import { canonicalJson, hashCanonical } from './canonical';
import { validateRecord } from './validation';
import type { CastingDraft, ContextBundle, ContextBundleCatalog, ContextBundlePreview, LoreSource, Project, WritingNote } from './types';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function check(value: unknown, message = 'The context response does not match the selected source material. Refresh saved inputs.'): asserts value { if (!value) throw new Error(message); }
function shape(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  check(object(value) && fields.length === Object.keys(value).length && fields.every(key => Object.prototype.hasOwnProperty.call(value, key)));
}
async function request(url: string, data?: ContextBundle, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal,
    ...(data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: canonicalJson({ data }) } : {}) });
  const text = await response.text();
  check(new TextEncoder().encode(text).length <= 8 * 1024 * 1024, 'The context response exceeds the local preview limit.');
  const value: unknown = JSON.parse(text);
  if (!response.ok) throw new WorkspaceError(object(value) && typeof value.error === 'string' ? value.error : 'The local context request was not confirmed.', response.status);
  return value;
}
async function textHash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateContextBundlePreview(raw: unknown, project: Project, data: ContextBundle): Promise<ContextBundlePreview> {
  validateContextBundle(data, project);
  shape(raw, ['schema', 'sourceHash', 'sceneId', 'bundleHash', 'compiled', 'contextText', 'contextHash']);
  check(raw.schema === 'filmstack-context-preview/v1' && raw.sourceHash === project.sourceHash && raw.sceneId === data.sceneId && raw.bundleHash === await hashCanonical(data) && hash(raw.contextHash) && typeof raw.contextText === 'string');
  validateCompiledContext(raw.compiled, data, project);
  const compiled = (raw as unknown as ContextBundlePreview).compiled;
  const scene = project.scenes.find(value => value.id === data.sceneId);
  check(scene && compiled.sceneHash === await hashCanonical(scene));
  const stableRecord = async (value: unknown) => { shape(value, ['id', 'kind', 'version', 'sha256', 'data']); return validateRecord(value, project); };
  for (const selection of compiled.loreSelections) {
    const record = await stableRecord(selection.record), source = record.data as LoreSource;
    check(record.kind === 'lore-source' && record.id === selection.ref.id && record.sha256 === selection.ref.sha256 && source.sourceHash === project.sourceHash);
    check(source.original.sha256 === selection.ref.originalSha256 && (source.extraction?.sha256 ?? null) === selection.ref.extractionSha256);
    if (source.extraction) {
      const page = source.extraction.pages.find(value => value.pageNumber === selection.ref.pageNumber);
      check(page && page.textSha256 === selection.ref.textSha256 && typeof selection.pageText === 'string' && await textHash(selection.pageText) === page.textSha256);
      check(selection.excerpt.length > 0 && selection.pageText.includes(selection.excerpt));
    } else check(selection.pageText === null && selection.ref.pageNumber === 0 && selection.ref.textSha256 === null && selection.excerpt === '');
  }
  for (const selection of compiled.noteSelections) {
    const record = await stableRecord(selection.record), note = record.data as WritingNote;
    check(record.kind === 'writing-note' && record.id === selection.ref.id && record.sha256 === selection.ref.sha256 && note.sourceHash === project.sourceHash && selection.excerpt.length > 0 && note.body.includes(selection.excerpt));
  }
  for (const selection of compiled.characterSelections) {
    const record = await stableRecord(selection.record), casting = record.data as CastingDraft;
    check(record.kind === 'casting-draft' && record.id === selection.ref.id && record.sha256 === selection.ref.sha256 && casting.sourceHash === project.sourceHash);
    check(selection.referenceHashes.every(value => casting.referenceHashes.includes(value)) && project.characters.find(value => value.id === casting.characterId)?.name === selection.characterName);
  }
  check(raw.contextHash === await hashCanonical(compiled) && raw.contextText === renderContextBundle(compiled));
  return raw as unknown as ContextBundlePreview;
}

export async function previewContextBundle(project: Project, data: ContextBundle, signal?: AbortSignal): Promise<ContextBundlePreview> {
  const frozen = structuredClone(data);
  validateContextBundle(frozen, project);
  return validateContextBundlePreview(await request('/api/context-bundles/preview', frozen, signal), project, frozen);
}

export async function getContextBundles(project: Project, sceneId: string, signal?: AbortSignal): Promise<ContextBundleCatalog> {
  check(project.scenes.some(value => value.id === sceneId));
  const raw = await request(`/api/context-bundles?sceneId=${encodeURIComponent(sceneId)}`, undefined, signal);
  shape(raw, ['schema', 'sourceHash', 'sceneId', 'bundles']);
  check(raw.schema === 'filmstack-context-bundles/v1' && raw.sourceHash === project.sourceHash && raw.sceneId === sceneId && Array.isArray(raw.bundles) && raw.bundles.length <= 1000);
  const ids = new Set<string>();
  for (const entry of raw.bundles) {
    shape(entry, ['record', 'currentness', 'reason']);
    const record = await validateRecord(entry.record, project);
    check(record.kind === 'context-bundle' && (record.data as ContextBundle).sceneId === sceneId && !ids.has(record.id) && ['CURRENT', 'STALE', 'ABSENT'].includes(String(entry.currentness)) && typeof entry.reason === 'string');
    check(entry.currentness !== 'CURRENT' || entry.reason === ''); ids.add(record.id);
  }
  return raw as unknown as ContextBundleCatalog;
}
