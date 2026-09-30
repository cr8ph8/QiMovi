import { parseFountainExportLines } from '@/lib/fountainPdfExport';
import { buildScreenplayIndex, type SceneIndexEntry } from '@/drifter/screenplayIndex';

export interface ScreenplaySceneCard {
  scene: SceneIndexEntry;
  synopsis: string;
  synopsisSpan: { start: number; contentStart: number; end: number; fullEnd: number } | null;
  excerpt: string;
}
const lineEndingAt = (text: string, offset: number) => text.slice(offset).match(/^(?:\r\n|\r|\n)/)?.[0] ?? '';

/** Cards share the writer's exact ranges; duplicate headings remain separate scenes. */
export function screenplaySceneCards(text: string): ScreenplaySceneCard[] {
  return buildScreenplayIndex(text).scenes.map(scene => {
    let at = scene.headingEnd + lineEndingAt(text, scene.headingEnd).length;
    let synopsisSpan: ScreenplaySceneCard['synopsisSpan'] = null;
    // A card synopsis is the first nonblank line after its heading. Do not
    // search into dialogue, notes or boneyards for a coincidental '=' line.
    while (at < scene.end) {
      let end = at;
      while (end < scene.end && !/[\r\n]/.test(text[end])) end++;
      const raw = text.slice(at, end), fullEnd = end + lineEndingAt(text, end).length;
      if (raw.trim()) {
        const prefix = raw.match(/^[\t ]*=(?!=)[\t ]*/)?.[0];
        if (prefix) synopsisSpan = { start: at, contentStart: at + prefix.length, end, fullEnd };
        break;
      }
      at = fullEnd;
    }
    const excerptText = synopsisSpan
      ? text.slice(scene.headingEnd, synopsisSpan.start) + text.slice(synopsisSpan.fullEnd, scene.end)
      : text.slice(scene.headingEnd, scene.end);
    const excerpt = parseFountainExportLines(excerptText).filter(line => !['note', 'synopsis', 'section', 'page_break', 'empty'].includes(line.type)).map(line => line.text).join(' ').trim().replace(/\s+/gu, ' ');
    return { scene, synopsis: synopsisSpan ? text.slice(synopsisSpan.contentStart, synopsisSpan.end) : '', synopsisSpan,
      excerpt: excerpt.length > 220 ? excerpt.slice(0, 217) + '…' : excerpt };
  });
}

/** Edit only the chosen raw span. Existing line endings, BOM and other scenes
 * remain byte-for-byte text equivalents; a stale card cannot target a new scene. */
export function setSceneCardSynopsis(text: string, card: ScreenplaySceneCard, input: string): string {
  const current = screenplaySceneCards(text).find(row => row.scene.start === card.scene.start && row.scene.end === card.scene.end && row.scene.text === card.scene.text);
  if (!current) throw new Error('This scene changed. Reopen its card before editing the synopsis.');
  const synopsis = input.replace(/\r\n|\r|\n/g, ' ');
  if (synopsis === current.synopsis) return text;
  const span = current.synopsisSpan;
  if (span) return synopsis
    ? text.slice(0, span.contentStart) + synopsis + text.slice(span.end)
    : text.slice(0, span.start) + text.slice(span.fullEnd);
  if (!synopsis) return text;
  const end = current.scene.headingEnd;
  const ending = lineEndingAt(text, end) || text.slice(0, end).match(/\r\n|\r|\n/g)?.at(-1) || '\n';
  return text.slice(0, end) + ending + '= ' + synopsis + text.slice(end);
}
