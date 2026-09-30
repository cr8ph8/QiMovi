import { characterSourceContext } from '../../local/contracts/character-source-context.mjs';
import type { UniverseCatalog, UniverseCitation, UniverseEntity } from './universeApi';
import type { Project } from './types';

type Props = {
  model: UniverseCatalog; entity: UniverseEntity;
  scenes: Pick<Project['scenes'][number], 'id' | 'index' | 'heading'>[];
  onEntity(id: string): void; onReadSource(citation: UniverseCitation): void; onScene(id: string): void;
  onReview?(): void; onPlan?(): void;
};

/** Shows reviewed connections without replacing either source or working identity. */
export default function CharacterSourceLinks({ model, entity, scenes, onEntity, onReadSource, onScene, onReview, onPlan }: Props) {
  const context = characterSourceContext(model, entity);
  const working = ['DRAFT', 'USER_AUTHORED'].includes(entity.origin) && Boolean(entity.recordRef);
  return <section className="bible-section" aria-label="Character source connections">
    <div className="bible-section-title"><h3>Character source connections</h3>
      {onReview && <button type="button" className="bible-propose" onClick={onReview}>Link source observations</button>}
    </div>
    <p className="bible-muted">{working
      ? 'Connect this working character to the exact entries in your sources. Reviewed links make their scene appearances available when you plan production needs.'
      : 'This is a source observation. Review its identity with a working character to carry its scene appearances into the film plan.'}</p>
    {context.linked.map(({ entity: source }) => <article className="bible-relationship" key={source.id}>
      <button type="button" onClick={() => onEntity(source.id)}><strong>{source.name}</strong></button>
      <small>{source.origin === 'SCREENPLAY' ? 'Screenplay observation' : 'Lore observation'} · {source.sceneIds.length} recorded scene links</small>
      {source.citations.length > 0 && <details><summary>Read source evidence · {source.citations.length}</summary>
        {source.citations.map((citation, index) => <button type="button" className="bible-scene" key={index} onClick={() => onReadSource(citation)}>{citation.label}{citation.paragraphId ? ` · ${citation.paragraphId}` : ''}</button>)}
      </details>}
    </article>)}
    {context.blocked.map(({ entity: source, reason }) => <p role="status" key={source.id}><strong>{source.name}:</strong> {reason}</p>)}
    {working && !context.linked.length && <p>No source observations are ready to use. Record a same-character decision in Continuity, or leave uncertain matches for later.</p>}
    {context.linked.length > 0 && <>
      <p>{context.sceneIds.length} distinct scene appearances available for planning. Source text, casting and costs keep their existing records.</p>
      <div aria-label="Scenes available through character identity">{context.sceneIds.map(id => {
        const scene = scenes.find(item => item.id === id);
        return scene ? <button type="button" className="bible-scene" key={id} onClick={() => onScene(id)}>Scene {scene.index} · {scene.heading}</button> : null;
      })}</div>
      {onPlan && <button type="button" className="bible-propose" onClick={onPlan}>Plan production from these sources</button>}
    </>}
  </section>;
}
