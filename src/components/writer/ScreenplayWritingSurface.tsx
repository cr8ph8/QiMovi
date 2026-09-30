import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FountainEditor, type FountainEditorHandle } from './FountainEditor';
import { ScreenplayPageEditor, type ScreenplayPageEditorHandle, type ScreenplayWritingSelection } from './ScreenplayPageEditor';
import { cycleWritingElement, enterWritingElement, setWritingElement, writingLineAt, writingVisibleText, type WritingEdit, type WritingElement } from './screenplayWritingModel';
import { ScreenplayFindReplace } from './ScreenplayFindReplace';
import { ScreenplayTitlePageDialog } from './ScreenplayTitlePageDialog';
import { replaceScreenplayMatches, type SearchMatch } from './screenplaySearch';
import { ScreenplaySceneCards } from './ScreenplaySceneCards';
import { screenplayOffsetToTextarea } from '@/drifter/screenplayIndex';
import './screenplay-writing-surface.css';

export interface ScreenplayWritingSurfaceHandle { focusOffset(offset: number): void; insertAtCursor(text: string): void }
type Props = { value: string; onChange(value: string): void; disabled?: boolean; onSave?(): void; ariaLabel?: string; onSelectionChange?(selection: ScreenplayWritingSelection): void; historyValue?: string; onRestoreValue?(value: string): void };
const ELEMENTS: [WritingElement, string][] = [['scene_heading', 'Scene heading'], ['action', 'Action'], ['character', 'Character'], ['dialogue', 'Dialogue'], ['parenthetical', 'Parenthetical'], ['transition', 'Transition']];
// Donor WriterDesk insertions supported by the existing local export path.
const INSERTS = [['Scene', 'INT. LOCATION - DAY'], ['Dialogue', 'CHARACTER\nDialogue here.'], ['Action', 'Action description.'], ['Transition', 'CUT TO:'], ['Centered text', '> CENTERED <'], ['Private note', '[[Note to self.]]'], ['Section', '# Sequence'], ['Synopsis', '= What this scene must do.'], ['Page break', '==='], ['Shot direction', '!CLOSE ON the detail.'], ['Montage', '!MONTAGE - THE LONG NIGHT']];
interface Snapshot { value: string; historyValue?: string; selection: ScreenplayWritingSelection }
const selectionFor = (value: string, start: number, end = start): ScreenplayWritingSelection => {
  const kind = writingLineAt(value, start).kind;
  return { start, end, kind: kind === 'empty' || kind === 'other' ? 'action' : kind };
};
function retain(stack: Snapshot[], snapshot: Snapshot) {
  stack.push(snapshot);
  let size = stack.reduce((sum, item) => sum + item.value.length + (item.historyValue?.length ?? 0), 0);
  while (stack.length > 1 && (stack.length > 100 || size > 4_000_000)) { const first = stack.shift()!; size -= first.value.length + (first.historyValue?.length ?? 0); }
}

/** A single local draft and undo history shared by page, source and cards. Key by draft identity. */
export const ScreenplayWritingSurface = forwardRef<ScreenplayWritingSurfaceHandle, Props>(function ScreenplayWritingSurface({ value, onChange, disabled = false, onSave, ariaLabel = 'Fountain screenplay', onSelectionChange, historyValue, onRestoreValue }, ref) {
  const [mode, setMode] = useState<'page' | 'source' | 'cards'>('page');
  const [zoom, setZoom] = useState(100);
  const [selection, setSelection] = useState(() => selectionFor(value, 0));
  const selectionRef = useRef(selection), current = useRef(value);
  const rawValue = useRef(historyValue), localUpdate = useRef(false);
  const back = useRef<Snapshot[]>([]), ahead = useRef<Snapshot[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [findOpen, setFindOpen] = useState(false), [titleOpen, setTitleOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const source = useRef<FountainEditorHandle>(null), page = useRef<ScreenplayPageEditorHandle>(null);
  const pendingFocus = useRef<ScreenplayWritingSelection | null>(null);
  const pendingSourceKind = useRef<{ start: number; kind: WritingElement } | null>(null);
  const report = useCallback((next: ScreenplayWritingSelection) => {
    selectionRef.current = next;
    setSelection(previous => previous.start === next.start && previous.end === next.end && previous.kind === next.kind ? previous : next);
    onSelectionChange?.(next);
  }, [onSelectionChange]);
  useLayoutEffect(() => {
    // Loading/recovering a different body outside the editor starts a fresh undo branch.
    const external = !localUpdate.current && (current.current !== value || rawValue.current !== historyValue);
    current.current = value; rawValue.current = historyValue; localUpdate.current = false;
    if (external) {
      current.current = value; back.current = []; ahead.current = [];
      setHistoryRevision(revision => revision + 1);
      report(selectionFor(value, Math.min(selectionRef.current.start, value.length)));
    }
  }, [value, historyValue, report]);
  const focus = useCallback((next: ScreenplayWritingSelection) => {
    report(next);
    const line = writingLineAt(value, next.start);
    pendingSourceKind.current = !line.text.trim() && next.kind !== 'action' ? { start: line.start, kind: next.kind } : null;
    if (mode === 'page') page.current?.focusSelection(next);
    else if (mode === 'source') {
      const textarea = source.current?.getTextarea();
      if (textarea) { textarea.focus(); textarea.setSelectionRange(next.start, next.end); textarea.scrollTop = Math.max(0, value.slice(0, next.start).split('\n').length * 24 - textarea.clientHeight / 3); }
    }
  }, [mode, report, value]);
  useLayoutEffect(() => { if (pendingFocus.current) { const next = pendingFocus.current; pendingFocus.current = null; focus(next); } }, [value, mode, historyRevision, focus]);
  const change = useCallback((next: string, exactRaw?: string) => {
    if (disabled || (next === current.current && (exactRaw === undefined || exactRaw === rawValue.current))) return;
    retain(back.current, { value: current.current, historyValue, selection: selectionRef.current });
    ahead.current = []; current.current = next; localUpdate.current = true;
    if (exactRaw !== undefined && onRestoreValue) onRestoreValue(exactRaw); else onChange(next);
    setFeedback('');
    setHistoryRevision(revision => revision + 1);
  }, [disabled, onChange, historyValue, onRestoreValue]);
  function changeRaw(next: string) { change(next.replace(/\r\n|\r/g, '\n'), next); }
  function replaceMatches(matches: SearchMatch[], replacement: string) {
    if (disabled) return;
    changeRaw(replaceScreenplayMatches(historyValue ?? value, matches, replacement));
  }
  function revealMatch(match: SearchMatch) {
    const next = selectionFor(value, match.start, match.end);
    // Fountain can expose every literal character, including hidden markers and
    // multi-line selections. Page's paragraph editor cannot select both lines.
    pendingFocus.current = next;
    setMode('source'); setHistoryRevision(revision => revision + 1);
  }
  function apply(edit: WritingEdit | null) {
    if (!edit) { setFeedback('Choose one paragraph. Dialogue and parentheticals need a preceding character cue.'); return; }
    pendingFocus.current = { start: edit.selectionStart, end: edit.selectionEnd, kind: edit.nextKind ?? selection.kind };
    change(edit.value); setHistoryRevision(revision => revision + 1);
  }
  const restore = useCallback((direction: 'undo' | 'redo') => {
    if (disabled) return;
    const from = direction === 'undo' ? back.current : ahead.current;
    const to = direction === 'undo' ? ahead.current : back.current;
    const snapshot = from.pop(); if (!snapshot) return;
    retain(to, { value: current.current, historyValue, selection: selectionRef.current });
    current.current = snapshot.value; localUpdate.current = true; pendingFocus.current = snapshot.selection;
    if (snapshot.historyValue !== undefined && onRestoreValue) onRestoreValue(snapshot.historyValue); else onChange(snapshot.value); setHistoryRevision(revision => revision + 1); setFeedback('');
  }, [disabled, onChange, historyValue, onRestoreValue]);
  function insertAtCursor(text: string) {
    if (disabled) return;
    let { start, end } = selectionRef.current;
    const line = writingLineAt(value, start);
    const marker = line.text.length - writingVisibleText(line).length;
    const leading = line.text.length - line.text.trimStart().length;
    if (mode === 'page' && marker && start === end && start === line.start + leading + marker) start = end = line.start;
    const before = value.slice(0, start), after = value.slice(end);
    const pad = before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : '';
    const next = before + pad + text + '\n' + after;
    const at = before.length + pad.length + text.length + 1;
    apply({ value: next, selectionStart: at, selectionEnd: at });
  }
  function openPageAt(offset: number) {
    pendingFocus.current = selectionFor(value, Math.max(0, Math.min(value.length, offset)));
    setMode('page'); setHistoryRevision(revision => revision + 1);
  }
  useImperativeHandle(ref, () => ({ focusOffset(offset) { if (mode === 'cards') openPageAt(offset); else focus(selectionFor(value, Math.max(0, Math.min(value.length, offset)))); }, insertAtCursor }));
  function sourceKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled || event.nativeEvent.isComposing) return;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 's') { event.preventDefault(); onSave?.(); }
      else if (key === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo'); }
      else if (/^[1-6]$/.test(key)) { event.preventDefault(); apply(setWritingElement(value, start, end, ELEMENTS[Number(key) - 1][0])); }
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const line = writingLineAt(value, start);
    const kind = pendingSourceKind.current?.start === line.start ? pendingSourceKind.current.kind : selectionFor(value, start).kind;
    if (event.key === 'Tab') { event.preventDefault(); apply(cycleWritingElement(value, start, end, event.shiftKey ? -1 : 1, kind)); }
    else if (event.key === 'Enter') { event.preventDefault(); apply(enterWritingElement(value, start, end, kind, event.shiftKey)); }
  }
  function sourceChange(next: string, composing = false) {
    if (composing) { pendingSourceKind.current = null; change(next); return; }
    const intent = pendingSourceKind.current;
    const oldLine = writingLineAt(value, selectionRef.current.start);
    if (intent?.start === oldLine.start && !oldLine.text.trim()) {
      const textarea = source.current?.getTextarea();
      const start = textarea?.selectionStart ?? selectionRef.current.start;
      const end = textarea?.selectionEnd ?? start;
      const replacementLength = next.length - value.length + oldLine.text.length;
      const inserted = next.slice(oldLine.start, oldLine.start + replacementLength);
      if (inserted.trim() && !inserted.includes('\n')) {
        const edit = setWritingElement(next, start, end, intent.kind);
        if (edit) { apply(edit); return; }
      }
    }
    pendingSourceKind.current = null;
    change(next);
  }
  function sourceSelection(start: number, end: number) {
    const next = selectionFor(value, start, end);
    const line = writingLineAt(value, start);
    if (pendingSourceKind.current?.start === line.start && !line.text.trim()) next.kind = pendingSourceKind.current.kind;
    else pendingSourceKind.current = null;
    report(next);
  }
  function chooseElement(kind: WritingElement) {
    if (disabled || mode === 'cards') return;
    if (mode === 'page') page.current?.setElement(kind);
    else apply(setWritingElement(value, selectionRef.current.start, selectionRef.current.end, kind));
  }
  return <section className="screenplay-writing-surface" aria-label="Screenplay writing surface" onKeyDownCapture={event => {
    if (mode === 'cards' && (event.target as HTMLElement).closest('.screenplay-scene-cards') && (event.metaKey || event.ctrlKey) && !event.altKey && !event.nativeEvent.isComposing) {
      const key = event.key.toLowerCase();
      if (key === 's' || key === 'z' || key === 'y') {
        event.preventDefault(); event.stopPropagation();
        if (!disabled) { if (key === 's') onSave?.(); else restore(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
        return;
      }
    }
    if (event.currentTarget.contains(event.target as Node) && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); setFindOpen(true); setFindFocus(request => request + 1);
    }
  }}>
    <div className="screenplay-writing-toolbar" aria-label="Screenplay controls">
      <div className="screenplay-writing-modes" aria-label="Writing view">{([['page', 'Page'], ['source', 'Fountain'], ['cards', 'Scene cards']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={mode === key} onClick={() => { if (mode !== key) { pendingFocus.current = selectionRef.current; setMode(key); } }}>{label}</button>)}</div>
      <label className="screenplay-element-control"><span>Element</span><select aria-label="Screenplay element" value={selection.kind} disabled={disabled || mode === 'cards'} onChange={event => chooseElement(event.target.value as WritingElement)}>{ELEMENTS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <div className="screenplay-history-controls"><button type="button" disabled={disabled || !back.current.length} title="Undo · ⌘Z / Ctrl+Z" onClick={() => restore('undo')}>Undo</button><button type="button" disabled={disabled || !ahead.current.length} title="Redo · ⇧⌘Z / Ctrl+Shift+Z" onClick={() => restore('redo')}>Redo</button></div>
      <button type="button" aria-expanded={findOpen} onClick={() => setFindOpen(open => !open)} title="Find and replace · ⌘F / Ctrl+F">Find & replace</button>
      <button type="button" disabled={disabled} onClick={() => setTitleOpen(true)}>Title page</button>
      {mode === 'page' && <label className="screenplay-zoom-control"><span className="screenplay-sr-only">Page zoom</span><select aria-label="Page zoom" value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[85, 100, 115].map(size => <option key={size} value={size}>{size}%</option>)}</select></label>}
      {mode !== 'cards' && <div className="screenplay-insert-tools" role="group" aria-label="Insert screenplay element"><span>Insert</span><div aria-label="Fountain formatting">{INSERTS.map(([label, text]) => <button key={label} type="button" disabled={disabled} onClick={() => insertAtCursor(text)}>{label}</button>)}</div></div>}
    </div>
    {findOpen && <ScreenplayFindReplace text={value} disabled={disabled} focusRequest={findFocus} onReplace={replaceMatches} onReveal={revealMatch} onClose={() => setFindOpen(false)}/>}
    {titleOpen && <ScreenplayTitlePageDialog text={historyValue ?? value} disabled={disabled} onApply={changeRaw} onClose={() => setTitleOpen(false)}/>}
    {feedback && <p className="screenplay-writing-feedback" role="status">{feedback}</p>}
    {mode === 'cards' ? <ScreenplaySceneCards text={historyValue ?? value} disabled={disabled} onChange={changeRaw} onOpenScene={offset => openPageAt(screenplayOffsetToTextarea(historyValue ?? value, offset))}/> : mode === 'page' ? <ScreenplayPageEditor ref={page} value={value} onChange={change} disabled={disabled} onSelectionChange={report} onSave={onSave} onUndo={() => restore('undo')} onRedo={() => restore('redo')} zoom={zoom}/> : <FountainEditor ref={source} value={value} onChange={sourceChange} disabled={disabled} ariaLabel={ariaLabel} smartFormatting={false} onEditorKeyDown={sourceKey} onSelectionChange={sourceSelection} className="screenplay-source-editor" minHeight={440} placeholder="INT. YOUR SCENE - DAY"/>}
    <footer className="screenplay-writing-footer"><span>Enter · next element <b> / </b> Tab · change element <b> / </b> ⌘F · find <b> / </b> ⌘S · save</span><details><summary>Writing help</summary><p>Click any paragraph to write. Character and location suggestions come from this draft. Shift+Enter adds a line within the current element; ⌘1–6 chooses an element. On Windows use Ctrl in place of ⌘. Search covers the whole current draft, including notes and title metadata. Show match opens its literal Fountain text. Page view edits one paragraph at a time. Insert adds editable examples to the draft; private notes and synopses do not print in formatted exports. Screenplay layout is approximate; review export pagination before delivery.</p></details></footer>
  </section>;
});
