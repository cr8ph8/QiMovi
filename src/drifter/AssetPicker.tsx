import { useEffect, useState } from 'react';
import { ImagePlus, Search, X } from 'lucide-react';
import { projectLibraryApi, type ProjectLibraryApi } from './projectLibraryApi';
import type { ProjectLibraryCatalog } from './projectLibraryModel';
import { filterPickerImages, imageSelection, selectableImages, type AssetSelection } from './assetPickerModel';
import type { Project } from './types';
import './asset-picker.css';

interface Props {
  project: Project;
  label?: string;
  selectedHashes?: string[];
  disabled?: boolean;
  multiple?: boolean;
  onSelect: (selection: AssetSelection) => void;
  libraryApi?: ProjectLibraryApi;
}

function ImageChoices({ project, selectedHashes, disabled, onSelect, onClose, libraryApi }: Required<Pick<Props, 'project' | 'selectedHashes' | 'onSelect' | 'libraryApi'>> & { disabled?: boolean; onClose: () => void }) {
  const [catalog, setCatalog] = useState<{ scope: string; value: ProjectLibraryCatalog }>();
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('');
  const [shortlist, setShortlist] = useState(false);
  const [limit, setLimit] = useState(36);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scope = `${project.id}:${project.sourceHash}`;
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setLoading(true); setError('');
    libraryApi.load(project, controller.signal).then(value => {
      if (!current) return;
      if (value.sourceHash !== project.sourceHash) throw new Error('The image library belongs to an earlier screenplay. Refresh the project before choosing an image.');
      setCatalog({ scope, value });
    }).catch(failure => { if (current) setError(failure instanceof Error ? failure.message : 'The local image library could not be read.'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [project, scope, libraryApi, refresh]);
  const entries = selectableImages(catalog?.scope === scope ? catalog.value : undefined, project);
  const filtered = filterPickerImages(entries, query, collection, shortlist);
  const ready = !disabled && !loading && !error && catalog?.scope === scope;
  return <section className="asset-picker" aria-label="Choose a project image">
    <header><strong>Project images</strong><button type="button" onClick={onClose} aria-label="Close image library"><X size={17}/></button></header>
    <div className="asset-picker-filters"><label><Search size={15} aria-hidden="true"/><input autoFocus aria-label="Find a reference image" placeholder="Name, collection or tag…" value={query} onChange={event => { setQuery(event.target.value); setLimit(36); }}/></label><select aria-label="Reference image collection" value={collection} onChange={event => { setCollection(event.target.value); setLimit(36); }}><option value="">All collections</option>{[...new Set(entries.map(entry => entry.collection))].sort().map(name => <option key={name}>{name}</option>)}</select><label className="asset-picker-shortlist"><input type="checkbox" checked={shortlist} onChange={event => { setShortlist(event.target.checked); setLimit(36); }}/>Shortlisted</label></div>
    {loading && <p role="status">Reading the local image library…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry image library</button></p>}
    {!loading && !error && <p className="asset-picker-count">{filtered.length} matching images · choose a candidate for this draft</p>}
    <div className="asset-picker-grid" aria-label="Reference image choices">{filtered.slice(0, limit).map(entry => <button type="button" key={entry.id} disabled={!ready || selectedHashes.includes(entry.sha256)} aria-label={`${selectedHashes.includes(entry.sha256) ? 'Already selected' : 'Choose'} ${entry.title}`} onClick={() => { const selection = imageSelection(entry, project); if (ready && selection) onSelect(selection); }}><img src={entry.downloadUrl} alt="" loading="lazy"/><span>{entry.title}</span><small>{selectedHashes.includes(entry.sha256) ? 'Selected in this draft' : entry.collection}</small></button>)}</div>
    {!loading && !error && !filtered.length && <p>No images match. Try another collection or search.</p>}
    {filtered.length > limit && <button type="button" onClick={() => setLimit(value => value + 36)}>Show more images</button>}
    <p className="scope-note">Selection attaches the retained original. Save the draft to keep your choice; review and use permissions remain separate.</p>
  </section>;
}

export default function AssetPicker({ project, label = 'Choose from image library', selectedHashes = [], disabled = false, multiple = false, onSelect, libraryApi = projectLibraryApi }: Props) {
  const [open, setOpen] = useState(false);
  return <div className="asset-picker-control"><button type="button" className="secondary asset-picker-open" disabled={disabled} aria-expanded={open} onClick={() => setOpen(value => !value)}><ImagePlus size={16} aria-hidden="true"/>{label}</button>{open && <ImageChoices key={`${project.id}:${project.sourceHash}`} project={project} selectedHashes={selectedHashes} disabled={disabled} libraryApi={libraryApi} onClose={() => setOpen(false)} onSelect={selection => { if (!disabled) { onSelect(selection); if (!multiple) setOpen(false); } }}/>}</div>;
}
