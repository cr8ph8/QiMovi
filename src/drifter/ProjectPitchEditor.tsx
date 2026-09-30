import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PitchDraft, ProjectAsset, WorkspaceProject } from './types';
import { blobUrl } from './api';
import { validateAuthoringRecord } from '../../local/contracts/authoring.mjs';
import { PITCH_FIELDS } from './pitchAssemblyModel';
import { buildProjectPitchDeck, createProjectPitchPresentation, PITCH_SLIDE_DEFINITIONS, PROJECT_PITCH_FIELDS } from './projectPitchModel';
import { createProjectPitchDeckPdfWithAssets } from './projectPitchExports';
import { downloadLocalBlob } from './localDownload';
import { writingExportFilename } from './writingExports';
import './project-pitch.css';

const storyPrompts: Record<string, string> = {
  title: 'The project title shown on the cover.',
  logline: 'Who drives the story, what do they want, what stands in the way and what is at stake?',
  synopsis: 'Tell the complete story in a few connected paragraphs, including its central conflict and resolution.',
  characterSummaries: 'Introduce the principal characters, their desires, conflicts and arcs across the project.',
  thematicSummary: 'What does this story explore, and why does it matter now?',
  worldDescription: 'Explain the world, its defining rules and the story’s place within the wider universe.',
  toneDescription: 'Describe the visual language, sound, atmosphere and intended viewing experience.',
  comparableReferences: 'Name relevant titles and explain the creative or audience connection. Include sources for commercial claims.',
};
const MAX_PITCH_FILE_BYTES = 512 * 1024;
interface PitchFilePreview { draft: PitchDraft; filename: string; base: PitchDraft; serial: number }

export function ProjectPitchPreview({ deck, index }: { deck: ReturnType<typeof buildProjectPitchDeck>; index: number }) {
  const slide = deck.slides[index] ?? deck.slides[0];
  if (!slide) return <p className="scope-note">Include a slide to preview the deck.</p>;
  const layout = slide.layout ?? 'text';
  return <article className={`project-pitch-slide project-pitch-theme-${deck.theme ?? 'cinema'} project-pitch-layout-${layout}`} aria-label="Project pitch slide preview" style={{ '--pitch-accent': deck.accentColor ?? '#C38D61' } as CSSProperties}>
    {slide.imageHash && layout !== 'text' && <img className="project-pitch-art" src={blobUrl(slide.imageHash)} alt={slide.imageCaption || 'Selected pitch artwork'}/>}
    <div className="project-pitch-slide-content">
      <div className="project-pitch-slide-top"><span>{deck.title || 'Untitled project'}</span><small>PROJECT PITCH · DRAFT</small></div>
      <h3>{slide.id === 'cover' && !slide.layout ? deck.title || 'Untitled project' : slide.title}</h3>
      <div className="project-pitch-slide-copy">{slide.sections.filter(section => Boolean(slide.layout) || slide.id !== 'cover' || section.label !== 'Project title').map((section, sectionIndex) => <section key={sectionIndex}><h4>{section.label}</h4><p>{section.body}</p></section>)}
        {!slide.sections.length && <p className="project-pitch-placeholder">Add the project details for this slide.</p>}
      </div>
      <footer><span>{slide.missingFields.length ? `${slide.missingFields.length} fields to complete` : 'Private development draft'}</span><span>{String(index + 1).padStart(2, '0')} / {deck.totalSlides}</span></footer>
      {slide.imageHash && slide.imageCaption && layout !== 'text' && <p className="project-pitch-art-caption">{slide.imageCaption}</p>}
    </div>
  </article>;
}

type Presentation = NonNullable<PitchDraft['presentation']>;
type PresentationSlide = Presentation['slides'][number];

/** One editor over the existing saved pitch record. Slide choice is only a view. */
export default function ProjectPitchEditor({ draft, disabled, onChange, scope, imageAssets = [], project }: {
  draft: PitchDraft; disabled: boolean; onChange: (draft: PitchDraft) => void; scope: string; imageAssets?: ProjectAsset[]; project?: WorkspaceProject;
}) {
  const [selected, setSelected] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editingSource, setEditingSource] = useState(false), [exporting, setExporting] = useState(false);
  const exportOperation = useRef(0);
  const [importPreview, setImportPreview] = useState<PitchFilePreview | null>(null), [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), operation = useRef(0), alive = useRef(true);
  const current = useRef({ draft, disabled }); current.current = { draft, disabled };
  useEffect(() => { const sequence = operation; alive.current = true; return () => { alive.current = false; ++sequence.current; }; }, []);
  useEffect(() => {
    const sequence = operation;
    ++sequence.current; ++exportOperation.current; setExporting(false); setImportPreview(null); setReading(false); setError(''); setNotice('');
    return () => { ++sequence.current; };
  }, [draft, disabled]);
  const deck = useMemo(() => buildProjectPitchDeck(draft), [draft]);
  const customized = Boolean(draft.presentation);
  const designMode = customized && !editingSource;
  const editorDeck = useMemo(() => buildProjectPitchDeck(editingSource ? { ...draft, presentation: undefined } : draft, { includeHidden: true }), [draft, editingSource]);
  const activeIndex = Math.min(selected, Math.max(0, editorDeck.slides.length - 1));
  const activeSlide = designMode ? draft.presentation?.slides[activeIndex] : undefined;
  const images = imageAssets.filter((asset, index, all) => asset.family === 'IMAGE' && ['image/png', 'image/jpeg'].includes(asset.asset.mimeType) && all.findIndex(other => other.asset.sha256 === asset.asset.sha256) === index);
  const importedDeck = useMemo(() => importPreview ? buildProjectPitchDeck(importPreview.draft) : null, [importPreview]);
  const importedSourceDeck = useMemo(() => importPreview ? buildProjectPitchDeck({ ...importPreview.draft, presentation: undefined }) : null, [importPreview]);
  const definition = PITCH_SLIDE_DEFINITIONS[activeIndex] ?? PITCH_SLIDE_DEFINITIONS[0];
  function cancelImport() {
    ++operation.current; setImportPreview(null); setReading(false);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function readPitchFile(file: File | undefined) {
    cancelImport(); setError(''); setNotice('');
    if (!file || disabled) return;
    const serial = operation.current, base = draft;
    const stillCurrent = () => alive.current && operation.current === serial && current.current.draft === base && !current.current.disabled;
    setReading(true);
    try {
      if (file.size > MAX_PITCH_FILE_BYTES) throw new Error('Choose a pitch draft JSON file of 512 KiB or less.');
      const text = await file.text();
      if (!stillCurrent()) return;
      const candidate = JSON.parse(text.replace(/^\uFEFF/, ''));
      validateAuthoringRecord('pitch-draft', candidate, project ?? { sourceHash: base.sourceHash });
      setImportPreview({ draft: candidate as PitchDraft, filename: file.name, base, serial });
    } catch (caught) {
      if (stillCurrent()) setError(`Pitch draft could not be opened: ${caught instanceof Error ? caught.message : 'Invalid JSON file.'} Your current draft is unchanged.`);
    } finally { if (stillCurrent()) setReading(false); }
  }
  function useImportedDraft() {
    if (disabled || !importPreview || importPreview.base !== draft || importPreview.serial !== operation.current) return;
    const next = structuredClone(importPreview.draft);
    cancelImport(); setError(''); setSelected(0); setEditingSource(false);
    onChange(next);
  }
  function downloadDraft() {
    if (disabled) return;
    try {
      validateAuthoringRecord('pitch-draft', draft, project ?? { sourceHash: draft.sourceHash });
      downloadLocalBlob(new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' }), writingExportFilename(`${draft.title} - pitch draft`, 'json'));
      setNotice('Pitch draft JSON prepared from the current editor fields. Complete the Save dialog.'); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The pitch draft could not be downloaded.'); }
  }
  function setField(key: string, value: string) {
    if (disabled) return;
    cancelImport();
    setError(''); setNotice('');
    if (PROJECT_PITCH_FIELDS.some(field => field.key === key)) onChange({ ...draft, projectDetails: { ...draft.projectDetails, [key]: value } });
    else onChange({ ...draft, [key]: value });
  }
  function changePresentation(next: Presentation) {
    if (disabled) return;
    cancelImport(); setError(''); setNotice('');
    onChange({ ...draft, presentation: next });
  }
  function customize() {
    if (disabled) return;
    changePresentation(createProjectPitchPresentation(draft));
    setEditingSource(false); setSelected(0);
  }
  function updateSlide(patch: Partial<PresentationSlide>) {
    if (!draft.presentation || !activeSlide) return;
    changePresentation({ ...draft.presentation, slides: draft.presentation.slides.map((slide, index) => index === activeIndex ? { ...slide, ...patch } : slide) });
  }
  function addSlide(duplicate = false) {
    if (!draft.presentation || draft.presentation.slides.length >= 40) return;
    const next: PresentationSlide = duplicate && activeSlide ? { ...structuredClone(activeSlide), id: crypto.randomUUID(), title: `${activeSlide.title.slice(0, 291)} (copy)` } : { id: crypto.randomUUID(), title: 'New slide', sections: [{ label: '', body: '' }], layout: 'text' };
    const slides = [...draft.presentation.slides];
    slides.splice(activeIndex + 1, 0, next);
    changePresentation({ ...draft.presentation, slides }); setSelected(activeIndex + 1);
  }
  function moveSlide(direction: number) {
    if (!draft.presentation) return;
    const target = activeIndex + direction;
    if (target < 0 || target >= draft.presentation.slides.length) return;
    const slides = [...draft.presentation.slides];
    [slides[activeIndex], slides[target]] = [slides[target], slides[activeIndex]];
    changePresentation({ ...draft.presentation, slides }); setSelected(target);
  }
  function removeSlide() {
    if (!draft.presentation || draft.presentation.slides.length <= 1) return;
    changePresentation({ ...draft.presentation, slides: draft.presentation.slides.filter((_, index) => index !== activeIndex) });
    setSelected(Math.max(0, activeIndex - 1));
  }
  function updateSection(index: number, patch: Partial<PresentationSlide['sections'][number]>) {
    if (!activeSlide) return;
    updateSlide({ sections: activeSlide.sections.map((section, position) => position === index ? { ...section, ...patch } : section) });
  }
  async function exportDeck() {
    if (disabled || exporting) return;
    const serial = ++exportOperation.current, base = draft;
    const stillCurrent = () => alive.current && exportOperation.current === serial && current.current.draft === base && !current.current.disabled;
    setExporting(true); setError(''); setNotice('');
    try {
      const result = await createProjectPitchDeckPdfWithAssets(deck);
      if (!stillCurrent()) return;
      downloadLocalBlob(result.blob, result.filename);
      setNotice(`Project deck PDF prepared (${result.pageCount} pages) from ${scope.toLowerCase()}. Complete the Save dialog.${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}`);
    } catch (caught) { if (stillCurrent()) setError(caught instanceof Error ? caught.message : 'The deck could not be exported.'); }
    finally { if (stillCurrent()) setExporting(false); }
  }
  return <section className="project-pitch-editor" aria-label="Whole-project pitch editor">
    <header className="project-pitch-heading"><div><span className="eyebrow">WHOLE PROJECT</span><h2>Pitch deck</h2><p>Story, world, audience, team, production and the ask in one saved pitch.</p></div><div className="project-pitch-file-actions"><button type="button" disabled={disabled} onClick={() => { cancelImport(); setError(''); setNotice(''); fileInput.current?.click(); }}>Open pitch draft</button><input ref={fileInput} hidden type="file" accept=".json,application/json" aria-label="Open pitch draft JSON file" disabled={disabled} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void readPitchFile(file); }}/><button type="button" disabled={disabled || !draft.title.trim()} onClick={downloadDraft}>Download pitch draft</button><button type="button" className="primary" disabled={disabled || exporting || !draft.title.trim() || !deck.totalSlides} onClick={() => void exportDeck()}>{exporting ? 'Preparing PDF…' : 'Export deck PDF'}</button></div></header>
    <div className="project-pitch-progress"><span>{deck.completeSlides} of {deck.totalSlides} {customized ? 'included slides have text' : 'slides have all text fields'}</span><span>{scope}</span></div>
    <p className="scope-note">Field coverage measures writing progress. Budget figures, attachments and rights remain your stated plans until supported and reviewed.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {reading && <div className="project-pitch-import"><p role="status">Reading pitch draft…</p><button type="button" disabled={disabled} onClick={cancelImport}>Cancel import</button></div>}
    {importPreview && importedDeck && <section className="project-pitch-import" aria-label="Pitch draft import preview"><small>{importPreview.filename}</small><h3>{importPreview.draft.title}</h3><p>{1 + PITCH_FIELDS.length + PROJECT_PITCH_FIELDS.length - (importedSourceDeck?.missingFields.length ?? 0)} of {1 + PITCH_FIELDS.length + PROJECT_PITCH_FIELDS.length} text fields supplied · {importedDeck.totalSlides} project slides</p><h4>Story summary</h4><p className="project-pitch-import-summary">{importPreview.draft.synopsis || importPreview.draft.logline || 'No story summary supplied.'}</p><p>Use this draft replaces the current editor fields, including unsaved changes. Nothing is saved automatically. Review the imported text, then use Save pitch to retain it.</p><div className="project-pitch-file-actions"><button type="button" className="primary" disabled={disabled} onClick={useImportedDraft}>Use this draft</button><button type="button" disabled={disabled} onClick={cancelImport}>Cancel import</button></div></section>}
    <div className="project-pitch-mode-controls">
      {customized ? <div className="project-pitch-file-actions" aria-label="Pitch editing view"><button type="button" aria-pressed={!editingSource} onClick={() => { setEditingSource(false); setSelected(0); }}>Design slides</button><button type="button" aria-pressed={editingSource} onClick={() => { setEditingSource(true); setSelected(0); }}>Project text</button></div> : <button type="button" className="primary" disabled={disabled} onClick={customize}>Customize slides</button>}
      <p className="scope-note">{customized ? 'Slide edits are independent of Project text. Use Save pitch to keep your changes.' : 'Customize the layout, images and slide order. Your project text stays available.'}</p>
    </div>
    {designMode && draft.presentation && <fieldset className="project-pitch-design-controls" disabled={disabled}><legend>Deck design</legend><label>Theme<select aria-label="Deck theme" value={draft.presentation.theme} onChange={event => changePresentation({ ...draft.presentation!, theme: event.target.value as Presentation['theme'] })}><option value="cinema">Cinema · warm ink</option><option value="paper">Paper · light</option><option value="midnight">Midnight · dark blue</option></select></label><label>Accent color<input type="color" aria-label="Deck accent color" value={draft.presentation.accentColor} onChange={event => changePresentation({ ...draft.presentation!, accentColor: event.target.value })}/></label><span>{deck.totalSlides} included · {draft.presentation.slides.length - deck.totalSlides} excluded</span><button type="button" disabled={disabled || draft.presentation.slides.length >= 40} onClick={() => addSlide()}>Add slide</button></fieldset>}
    <div className="project-pitch-layout"><nav className="project-pitch-outline" aria-label="Project deck outline">{editorDeck.slides.map((slide, index) => <button type="button" key={slide.id} aria-current={activeIndex === index ? 'step' : undefined} onClick={() => { setSelected(index); setNotice(''); }}><span>{String(index + 1).padStart(2, '0')}</span><span>{slide.title}<small>{designMode && draft.presentation?.slides[index]?.hidden ? 'Excluded from export' : slide.missingFields.length ? `${slide.missingFields.length} fields to complete` : 'Text supplied'}</small></span></button>)}</nav>
      <div className="project-pitch-workspace"><ProjectPitchPreview deck={editorDeck} index={activeIndex}/>
        {designMode && activeSlide ? <fieldset className="project-pitch-slide-editor" disabled={disabled}><legend>Edit slide {activeIndex + 1}</legend>
          <div className="project-pitch-slide-actions"><label className="project-pitch-include"><input type="checkbox" aria-label="Include slide in export" checked={!activeSlide.hidden} onChange={event => updateSlide({ hidden: !event.target.checked })}/>Include in export</label><button type="button" disabled={disabled || activeIndex === 0} onClick={() => moveSlide(-1)}>Move up</button><button type="button" disabled={disabled || activeIndex === editorDeck.totalSlides - 1} onClick={() => moveSlide(1)}>Move down</button><button type="button" disabled={disabled || editorDeck.totalSlides >= 40} onClick={() => addSlide(true)}>Duplicate slide</button><button type="button" disabled={disabled || editorDeck.totalSlides <= 1} onClick={removeSlide}>Remove slide</button></div>
          <label>Slide title<input aria-label="Slide title" maxLength={300} value={activeSlide.title} onChange={event => updateSlide({ title: event.target.value })}/></label>
          <div className="project-pitch-media-controls"><label>Layout<select aria-label="Slide layout" value={activeSlide.layout} onChange={event => updateSlide({ layout: event.target.value as PresentationSlide['layout'] })}><option value="text">Text</option><option value="image-left">Image beside text</option><option value="background">Image background</option></select></label><label>Project image<select aria-label="Slide image" value={activeSlide.imageHash ?? ''} onChange={event => updateSlide({ imageHash: event.target.value || undefined })}><option value="">No image</option>{activeSlide.imageHash && !images.some(asset => asset.asset.sha256 === activeSlide.imageHash) && <option value={activeSlide.imageHash}>Current image · {activeSlide.imageHash.slice(0, 10)}</option>}{images.map(asset => <option key={asset.asset.sha256} value={asset.asset.sha256}>{asset.title || asset.originalFilename}</option>)}</select></label></div>
          {activeSlide.imageHash && <label>Image caption / credit<input aria-label="Image caption / credit" maxLength={1000} value={activeSlide.imageCaption ?? ''} onChange={event => updateSlide({ imageCaption: event.target.value })}/></label>}
          <p className="scope-note">Use Library to add project images. Check use rights and credits before sharing.</p>
          {activeSlide.sections.map((section, index) => <section key={index} className="project-pitch-section-editor" aria-label={`Slide section ${index + 1}`}><label>Section {index + 1} label<input aria-label={`Section ${index + 1} label`} maxLength={120} value={section.label} onChange={event => updateSection(index, { label: event.target.value })}/></label><label>Section {index + 1} text<textarea aria-label={`Section ${index + 1} text`} rows={5} maxLength={20000} value={section.body} onChange={event => updateSection(index, { body: event.target.value })}/></label><button type="button" onClick={() => updateSlide({ sections: activeSlide.sections.filter((_, position) => position !== index) })}>Remove section {index + 1}</button></section>)}
          <button type="button" disabled={disabled || activeSlide.sections.length >= 12} onClick={() => updateSlide({ sections: [...activeSlide.sections, { label: '', body: '' }] })}>Add text section</button>
        </fieldset> : <fieldset className="project-pitch-fields" disabled={disabled}><legend>{definition.title}</legend>{definition.fields.map(key => {
          const detail = PROJECT_PITCH_FIELDS.find(field => field.key === key);
          const label = detail?.label ?? (key === 'title' ? 'Pitch title' : key === 'logline' ? 'Pitch logline' : PITCH_FIELDS.find(([field]) => field === key)?.[1] ?? key);
          const prompt = detail?.prompt ?? storyPrompts[key];
          const value = detail ? draft.projectDetails?.[detail.key] ?? '' : String(draft[key as keyof PitchDraft] ?? '');
          const maxLength = detail?.maxLength ?? (key === 'title' ? 200 : key === 'logline' ? 1000 : 20000);
          return <label key={key}><span>{label}</span><small>{prompt}</small>{['title','tagline','format','genre','runtime','contact'].includes(key)
            ? <input aria-label={label} maxLength={maxLength} value={value} onChange={event => setField(key, event.target.value)}/>
            : <textarea aria-label={label} rows={key === 'synopsis' ? 8 : 4} maxLength={maxLength} value={value} onChange={event => setField(key, event.target.value)}/>}</label>;
        })}</fieldset>}
        <div className="project-pitch-step"><button type="button" disabled={activeIndex === 0} onClick={() => setSelected(activeIndex - 1)}>Previous slide</button><span>{activeIndex + 1} / {editorDeck.totalSlides}</span><button type="button" disabled={activeIndex === editorDeck.totalSlides - 1} onClick={() => setSelected(activeIndex + 1)}>Next slide</button></div>
      </div>
    </div>
  </section>;
}
