import { useEffect, useMemo, useRef, useState } from 'react';
import { findScreenplayMatches, type SearchMatch } from './screenplaySearch';

interface Props { text: string; disabled: boolean; focusRequest: number; onReplace(matches: SearchMatch[], replacement: string): void; onReveal(match: SearchMatch): void; onClose(): void }

/** One search for Page and Fountain. Replacement joins the shared undo history. */
export function ScreenplayFindReplace({ text, disabled, focusRequest, onReplace, onReveal, onClose }: Props) {
  const [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false), [wholeWord, setWholeWord] = useState(false);
  const [cursor, setCursor] = useState(0), [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusRequest]);
  const hits = useMemo(() => findScreenplayMatches(text, query, { matchCase, wholeWord }), [text, query, matchCase, wholeWord]);
  const active = Math.min(cursor, Math.max(0, hits.length - 1)), current = hits[active];
  const reset = () => { setCursor(0); setMessage(''); };
  const go = (delta: number) => {
    if (!hits.length) return;
    const next = (active + delta + hits.length) % hits.length;
    setCursor(next); onReveal(hits[next]);
  };
  const replace = (all: boolean) => {
    if (disabled || !current) return;
    const chosen = (all ? hits : [current]).filter(hit => text.slice(hit.start, hit.end) !== replacement);
    if (!chosen.length) { setMessage('No text changed; the replacement already matches.'); return; }
    onReplace(chosen, replacement);
    setMessage(`Replaced ${chosen.length} ${chosen.length === 1 ? 'match' : 'matches'} in this draft. Undo restores the previous text.`);
  };
  return <div className="screenplay-find" role="search" aria-label="Find in screenplay" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="screenplay-find-fields">
      <label>Find<input ref={input} aria-label="Find text" autoFocus value={query} onChange={event => { setQuery(event.target.value); reset(); }} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) go(-1); else if (current) onReveal(current); }
      }}/></label>
      <label>Replace with<input aria-label="Replacement text" value={replacement} disabled={disabled} onChange={event => setReplacement(event.target.value)}/></label>
      <label className="screenplay-find-option"><input type="checkbox" checked={matchCase} onChange={event => { setMatchCase(event.target.checked); reset(); }}/>Match case</label>
      <label className="screenplay-find-option"><input type="checkbox" checked={wholeWord} onChange={event => { setWholeWord(event.target.checked); reset(); }}/>Whole word</label>
      <button type="button" aria-label="Close find and replace" onClick={onClose}>Close</button>
    </div>
    <div className="screenplay-find-actions">
      <span aria-live="polite">{hits.length ? `${active + 1} of ${hits.length}` : query ? 'No matches' : 'Search the current draft'}</span>
      <button type="button" disabled={!current} onClick={() => current && onReveal(current)}>Show match</button>
      <button type="button" disabled={!current} onClick={() => go(-1)}>Previous match</button>
      <button type="button" disabled={!current} onClick={() => go(1)}>Next match</button>
      <button type="button" disabled={disabled || !current} onClick={() => replace(false)}>Replace</button>
      <button type="button" disabled={disabled || !current} onClick={() => replace(true)}>Replace all ({hits.length})</button>
    </div>
    {current && <p className="screenplay-find-context">…{text.slice(Math.max(0, current.start - 45), current.start)}<mark>{text.slice(current.start, current.end)}</mark>{text.slice(current.end, current.end + 70)}…</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
