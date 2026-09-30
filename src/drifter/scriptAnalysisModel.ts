import { analyzeCharacters } from '@/lib/character';
import type { FountainElement, FountainParseResult } from '@/lib/fountain-parser';
import { buildScreenplayIndex, type SceneIndexEntry } from './screenplayIndex';

export const SCRIPT_ANALYSIS_LIMIT = 200000;
export interface DialogueObservation { character: string; sceneIndex: number; line: number; start: number; end: number; text: string; spokenText: string }
export interface PhraseObservation { phrase: string; count: number; sceneIndices: number[] }
export interface AnalysisCharacter {
  name: string; dialogueLines: number; words: number; dialogueShare: number; averageLineCharacters: number;
  sceneIndices: number[]; repeatedPhrases: PhraseObservation[]; dialogue: DialogueObservation[];
}
export interface AnalysisScene extends SceneIndexEntry { speakingCharacters: string[]; dialogueLines: number; dialogueWords: number; intExt: string; location: string; time: string }
export interface AnalysisLocation { location: string; forced: boolean; intExt: string[]; times: string[]; sceneIndices: number[] }
export interface AnalysisRelationship { characters: [string, string]; sceneIndices: number[] }
export interface LocalScriptAnalysis {
  status: 'READY' | 'EMPTY' | 'TOO_LONG'; characters: AnalysisCharacter[]; scenes: AnalysisScene[]; locations: AnalysisLocation[];
  relationships: AnalysisRelationship[]; relationshipsComplete: boolean; dialogueLines: number; dialogueWords: number;
  preambleCharacters: number; lineCount: number;
}

const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu) ?? [];
/** Adapted from the donor Fountain report model. Recognition still belongs to
 * the shared lossless scene index. A forced heading is kept whole; its dashes
 * do not establish a location or time. These labels never become canon. */
function sceneSetting(scene: SceneIndexEntry): Pick<AnalysisScene, 'intExt' | 'location' | 'time'> {
  const match = !scene.forced && /^(INT\.?\s*\/\s*EXT\.|EXT\.?\s*\/\s*INT\.|I\s*\/\s*E\.|INT\.|EXT\.|EST\.)\s*(.+)$/iu.exec(scene.heading);
  if (!match) return { intExt: '', location: scene.heading, time: '' };
  const intExt = match[1].toUpperCase().replace(/[.\s]/g, ''), rest = match[2], dash = rest.lastIndexOf(' - ');
  return { intExt, location: (dash >= 0 ? rest.slice(0, dash) : rest).trim(), time: dash >= 0 ? rest.slice(dash + 3).trim() : '' };
}
/** Mask Fountain comments for observation only; preserve every UTF-16 offset. */
function visibleText(text: string): string {
  let result = '', end = '', at = 0;
  while (at < text.length) {
    if (end && text.startsWith(end, at)) { result += '  '; at += 2; end = ''; }
    else if (!end && (text.startsWith('/*', at) || text.startsWith('[[', at))) { end = text.startsWith('/*', at) ? '*/' : ']]'; result += '  '; at += 2; }
    else { const value = text[at++]; result += end && value !== '\n' && value !== '\r' ? ' ' : value; }
  }
  return result;
}

function repeatedPhrases(dialogue: DialogueObservation[]): PhraseObservation[] {
  const found = new Map<string, { count: number; scenes: Set<number> }>();
  for (const observation of dialogue) {
    const words = tokens(observation.spokenText);
    for (let length = 3; length <= Math.min(6, words.length); length++) {
      for (let at = 0; at <= words.length - length; at++) {
        const phrase = words.slice(at, at + length).join(' ');
        const item = found.get(phrase) ?? { count: 0, scenes: new Set<number>() };
        item.count++; item.scenes.add(observation.sceneIndex); found.set(phrase, item);
      }
    }
  }
  return [...found.entries()].filter(([, value]) => value.count > 1)
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, 8).map(([phrase, value]) => ({ phrase, count: value.count, sceneIndices: [...value.scenes].sort((a, b) => a - b) }));
}

/** Exact spans and 1-based scene indices belong to this authoring draft only.
 * Character recognition follows the existing lossless Fountain scene index.
 * Only measured fields are taken from upstream character analysis: no sentiment,
 * distinctiveness, probability, grade, random value or model output is exposed.
 */
export function buildScriptAnalysis(body: string): LocalScriptAnalysis {
  const empty: LocalScriptAnalysis = { status: body.trim() ? 'READY' : 'EMPTY', characters: [], scenes: [], locations: [], relationships: [], relationshipsComplete: true, dialogueLines: 0, dialogueWords: 0, preambleCharacters: 0, lineCount: 0 };
  if (body.length > SCRIPT_ANALYSIS_LIMIT) return { ...empty, status: 'TOO_LONG' };
  const index = buildScreenplayIndex(body), masked = visibleText(body);
  const elements: FountainElement[] = [], dialogue: DialogueObservation[] = [], names = new Set<string>();
  const parsedScenes: FountainParseResult['scenes'] = [];
  const scenes = index.scenes.map((scene): AnalysisScene => {
    parsedScenes.push({ heading: scene.heading, index: scene.index, elementIndex: elements.length });
    elements.push({ type: 'scene_heading', text: scene.heading });
    const cues = new Map(scene.characterCues.map(cue => [cue.start, cue]));
    let at = scene.start, line = scene.startLine, character = '';
    const observed: DialogueObservation[] = [];
    while (at < scene.end) {
      let end = at; while (end < scene.end && body[end] !== '\r' && body[end] !== '\n') end++;
      const spokenText = masked.slice(at, end).trim(), cue = cues.get(at);
      if (cue) { character = cue.name; names.add(character); elements.push({ type: 'character', text: character }); }
      else if (!spokenText) { character = ''; elements.push({ type: 'empty', text: '' }); }
      else if (character && /^\(.*\)$/.test(spokenText)) elements.push({ type: 'parenthetical', text: spokenText });
      else if (character && !/^(?:[!>@#=~]|(?:.*TO:|FADE OUT\.?|THE END)$)/i.test(spokenText)) {
        const observation = { character, sceneIndex: scene.index, line, start: at, end, text: body.slice(at, end), spokenText };
        observed.push(observation); dialogue.push(observation); elements.push({ type: 'dialogue', text: spokenText });
      } else { character = ''; elements.push({ type: 'action', text: spokenText }); }
      at = end < scene.end ? end + (body[end] === '\r' && body[end + 1] === '\n' ? 2 : 1) : end;
      line++;
    }
    return { ...scene, ...sceneSetting(scene), speakingCharacters: [...new Set(observed.map(item => item.character))], dialogueLines: observed.length, dialogueWords: observed.reduce((sum, item) => sum + tokens(item.spokenText).length, 0) };
  });
  const parsed: FountainParseResult = { elements, scenes: parsedScenes, stats: { uniqueCharacters: [...names], pageCount: 0, sceneCount: scenes.length, wordCount: 0, dialogueBlockCount: 0, actionLineCount: 0, characterDialogueCounts: {} } };
  const byCharacter = new Map<string, DialogueObservation[]>();
  for (const item of dialogue) { const items = byCharacter.get(item.character) ?? []; items.push(item); byCharacter.set(item.character, items); }
  const characters = analyzeCharacters(parsed).map((profile): AnalysisCharacter => {
    const lines = byCharacter.get(profile.name) ?? [];
    return { name: profile.name, dialogueLines: profile.dialogueLineCount, words: lines.reduce((sum, item) => sum + tokens(item.spokenText).length, 0), dialogueShare: profile.dialogueShareRatio, averageLineCharacters: profile.avgLineLength, sceneIndices: [...new Set(lines.map(item => item.sceneIndex))], repeatedPhrases: repeatedPhrases(lines), dialogue: lines };
  }).filter(character => character.dialogueLines > 0).sort((a, b) => b.dialogueLines - a.dialogueLines || (a.name < b.name ? -1 : 1));
  // Bound the quadratic relationship step, without silently presenting a partial graph.
  const relationshipsComplete = scenes.reduce((sum, scene) => sum + scene.speakingCharacters.length * (scene.speakingCharacters.length - 1) / 2, 0) <= 20000;
  const relationships = new Map<string, AnalysisRelationship>();
  if (relationshipsComplete) for (const scene of scenes) {
    const speakers = [...scene.speakingCharacters].sort();
    for (let i = 0; i < speakers.length; i++) for (let j = i + 1; j < speakers.length; j++) {
      const pair: [string, string] = [speakers[i], speakers[j]], key = JSON.stringify(pair);
      const relationship = relationships.get(key) ?? { characters: pair, sceneIndices: [] };
      relationship.sceneIndices.push(scene.index); relationships.set(key, relationship);
    }
  }
  const locations = new Map<string, AnalysisLocation>();
  for (const scene of scenes) {
    const key = JSON.stringify([scene.forced, scene.location.toUpperCase()]);
    const row = locations.get(key) ?? { location: scene.location, forced: scene.forced, intExt: [], times: [], sceneIndices: [] };
    if (scene.intExt && !row.intExt.includes(scene.intExt)) row.intExt.push(scene.intExt);
    if (scene.time && !row.times.includes(scene.time)) row.times.push(scene.time);
    row.sceneIndices.push(scene.index); locations.set(key, row);
  }
  return { ...empty, characters, scenes, locations: [...locations.values()], relationships: [...relationships.values()].sort((a, b) => b.sceneIndices.length - a.sceneIndices.length || (JSON.stringify(a.characters) < JSON.stringify(b.characters) ? -1 : 1)), relationshipsComplete, dialogueLines: dialogue.length, dialogueWords: scenes.reduce((sum, scene) => sum + scene.dialogueWords, 0), preambleCharacters: index.preamble.text.length, lineCount: index.lineCount };
}

export type ScriptReportKind = 'characters' | 'scenes' | 'locations';
export function scriptAnalysisScope(dirty = false, savedVersion?: number): string {
  return dirty ? `Current writing · includes unsaved edits${savedVersion ? ` (based on version ${savedVersion})` : ''}` : savedVersion ? `Saved writing · version ${savedVersion}` : 'Current writing draft';
}
/** Quoted CSV with CR/LF preserved inside cells. Prefix formula-looking text
 * with an apostrophe for spreadsheet safety; never change the screenplay. */
function csvCell(value: string | number | string[] | number[]): string {
  let text = Array.isArray(value) ? value.join('; ') : String(value);
  if (typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
/** Department-friendly observations of this exact visible draft. No runtime,
 * cast approval, production identity, or canonical world inference is added. */
export function scriptAnalysisCsv(kind: ScriptReportKind, analysis: LocalScriptAnalysis, context: { title: string; dirty?: boolean; savedVersion?: number }): string {
  if (analysis.status !== 'READY') throw new Error('Open a draft within the analysis limit before exporting a report.');
  const scope = scriptAnalysisScope(context.dirty, context.savedVersion);
  const prefix = [context.title || 'Untitled writing draft', scope];
  const definitions: Record<ScriptReportKind, { headers: string[]; rows: (string | number | string[] | number[])[][] }> = {
    characters: { headers: ['Character cue', 'Dialogue lines', 'Dialogue words', 'Share of dialogue lines (%)', 'Scene orders', 'First speaking scene'], rows: analysis.characters.map(row => [row.name, row.dialogueLines, row.words, row.dialogueShare, row.sceneIndices, row.sceneIndices[0] ?? '']) },
    scenes: { headers: ['Scene order', 'Printed scene number', 'Exact heading', 'Heading convention', 'INT/EXT', 'Location or unsplit heading', 'Time label', 'Speaking character cues', 'Dialogue lines', 'Dialogue words', 'Start line', 'End line', 'Start UTF-16 offset', 'End UTF-16 offset (exclusive)'], rows: analysis.scenes.map(row => [row.index, row.sourceSceneNumber ?? '', row.heading, row.forced ? 'Forced heading; unsplit' : 'Standard heading; inferred labels', row.intExt, row.location, row.time, row.speakingCharacters, row.dialogueLines, row.dialogueWords, row.startLine, row.endLine, row.start, row.end]) },
    locations: { headers: ['Location or unsplit heading', 'Heading convention', 'INT/EXT labels', 'Time labels', 'Scene orders', 'Scene count'], rows: analysis.locations.map(row => [row.location, row.forced ? 'Forced heading; unsplit' : 'Standard heading; inferred labels', row.intExt, row.times, row.sceneIndices, row.sceneIndices.length]) },
  };
  const selected = definitions[kind];
  if (!selected) throw new Error('Unknown screenplay report.');
  return [['Draft title', 'Draft scope', ...selected.headers], ...selected.rows.map(row => [...prefix, ...row])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
