/** Exact authoring ranges use UTF-16 [start, end), matching JavaScript strings.
 * Scene IDs are revision-local navigation labels, never frozen film scene IDs.
 * Recognition is bounded Fountain syntax; no source text is cleaned or rewritten.
 */
export interface ScreenplaySpan {
    start: number;
    end: number;
    text: string;
    startLine: number;
    endLine: number;
}
export interface CharacterCueObservation {
    name: string;
    raw: string;
    start: number;
    end: number;
    line: number;
    extensions?: string[];
}
export interface SceneIndexEntry extends ScreenplaySpan {
    id: string;
    index: number;
    heading: string;
    rawHeading: string;
    headingStart: number;
    headingEnd: number;
    headingLine: number;
    forced: boolean;
    sourceSceneNumber?: string;
    characters: string[];
    characterCues: CharacterCueObservation[];
    wordCount: number;
}
export interface ScreenplayIndex {
    schemaVersion: 1;
    textLength: number;
    lineCount: number;
    preamble: ScreenplaySpan;
    scenes: SceneIndexEntry[];
}
export type SceneTextChange = 'NEW' | 'EDITED' | 'UNCHANGED';
export declare function buildScreenplayIndex(text: string): ScreenplayIndex;
/** Validates contiguous ranges while reconstructing the exact supplied string. */
export declare function reconstructScreenplay(index: ScreenplayIndex): string;
/** Raw UTF-8 SHA-256, without JSON wrapping or Unicode/newline normalization.
 * Equal duplicate spans share a content hash; bind draft revision + range for identity.
 */
export declare function hashScreenplaySpan(span: Pick<ScreenplaySpan, 'text'>): Promise<string>;
/** Positional comparison is deliberately conservative after insertion or reordering.
 * Never collapse equal headings or infer persistent scene identity from their names.
 */
export declare function classifySceneChanges(current: ScreenplayIndex, baseline?: ScreenplayIndex | null): SceneTextChange[];
/** HTML textareas normalize CRLF/CR; convert a raw UTF-16 offset without changing text. */
export declare function screenplayOffsetToTextarea(text: string, offset: number): number;
/** The editor works against this view so its native caret offsets remain valid. */
export declare function screenplayTextareaValue(text: string): string;
export declare function textareaOffsetToScreenplay(text: string, offset: number): number;
/** Apply one editor change to raw authoring text. Unchanged prefix/suffix ranges
 * retain exact bytes. Line breaks within the changed range use the nearest prior
 * line ending (or next one at the beginning of the document; LF for new drafts).
 * This also keeps upstream smart formatting's normalized caret offsets correct.
 */
export declare function applyScreenplayEditorChange(raw: string, edited: string): string;
