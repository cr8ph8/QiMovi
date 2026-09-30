// Direct, reviewed source links supply planning context. They never merge
// characters, edit source observations, grant knowledge or authorize spending.
const sorted = values => [...new Set(values)].sort();
const source = entity => entity?.type === 'character' && ['SCREENPLAY', 'LORE_SOURCE'].includes(entity.origin);
const active = entity => entity && entity.review !== 'SET_ASIDE';
const inProject = (data, model) => data.sourceHash === null ? data.projectId === model.projectId : data.sourceHash === model.sourceHash;
const ref = record => ({ id: record.id, version: record.version, sha256: record.sha256 });
function continuity(model) {
  return model.drafts.filter(record => record.kind === 'universe-continuity-plan'
    && record.id === `universe-continuity-plan:${record.data.sourceHash ?? record.data.projectId}` && inProject(record.data, model))
    .sort((a, b) => Number(b.data.sourceHash === null) - Number(a.data.sourceHash === null) || b.version - a.version)[0] ?? null;
}
function working(model, entity) {
  return entity?.type === 'character' && ['DRAFT', 'USER_AUTHORED'].includes(entity.origin)
    && entity.recordRef && model.drafts.some(record => record.kind === 'universe-entity'
      && record.id === entity.recordRef.id && record.id === `universe-entity:${entity.id}`
      && record.sha256 === entity.recordRef.sha256 && inProject(record.data, model));
}
function component(start, edges) {
  const seen = new Set([start]), pending = [start];
  while (pending.length) for (const id of edges.get(pending.pop()) ?? []) if (!seen.has(id)) { seen.add(id); pending.push(id); }
  return seen;
}

/** Pure view of a validated catalog. The fingerprint is a change detector,
 * not a signature or an authorization token. Only direct links lend scenes. */
export function characterSourceContext(model, entity) {
  const current = model.entities.find(item => item.id === entity.id);
  const record = continuity(model), linked = [], blocked = [];
  const aliases = record?.data.aliases ?? [];
  const entities = new Map(model.entities.map(item => [item.id, item]));
  const ownScenes = active(current) ? sorted(current.sceneIds) : [];
  if (working(model, current)) {
    const direct = new Map();
    for (const alias of aliases) {
      const otherId = alias.fromEntityId === current.id ? alias.toEntityId : alias.toEntityId === current.id ? alias.fromEntityId : null;
      const other = entities.get(otherId);
      if (!source(other) || alias.review === 'SET_ASIDE') continue;
      if (!direct.has(other.id)) direct.set(other.id, []);
      direct.get(other.id).push(alias);
    }
    // The graph is used only to detect contradictory decisions. It is never a
    // source of transitive scene links, even when a chain is consistent.
    const edges = new Map();
    const relevantAliases = aliases.filter(alias => alias.review !== 'SET_ASIDE');
    for (const alias of relevantAliases.filter(alias => alias.decision === 'SAME_CHARACTER')) {
      for (const [a, b] of [[alias.fromEntityId, alias.toEntityId], [alias.toEntityId, alias.fromEntityId]]) {
        if (!edges.has(a)) edges.set(a, new Set()); edges.get(a).add(b);
      }
    }
    for (const [observationId, directAliases] of [...direct].sort(([a], [b]) => a.localeCompare(b))) {
      const observation = entities.get(observationId), connected = component(observationId, edges);
      let reason = '';
      if (!active(current) || !active(observation)) reason = 'This character or source observation is set aside.';
      else if (record.data.review !== 'PROPOSED') reason = 'The identity plan needs review before its source scenes can be used.';
      else if (directAliases.some(alias => alias.review === 'QUESTIONED')) reason = 'A decision about this pair is questioned.';
      else if (directAliases.some(alias => alias.decision !== 'SAME_CHARACTER')) reason = 'This pair is unresolved or marked as different characters.';
      else if (relevantAliases.some(alias => alias.decision === 'DISTINCT_CHARACTERS' && connected.has(alias.fromEntityId) && connected.has(alias.toEntityId))) reason = 'Connected same-character and different-character decisions conflict.';
      else {
        const owners = new Set(relevantAliases.filter(alias => alias.decision === 'SAME_CHARACTER')
          .flatMap(alias => alias.fromEntityId === observationId ? [alias.toEntityId] : alias.toEntityId === observationId ? [alias.fromEntityId] : [])
          .filter(id => working(model, entities.get(id)) && active(entities.get(id))));
        if (owners.size > 1) reason = 'This source observation is linked to more than one working character.';
      }
      if (reason) blocked.push({ entity: observation, reason });
      else linked.push({ entity: observation, aliasIds: sorted(directAliases.map(alias => alias.id)) });
    }
  }
  const observedSceneIds = sorted(linked.flatMap(item => item.entity.sceneIds));
  const basis = linked.length ? {
    continuityRef: ref(record),
    aliases: linked.flatMap(item => item.aliasIds.map(aliasId => ({ aliasId, observationId: item.entity.id })))
      .sort((a, b) => a.aliasId.localeCompare(b.aliasId) || a.observationId.localeCompare(b.observationId)),
    observedSceneIds,
  } : null;
  const sceneIds = sorted([...ownScenes, ...observedSceneIds]);
  const fingerprint = JSON.stringify({ projectId: model.projectId, sourceHash: model.sourceHash,
    entity: current ? { id: current.id, origin: current.origin, review: current.review, recordRef: current.recordRef, sceneIds: ownScenes } : null,
    continuityRef: record ? ref(record) : null, basis,
    linked: linked.map(item => ({ id: item.entity.id, origin: item.entity.origin, review: item.entity.review, sceneIds: sorted(item.entity.sceneIds), citations: item.entity.citations })),
    blocked: blocked.map(item => ({ id: item.entity.id, reason: item.reason })),
  });
  return { linked, blocked, sceneIds, basis, fingerprint };
}

/** Saved provenance stays historical when decisions change; UI can explain
 * that difference without deleting the need or silently changing its scenes. */
export function sourceLinkBasisIsCurrent(model, entity, basis) {
  const current = characterSourceContext(model, entity).basis;
  if (!current || !basis) return false;
  const normalize = value => JSON.stringify({ continuityRef: ref(value.continuityRef),
    aliases: value.aliases.map(alias => ({ aliasId: alias.aliasId, observationId: alias.observationId }))
      .sort((a, b) => a.aliasId.localeCompare(b.aliasId) || a.observationId.localeCompare(b.observationId)),
    observedSceneIds: sorted(value.observedSceneIds),
  });
  return normalize(current) === normalize(basis);
}
