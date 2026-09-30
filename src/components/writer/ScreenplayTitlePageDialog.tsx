import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { applyScreenplayTitlePage, parseScreenplayTitlePage, TITLE_PAGE_FIELDS } from './screenplayTitlePage';
import './screenplay-title-page.css';

type Props = { text: string; disabled?: boolean; onApply(nextRaw: string): void; onClose(): void };

/** Mount only while open. The form edits title metadata inside the Fountain
 * draft; it never changes the workspace name or a retained production source. */
export function ScreenplayTitlePageDialog({ text, disabled = false, onApply, onClose }: Props) {
  const original = useRef(text);
  const [parsed] = useState(() => parseScreenplayTitlePage(text));
  const [values, setValues] = useState(parsed.values);
  const [error, setError] = useState('');
  const stale = text !== original.current;
  const blocked = disabled || Boolean(parsed.error) || stale;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="screenplay-title-page-dialog">
      <DialogHeader><DialogTitle>Screenplay title page</DialogTitle><DialogDescription>Edit metadata inside this Fountain draft. The workspace name stays unchanged.</DialogDescription></DialogHeader>
      <form onSubmit={event => {
        event.preventDefault(); if (blocked) return;
        try { onApply(applyScreenplayTitlePage(original.current, values)); onClose(); }
        catch (caught) { setError(caught instanceof Error ? caught.message : 'The title page could not be applied. Your screenplay is unchanged.'); }
      }}>
        {parsed.error && <p role="alert">{parsed.error}</p>}
        {stale && <p role="alert">The draft changed while this form was open. Close and reopen the title page to use the current text.</p>}
        <fieldset disabled={blocked} className="screenplay-title-fields">
          {TITLE_PAGE_FIELDS.map(field => <label key={field.key}><span>{field.label}</span><textarea rows={['contact', 'notes', 'copyright', 'source'].includes(field.key) || values[field.key].includes('\n') ? 3 : 1} maxLength={10_000} value={values[field.key]} onChange={event => { setValues(current => ({ ...current, [field.key]: event.target.value })); setError(''); }} placeholder={field.key === 'credit' ? 'Written by' : undefined}/></label>)}
        </fieldset>
        <p className="screenplay-title-hint">Blank fields are omitted. Exact Fountain keeps every field. PDF and DOCX print selected title fields; inspect each export before sharing.</p>
        {parsed.unknownKeys.length > 0 && <p className="screenplay-title-hint">Other header fields stay unchanged: {parsed.unknownKeys.join(', ')}.</p>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={blocked}>Apply title page</button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
export default ScreenplayTitlePageDialog;
