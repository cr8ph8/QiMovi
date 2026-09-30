import { MAX_PRODUCTION_ELEMENTS, type ProductionElement } from '../../local/contracts/script-breakdown.mjs';
import { readCharacterCue, readSceneHeading } from '../../local/contracts/screenplay-elements.mjs';
import type { Scene } from './types';

export interface ProductionRequirementSuggestion {
  id: string;
  sceneId: string;
  paragraphId: string;
  /** Exact retained passage, including whitespace; a review view, not rewritten source. */
  sourceText: string;
  basis: 'CHARACTER_CUE' | 'SCENE_HEADING';
  element: ProductionElement;
}

export type ProductionElementsByParagraph = Readonly<Record<string, readonly ProductionElement[]>>;

const normalizedName = (value: string) => value.trim().replace(/\s+/gu, ' ').toLocaleUpperCase('en-US');
const keyFor = (element: Pick<ProductionElement, 'category' | 'name'>) => `${element.category}:${normalizedName(element.name)}`;
const hasInvalidText = (value: string) => /[\uD800-\uDFFF]/u.test(value)
  || Array.from(value).some(character => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);

function explicitElement(paragraph: Scene['paragraphs'][number]): Pick<ProductionRequirementSuggestion, 'basis' | 'element'> | null {
  const type = paragraph.type.trim().toLowerCase().replace(/[ _-]+/g, '_');
  const text = paragraph.text.trim();
  // An imported paragraph classification is the only extraction signal here.
  // Action prose, all-caps words and untyped Fountain lines are not asset evidence.
  if (!text || hasInvalidText(text)) return null;
  if (type === 'character') {
    const cue = readCharacterCue(text, { forced: true });
    if (!cue) return null;
    const extensionText = cue.extensions.join('; ');
    const extensions = extensionText ? extensionText.length <= 600 ? ` (${extensionText})` : ' (see source for delivery extensions)' : '';
    return {
      basis: 'CHARACTER_CUE',
      element: {
        id: 'source-character-cue', category: 'CAST', name: cue.characterName, quantity: null,
        notes: `Suggested from an explicit character cue${extensions}. Confirm performance needs and quantity. This scene requirement is not a separate booking or charge.`,
      },
    };
  }
  if (type === 'scene_heading') {
    const heading = readSceneHeading(text)?.heading ?? text;
    if (/^(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|INT|EXT|EST|I\s*\/\s*E)\.?$/iu.test(heading)) return null;
    // Strip only standard syntax and known time qualifiers. An unfamiliar suffix
    // stays visible so a place name is never shortened by a guess.
    const name = heading.replace(/^(?:(?:INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|INT|EXT|EST|I\s*\/\s*E)\.?)\s+/iu, '')
      .replace(/(?:^|\s+)[-–—]\s+(?:DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|SUNRISE|SUNSET|CONTINUOUS|LATER|SAME(?: TIME)?|MOMENTS LATER)\s*$/iu, '').trim();
    if (!name || name.length > 240) return null;
    return {
      basis: 'SCENE_HEADING',
      element: {
        id: 'source-scene-location', category: 'LOCATIONS', name, quantity: null,
        notes: 'Suggested from the explicit scene heading. Confirm the practical, set or virtual location and required quantity. No location booking or charge is established.',
      },
    };
  }
  return null;
}

/**
 * Review candidates from declared character cues and scene headings only.
 * Pass current draft elements in place of saved elements for edited passages.
 * Matching is scene-local: an appearance in another scene is still a requirement,
 * while a repeated cue here is not another performer or another cost line.
 * This function neither mutates the screenplay nor saves/adopts its proposals.
 */
export function suggestProductionRequirements(
  scene: Pick<Scene, 'id' | 'paragraphs'>,
  existingByParagraph: ProductionElementsByParagraph = {},
): ProductionRequirementSuggestion[] {
  const seen = new Set(scene.paragraphs.flatMap(paragraph => (existingByParagraph[paragraph.id] ?? []).map(keyFor)));
  const suggestions: ProductionRequirementSuggestion[] = [];
  for (const paragraph of scene.paragraphs) {
    const candidate = explicitElement(paragraph);
    if (!candidate) continue;
    const existing = existingByParagraph[paragraph.id] ?? [];
    const key = keyFor(candidate.element);
    if (seen.has(key)) continue;
    seen.add(key);
    // IDs are stable within the passage. An existing row always wins, even when
    // its name has been edited; a full passage is never overfilled by inference.
    if (existing.length >= MAX_PRODUCTION_ELEMENTS || existing.some(element => element.id === candidate.element.id)) continue;
    suggestions.push({
      id: `${scene.id}:${paragraph.id}:${candidate.element.id}`,
      sceneId: scene.id, paragraphId: paragraph.id, sourceText: paragraph.text,
      ...candidate,
    });
  }
  return suggestions;
}
