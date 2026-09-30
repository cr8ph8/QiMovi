import { validateCreativeProject } from './creative-project.mjs';
import { validateWritingProductionRecord, validateWritingProductionDraftRef } from './writing-production.mjs';
import { buildScreenplayIndex } from './screenplay-index.mjs';
import { readDirectionKind } from './screenplay-elements.mjs';
import { canonicalJson } from '../kernel/src/canonical-json-core.mjs';

export const PRODUCTION_ATTACHMENT_KIND = 'production-attachment';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value, code, status = 422) => { if (!value) throw Object.assign(new Error(code), { code, status }); };
const exact = (value, fields) => object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const productionAttachmentId = projectId => `${PRODUCTION_ATTACHMENT_KIND}:${projectId}`;
export function validateProductionPlanRef(ref) {
  need(exact(ref, ['id', 'version', 'sha256']) && /^writing-production-plan:[a-f0-9]{64}$/.test(ref.id) && Number.isSafeInteger(ref.version) && ref.version > 0 && ref.version < 2147483647 && digest(ref.sha256), 'PRODUCTION_ATTACHMENT_PLAN_REF_INVALID');
  return ref;
}
export function validateProductionAttachmentRequest(operation, input) {
  need(['prepare', 'attach'].includes(operation) && exact(input, operation === 'prepare' ? ['projectId', 'planRef'] : ['projectId', 'planRef', 'previewSha256', 'requestId']) && identity(input.projectId), 'PRODUCTION_ATTACHMENT_INPUT_INVALID');
  validateProductionPlanRef(input.planRef);
  if (operation === 'attach') need(digest(input.previewSha256) && identity(input.requestId), 'PRODUCTION_ATTACHMENT_REQUEST_INVALID');
  return input;
}
export function validateProductionAttachment(data, project) {
  need(exact(data, ['schemaVersion', 'projectId', 'sourceHash', 'status', 'draftRef', 'planRef', 'projection']) && data.schemaVersion === 1 && identity(data.projectId) && digest(data.sourceHash) && data.status === 'ATTACHED_FOR_PLANNING', 'PRODUCTION_ATTACHMENT_FIELDS_INVALID');
  if (project) need(data.projectId === project.id && (project.sourceHash === null || project.sourceHash === data.sourceHash), 'PRODUCTION_ATTACHMENT_PROJECT_MISMATCH');
  validateProductionPlanRef(data.planRef); validateWritingProductionDraftRef(data.draftRef);
  const p = data.projection;
  need(exact(p, ['scenes', 'characters', 'cells', 'continuityQuestions', 'prologue']) && Array.isArray(p.scenes) && p.scenes.length > 0 && p.scenes.length <= 500 && Array.isArray(p.cells) && !p.cells.length && Array.isArray(p.continuityQuestions) && !p.continuityQuestions.length && Array.isArray(p.characters) && p.characters.length <= 500 && Array.isArray(p.prologue) && p.prologue.length <= 1, 'PRODUCTION_ATTACHMENT_PROJECTION_INVALID');
  const ids = new Set(), shotIds = new Set(), paragraphIds = new Set();
  const paragraph = value => {
    need(exact(value, ['id', 'type', 'text']) && identity(value.id) && !paragraphIds.has(value.id) && ['General', 'Scene Heading', 'Action', 'Character', 'Dialogue', 'Parenthetical', 'Transition', 'Intercut', 'Shot', 'Subheader', 'Lyrics'].includes(value.type) && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= 200000, 'PRODUCTION_ATTACHMENT_PARAGRAPH_INVALID'); paragraphIds.add(value.id);
  };
  p.prologue.forEach(paragraph);
  for (const [index, scene] of p.scenes.entries()) {
    need(exact(scene, ['id', 'index', 'heading', 'shots', 'paragraphs']) && identity(scene.id) && !ids.has(scene.id) && scene.index === index + 1 && typeof scene.heading === 'string' && scene.heading.trim().length > 0 && scene.heading.length <= 1000 && Array.isArray(scene.shots) && scene.shots.length <= 100 && Array.isArray(scene.paragraphs) && scene.paragraphs.length >= 1 && scene.paragraphs.length <= 1000, 'PRODUCTION_ATTACHMENT_SCENE_INVALID'); ids.add(scene.id);
    scene.paragraphs.forEach(paragraph);
    for (const shot of scene.shots) {
      need(exact(shot, ['id', 'label', 'description', 'plannedDurationMs']) && identity(shot.id) && !shotIds.has(shot.id) && typeof shot.label === 'string' && shot.label.trim().length > 0 && shot.label.length <= 160 && typeof shot.description === 'string' && shot.description.length <= 12000 && (shot.plannedDurationMs === null || Number.isSafeInteger(shot.plannedDurationMs) && shot.plannedDurationMs > 0 && shot.plannedDurationMs <= 3600000), 'PRODUCTION_ATTACHMENT_SHOT_INVALID'); shotIds.add(shot.id);
    }
  }
  need(shotIds.size > 0 && shotIds.size <= 1000, 'PRODUCTION_ATTACHMENT_SHOTS_REQUIRED');
  const names = new Set();
  for (const character of p.characters) {
    need(exact(character, ['id', 'name', 'description']) && identity(character.id) && typeof character.name === 'string' && character.name.length > 0 && character.name.length <= 200 && !names.has(character.name) && character.description === '', 'PRODUCTION_ATTACHMENT_CHARACTER_INVALID'); names.add(character.name);
  }
  return data;
}
/** Retain every raw character while classifying only recognized screenplay cues.
 * Blank lines and comments stay General; cue observations use the shared parser.
 */
function sourceParagraphs(body, parsed, span) {
  const paragraphs = [], cues = new Set(parsed.characterCues.map(cue => cue.start));
  let offset = parsed.start, dialogue = false, commentEnd = null;
  while (offset < parsed.end) {
    const newline = body.slice(offset, parsed.end).match(/\r\n|\r|\n/), end = newline ? offset + newline.index + newline[0].length : parsed.end;
    const raw = body.slice(offset, end), value = raw.trim();
    let type = 'General';
    if (commentEnd) { if (value.includes(commentEnd)) commentEnd = null; dialogue = false; }
    else if (/^(?:\/\*|\[\[)/.test(value)) { const close = value.startsWith('/*') ? '*/' : ']]'; if (!value.includes(close)) commentEnd = close; dialogue = false; }
    else if (!value || /^[#=]/.test(value)) dialogue = false;
    else if (offset === parsed.start) { type = 'Scene Heading'; dialogue = false; }
    else if (cues.has(offset)) { type = 'Character'; dialogue = true; }
    else if (dialogue) type = /^\([^\n]*\)$/.test(value) ? 'Parenthetical' : 'Dialogue';
    else if (value.startsWith('~')) type = 'Lyrics';
    else { const direction = readDirectionKind(value); type = direction ? direction.charAt(0).toUpperCase() + direction.slice(1) : 'Action'; }
    const previous = paragraphs.at(-1);
    if (previous?.type === type) { previous.end = end; }
    else paragraphs.push({ start: offset, end, type });
    offset = end;
  }
  need(paragraphs.length <= 1000, 'PRODUCTION_ATTACHMENT_PARAGRAPH_LIMIT');
  return paragraphs.map(item => span(item.start, item.end, item.type));
}
/** The production snapshot retains exact source bytes and explicit planned coverage. */
export function buildProductionAttachment(base, draft, plan, hash) {
  validateCreativeProject(base);
  need(plan?.kind === 'writing-production-plan' && plan.data.projectId === base.id && hash(canonicalJson(plan.data)) === plan.sha256, 'PRODUCTION_ATTACHMENT_PLAN_INVALID', 409);
  validateWritingProductionRecord(plan, base, ref => draft?.id === ref.id && draft?.version === ref.version && draft?.sha256 === ref.sha256 ? draft : null, hash);
  const body = draft.data.body, parsed = buildScreenplayIndex(body);
  const span = (start, end, type) => ({ id: `source-paragraph:${hash(canonicalJson({ draftRef: plan.data.source.draftRef, start, end }))}`, type, text: body.slice(start, end) });
  const projection = {
    scenes: plan.data.scenes.map((scene, index) => {
      need(scene.shots.length <= 100, 'PRODUCTION_ATTACHMENT_SCENE_SHOT_LIMIT');
      const parsedScene = parsed.scenes[index];
      return { id: scene.sceneId, index: scene.ordinal, heading: scene.heading,
        shots: scene.shots.map(shot => {
          need(shot.title.length <= 160, 'PRODUCTION_ATTACHMENT_SHOT_TITLE_LIMIT');
          const ms = shot.durationSeconds === null ? null : shot.durationSeconds * 1000;
          need(ms === null || Number.isSafeInteger(ms) && ms > 0, 'PRODUCTION_ATTACHMENT_DURATION_PRECISION');
          return { id: shot.id, label: shot.title, description: [shot.description, shot.shotType && `Planned shot size: ${shot.shotType}`, shot.cameraMovement && `Planned camera movement: ${shot.cameraMovement}`].filter(Boolean).join('\n\n'), plannedDurationMs: ms };
        }),
        paragraphs: sourceParagraphs(body, parsedScene, span) };
    }),
    characters: plan.data.source.characters.map(name => ({ id: `source-character:${hash(canonicalJson({ projectId: base.id, name }))}`, name, description: '' })),
    cells: [], continuityQuestions: [], prologue: parsed.preamble.text ? [span(0, parsed.preamble.end, 'General')] : [],
  };
  need([...projection.prologue, ...projection.scenes.flatMap(scene => scene.paragraphs)].map(p => p.text).join('') === body, 'PRODUCTION_ATTACHMENT_TEXT_RECONSTRUCTION_FAILED', 409);
  return validateProductionAttachment({ schemaVersion: 1, projectId: base.id, sourceHash: hash(body), status: 'ATTACHED_FOR_PLANNING', draftRef: plan.data.source.draftRef, planRef: { id: plan.id, version: plan.version, sha256: plan.sha256 }, projection }, base);
}
export function attachedProductionProject(base, attachment) {
  validateCreativeProject(base); validateProductionAttachment(attachment.data, base);
  need(attachment.kind === PRODUCTION_ATTACHMENT_KIND && attachment.id === productionAttachmentId(base.id) && attachment.version === 1 && digest(attachment.sha256), 'PRODUCTION_ATTACHMENT_IDENTITY_INVALID', 409);
  return { id: base.id, title: base.title, sourceHash: attachment.data.sourceHash, sourceStatus: 'PENDING_OWNER_ADMISSION', ...attachment.data.projection,
    creativeOrigin: base, productionAttachmentRef: { id: attachment.id, version: 1, sha256: attachment.sha256 }, productionDraftRef: attachment.data.draftRef, productionPlanRef: attachment.data.planRef };
}
