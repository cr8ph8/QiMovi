import { isCreativeProject, validateCreativeProject, projectOwnedContext } from './creative-project.mjs';
import { validateScreenplayMetadata } from './authoring.mjs';
import { validateWritingSceneMap } from './writing-scene-map.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); };
const wellFormed = value => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

/** Version 2 is a project-owned writing draft, with no attached production source. */
export function validateCreativeScreenplayDraft(value, project) {
  project = projectOwnedContext(project, 'screenplay-draft', value);
  const required = ['schemaVersion', 'projectId', 'sourceHash', 'title', 'format', 'body', 'status'];
  const optional = ['genre', 'projectFormat', 'targetPages', 'sceneMap', 'inputRefs'];
  need(object(value) && required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'CREATIVE_SCREENPLAY_FIELDS_INVALID');
  need(value.schemaVersion === 2 && value.sourceHash === null && value.status === 'DRAFT', 'CREATIVE_SCREENPLAY_AUTHORITY_INVALID');
  need(typeof value.projectId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.projectId), 'CREATIVE_SCREENPLAY_PROJECT_INVALID');
  if (project) {
    need(isCreativeProject(project), 'CREATIVE_SCREENPLAY_PROJECT_INVALID'); validateCreativeProject(project);
    need(value.projectId === project.id, 'CREATIVE_SCREENPLAY_PROJECT_MISMATCH');
  }
  need(typeof value.title === 'string' && value.title.trim().length > 0 && value.title.length <= 200 && wellFormed(value.title) && !/[\r\n\0]/.test(value.title), 'CREATIVE_SCREENPLAY_TITLE_INVALID');
  need(value.format === 'FOUNTAIN' && typeof value.body === 'string' && value.body.length <= 200000 && wellFormed(value.body) && !value.body.includes('\0'), 'CREATIVE_SCREENPLAY_BODY_INVALID');
  validateScreenplayMetadata(value);
  if (Object.hasOwn(value, 'sceneMap')) validateWritingSceneMap(value.sceneMap, value.body);
  return value;
}
