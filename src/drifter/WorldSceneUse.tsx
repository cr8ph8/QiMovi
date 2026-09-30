import { useEffect, useMemo, useState } from 'react';
import type { Project } from './types';
import type { UniverseCatalog, UniverseEntity } from './universeApi';
import { activeWorldNeeds, worldProductionPlan } from './worldProductionModel';
import { universeTypeLabel } from './universeLibraryModel';
import './world-production.css';

/** A scene-presence view adapted from CanIScreenwrite's cross-world presence
 * pattern. Rows are exact identities; columns follow screenplay order only. */
export default function WorldSceneUse({ model, entities, scenes, onEntity, onPlan, onScene }: {
  model: UniverseCatalog; entities: UniverseEntity[]; scenes: Project['scenes'];
  onEntity(id: string): void; onPlan?(entity: UniverseEntity): void; onScene?(id: string): void;
}) {
  const [scope, setScope] = useState<'connected' | 'all' | 'unplanned'>('connected'), [page, setPage] = useState(0);
  const rows = useMemo(() => entities.map(entity => ({ entity, needs: activeWorldNeeds(worldProductionPlan(model, entity.id)),
    profile: model.drafts.some(record => record.kind === 'universe-profile' && record.data.sourceHash === model.sourceHash && 'entityId' in record.data && record.data.entityId === entity.id && record.data.review !== 'SET_ASIDE'),
  })).filter(row => {
    if (scope === 'all') return true;
    if (scope === 'unplanned') return !row.needs.length;
    return row.entity.sceneIds.some(id => scenes.some(scene => scene.id === id)) || row.needs.length > 0;
  }), [entities, model, scenes, scope]);
  useEffect(() => setPage(0), [entities, scope]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 25)), currentPage = Math.min(page, pageCount - 1), shown = rows.slice(currentPage * 25, (currentPage + 1) * 25);
  return <section className="world-scene-use" aria-label="World scene use">
    <header><div><h3>Story use</h3><p>Connect the world to the film. Scene order follows the retained screenplay.</p></div><label>Show<select aria-label="Story use scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="connected">Used or planned in this film</option><option value="all">All matching world entries</option><option value="unplanned">No active production needs</option></select></label></header>
    <p className="world-use-legend"><span>Source = recorded appearance</span><span>Linked = draft scene link</span><span>Plan = proposed production use</span><span>— = no recorded use</span></p>
    <div className="world-use-scroll" tabIndex={0} role="region" aria-label="Scene use matrix"><table><caption>{rows.length} matching entries · identities and possible aliases stay separate</caption><thead><tr><th scope="col">World entry</th><th scope="col">Development</th>{scenes.map(scene => <th scope="col" key={scene.id}><button type="button" title={scene.heading} disabled={!onScene} onClick={() => onScene?.(scene.id)}>Scene {scene.index}</button></th>)}<th scope="col">Production</th></tr></thead>
      <tbody>{shown.map(({ entity, needs, profile }) => <tr key={entity.id}>
        <th scope="row"><button type="button" onClick={() => onEntity(entity.id)}>{entity.name}</button><small>{universeTypeLabel(entity.type)} · {entity.origin === 'SCREENPLAY' ? 'Screenplay' : entity.origin === 'LORE_SOURCE' ? 'Lore source' : 'Authored draft'}</small></th>
        <td><span>{profile ? 'Profile saved' : 'No profile'}</span><small>{needs.length} active need{needs.length === 1 ? '' : 's'}</small></td>
        {scenes.map(scene => { const sourceUse = entity.sceneIds.includes(scene.id); const plans = needs.filter(need => need.sceneIds.includes(scene.id)); return <td key={scene.id} aria-label={`${entity.name} · Scene ${scene.index}`}>
          {sourceUse && <span className="world-use-source">{entity.origin === 'SCREENPLAY' && entity.review === 'OBSERVED' ? 'Source' : 'Linked'}</span>}
          {plans.length > 0 && <button type="button" className="world-use-plan" title={plans.map(need => need.label).join('\n')} onClick={() => onPlan ? onPlan(entity) : onEntity(entity.id)}>Plan {plans.length}</button>}
          {!sourceUse && !plans.length && <span className="world-use-none">—</span>}
        </td>; })}
        <td>{onPlan ? <button type="button" onClick={() => onPlan(entity)}>{needs.length ? 'Edit needs' : 'Plan needs'}</button> : <button type="button" onClick={() => onEntity(entity.id)}>Open entry</button>}{needs.some(need => need.review === 'QUESTIONED') && <small>Needs an answer</small>}</td>
      </tr>)}</tbody></table></div>
    {!rows.length && <p>No matching scene use. Show all entries to start a production plan.</p>}
    <footer><span>{rows.length ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, rows.length)} of ${rows.length}` : '0 entries'}</span><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous entries</button><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next entries</button></footer>
    <p>Planned use does not change the screenplay, story chronology or character knowledge. A saved need becomes budget coverage with its rate left open.</p>
  </section>;
}
