import { readSceneHeading } from '@/lib/screenplay-elements';
import type { Project, Scene, ScreenplayDraft } from './types';

type Paragraph = Scene['paragraphs'][number];
type Kind = 'scene heading' | 'character' | 'dialogue' | 'parenthetical' | 'transition' | 'action';
export type RetainedSourceDraft = {
  data: Pick<ScreenplayDraft, 'title' | 'body' | 'sceneId'>;
  warnings: string[];
  sourceHash: string;
  sceneCount: number;
};

const kindOf = (paragraph: Paragraph) => paragraph.type.trim().toLowerCase().replace(/[ _-]+/g, ' ');
const linesOf = (text: string) => text.split(/(\r\n|\r|\n)/);
/** Insert syntax after indentation; never trim, uppercase or normalize source text. */
function markLines(text: string, marker: string) {
  return linesOf(text).map((line, index) => index % 2 || !line.trim() ? line : line.replace(/^([ \t]*)/, `$1${marker}`)).join('');
}
function note(value: unknown) {
  // IDs are data, including possible Fountain delimiters, never note syntax.
  const json = JSON.stringify(value).replace(/"(?:[^"\\]|\\.)*"/g, token => token.replace(/[[\]/*]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`));
  return `[[${json}]]`;
}

/** A new editable conversion of retained typed paragraphs. The caller's existing
 * project envelope supplies sourceHash on save. Film scene IDs remain compact
 * provenance, never fabricated workspace inputRefs or writing-scene identities.
 */
export function retainedSourceDraft(project: Project, sceneId?: string): RetainedSourceDraft {
  const scenes = sceneId === undefined ? project.scenes : project.scenes.filter(scene => scene.id === sceneId);
  if (sceneId !== undefined && scenes.length !== 1) throw new Error('That retained source scene is unavailable. Reopen the source reader and try again.');
  const prologue = sceneId === undefined ? project.prologue ?? [] : [];
  const warnings = new Set<string>();
  const provenance = {
    schema: 'qimovi-retained-source-writing-copy/v1', projectId: project.id, sourceHash: project.sourceHash,
    scope: sceneId === undefined ? 'WHOLE_SCREENPLAY' : 'SOURCE_SCENE',
    includesOpeningText: prologue.length > 0, sourceSceneIds: scenes.map(scene => scene.id),
  };
  const pieces: string[] = [];
  let previous: Kind | null = null;
  function append(paragraph: Paragraph) {
    const declared = kindOf(paragraph), text = paragraph.text;
    let kind: Kind = ['scene heading', 'character', 'dialogue', 'parenthetical', 'transition'].includes(declared) ? declared as Kind : 'action';
    let converted = text;
    if (/\[\[|\]\]|\/\*|\*\/|[*_]/.test(text)) warnings.add('Literal Fountain punctuation is retained in the text; inspect Page view and exports for emphasis or comment interpretation.');
    if (kind === 'dialogue' || kind === 'parenthetical') {
      const dialogueContext = previous === 'character' || previous === 'dialogue' || previous === 'parenthetical';
      const physicalLines = text.split(/\r\n|\r|\n/);
      // Fountain has no dialogue force marker. Preserve unrepresentable text
      // explicitly as action instead of silently creating a new scene or cue.
      const ambiguous = physicalLines.some(line => !line.trim() || readSceneHeading(line) || /^[!>@#=~[*/]/.test(line.trim()) || kind === 'dialogue' && /^\(.*\)$/.test(line.trim()));
      if (!dialogueContext || ambiguous) {
        warnings.add(`Paragraph ${paragraph.id}: ${declared} needs review; its text is kept at the action margin because this Fountain editor cannot express its original type here.`);
        kind = 'action';
      } else if (kind === 'parenthetical') {
        converted = linesOf(text).map((line, index) => index % 2 || /^\(.*\)$/.test(line.trim()) ? line : line.replace(/^([ \t]*)(.*?)([ \t]*)$/, '$1($2)$3')).join('');
      }
    }
    if (kind === 'scene heading') {
      if (/[\r\n]/.test(text) || /^\s*\./.test(text) || !text.trim()) {
        warnings.add(`Paragraph ${paragraph.id}: the scene heading cannot be forced without changing its literal text; review the action copy.`);
        kind = 'action';
      } else converted = readSceneHeading(text) ? text : markLines(text, '.');
    }
    if (kind === 'character') {
      if (/[\r\n]/.test(text)) {
        warnings.add(`Paragraph ${paragraph.id}: the multiline character cue is kept at the action margin for review.`);
        kind = 'action';
      } else converted = markLines(text, '@');
    }
    if (kind === 'transition') {
      if (text.trimEnd().endsWith('<')) {
        warnings.add(`Paragraph ${paragraph.id}: the transition ends with Fountain centering syntax; review the action copy.`);
        kind = 'action';
      } else converted = markLines(text, '>');
    }
    if (kind === 'action') converted = markLines(text, '!');
    if (!['scene heading', 'character', 'dialogue', 'parenthetical', 'transition', 'action', 'general', 'shot', 'lyrics', 'subheader', 'intercut'].includes(declared)) {
      warnings.add(`Paragraph ${paragraph.id}: original type “${paragraph.type}” is represented at the action margin.`);
    }
    const continuesSpeech = (kind === 'dialogue' || kind === 'parenthetical') && (previous === 'character' || previous === 'dialogue' || previous === 'parenthetical');
    pieces.push(pieces.length ? continuesSpeech ? '\n' : '\n\n' : '', converted);
    previous = text.trim() ? kind : null;
  }
  prologue.forEach(append);
  for (const scene of scenes) {
    previous = null;
    if (!scene.paragraphs.some(paragraph => kindOf(paragraph) === 'scene heading')) {
      append({ id: `${scene.id}:heading`, type: 'Scene Heading', text: scene.heading });
    }
    scene.paragraphs.forEach(append);
  }
  const body = pieces.join('') + '\n\n' + note(provenance) + '\n';
  if (body.length > 200000) throw new Error('This retained screenplay exceeds the writing draft limit after conversion. Use a selected source scene to make a smaller draft.');
  return {
    data: { title: `${project.title}${sceneId === undefined ? ' · writing draft' : ` · scene ${scenes[0].index} draft`}`.replace(/[\r\n\0]/g, ' ').slice(0, 200), body, ...(sceneId === undefined ? {} : { sceneId }) },
    warnings: [...warnings], sourceHash: project.sourceHash, sceneCount: scenes.length,
  };
}
