import { useMemo } from 'react';
import { screenplaySceneCards, setSceneCardSynopsis } from './screenplaySceneCardsModel';
import './screenplay-scene-cards.css';

type Props = { text: string; disabled?: boolean; onChange(text: string): void; onOpenScene(offset: number): void };

export function ScreenplaySceneCards({ text, disabled = false, onChange, onOpenScene }: Props) {
  const cards = useMemo(() => screenplaySceneCards(text), [text]);
  return <section className="screenplay-scene-cards" aria-label="Screenplay scene cards">
    <header><div><strong>{cards.length} {cards.length === 1 ? 'scene' : 'scenes'}</strong><p>Shape each scene’s purpose, then return to the page to write.</p></div><small>Synopses stay in the draft as nonprinting Fountain notes.</small></header>
    {cards.length ? <div className="screenplay-scene-card-grid">{cards.map(({ scene, synopsis, excerpt, ...rest }) => <article className="screenplay-scene-card" key={scene.id}>
      <div className="screenplay-scene-card-heading"><span>Scene {scene.sourceSceneNumber ?? scene.index}</span><small>{scene.wordCount} words</small></div>
      <h3>{scene.heading}</h3>
      <label><span>Scene purpose</span><input aria-label={`Scene ${scene.index} synopsis`} value={synopsis} disabled={disabled} placeholder="What changes in this scene?" onChange={event => { if (!disabled) onChange(setSceneCardSynopsis(text, { scene, synopsis, excerpt, ...rest }, event.target.value)); }}/></label>
      <p className="screenplay-scene-card-excerpt">{excerpt || 'This scene has no body text yet.'}</p>
      {scene.characters.length > 0 && <p className="screenplay-scene-card-characters">{scene.characters.join(' · ')}</p>}
      <button type="button" onClick={() => onOpenScene(scene.start)} aria-label={`Write scene ${scene.index}`}>Write scene <span aria-hidden="true">↗</span></button>
    </article>)}</div> : <p className="screenplay-scene-cards-empty">Add an INT. or EXT. scene heading in Page or Fountain to start your scene cards.</p>}
  </section>;
}
