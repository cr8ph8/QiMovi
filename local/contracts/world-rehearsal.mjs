// A fictional rehearsal is a bounded draft branch. Deterministic consequences
// do not admit screenplay, canon, casting, rights or production state.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,139}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && value.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
export function rehearsalAssert(condition, code) { if (!condition) throw Object.assign(new Error(code), { code, status: 422 }); }
const check = rehearsalAssert;
const shape = (value, fields) => check(object(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(','), 'REHEARSAL_FIELDS_INVALID');
const stable = value => JSON.stringify(value, function (_key, item) { return object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item; });
const equal = (a, b) => stable(a) === stable(b);
const list = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max;
const unique = values => new Set(values).size === values.length;
function reference(value) { shape(value, ['id', 'sha256']); check(typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.sha256), 'REHEARSAL_REFERENCE_INVALID'); }
function setup(data, project) {
  shape(data, ['schemaVersion', 'sourceHash', 'citations', 'status', 'review', 'title', 'sceneId', 'participants', 'initialFacts', 'rules', 'rounds']);
  check(data.schemaVersion === 1 && typeof data.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(data.sourceHash) && (!project || data.sourceHash === project.sourceHash), 'REHEARSAL_SOURCE_MISMATCH');
  check(data.status === 'DRAFT' && data.review === 'PROPOSED' && Array.isArray(data.citations) && data.citations.length === 0, 'REHEARSAL_AUTHORITY_INVALID');
  check(text(data.title, 240) && (data.sceneId === null || id(data.sceneId) && (!project || project.scenes.some(scene => scene.id === data.sceneId))), 'REHEARSAL_SCENE_INVALID');
  check(list(data.participants, 1, 8), 'REHEARSAL_PARTICIPANT_LIMIT');
  for (const party of data.participants) { shape(party, ['entityId', 'profileRef']); reference(party.profileRef); check(id(party.entityId) && party.profileRef.id === `universe-agent:${party.entityId}`, 'REHEARSAL_PARTICIPANT_INVALID'); }
  const parties = data.participants.map(party => party.entityId); check(unique(parties), 'REHEARSAL_DUPLICATE_PARTICIPANT');
  check(list(data.initialFacts, 1, 32), 'REHEARSAL_FACT_LIMIT');
  for (const fact of data.initialFacts) { shape(fact, ['id', 'label', 'value']); check(id(fact.id) && text(fact.label, 240) && typeof fact.value === 'boolean', 'REHEARSAL_FACT_INVALID'); }
  const facts = data.initialFacts.map(fact => fact.id); check(unique(facts), 'REHEARSAL_DUPLICATE_FACT');
  check(list(data.rules, 1, 32), 'REHEARSAL_RULE_LIMIT');
  for (const rule of data.rules) {
    shape(rule, ['id', 'label', 'actorIds', 'preconditions', 'effects', 'witnessIds', 'observation']);
    check(id(rule.id) && text(rule.label, 240) && text(rule.observation, 400), 'REHEARSAL_RULE_INVALID');
    for (const field of ['actorIds', 'witnessIds']) check(list(rule[field], field === 'actorIds' ? 1 : 0, 8) && unique(rule[field]) && rule[field].every(entity => parties.includes(entity)), 'REHEARSAL_RULE_ACTOR_INVALID');
    for (const field of ['preconditions', 'effects']) {
      check(list(rule[field], 0, 32) && unique(rule[field].map(value => value?.factId)), 'REHEARSAL_RULE_FACT_INVALID');
      for (const value of rule[field]) { shape(value, ['factId', 'value']); check(facts.includes(value.factId) && typeof value.value === 'boolean', 'REHEARSAL_RULE_FACT_INVALID'); }
    }
  }
  check(unique(data.rules.map(rule => rule.id)) && list(data.rounds, 0, 16), 'REHEARSAL_ROUND_LIMIT');
}
function resolve(data, state, intents, roundId, basisRound, writtenIds, proposalIds) {
  check(id(roundId) && list(intents, 1, 8) && unique(intents.map(intent => intent?.actorId)), 'REHEARSAL_INTENT_INVALID');
  const facts = new Map(state.map(fact => [fact.id, fact.value])), written = new Map(), outcomes = [];
  for (const intent of intents) {
    shape(intent, ['id', 'actorId', 'ruleId', 'proposalRef']);
    check(id(intent.id) && !writtenIds.has(intent.id) && data.participants.some(party => party.entityId === intent.actorId) && data.rules.some(rule => rule.id === intent.ruleId), 'REHEARSAL_INTENT_INVALID');
    writtenIds.add(intent.id);
    if (intent.proposalRef !== null) { reference(intent.proposalRef); check(intent.proposalRef.id.startsWith('model-assistance:') && !proposalIds.has(intent.proposalRef.id), 'REHEARSAL_PROPOSAL_REUSED'); proposalIds.add(intent.proposalRef.id); }
    const rule = data.rules.find(rule => rule.id === intent.ruleId), reasons = [];
    if (!rule.actorIds.includes(intent.actorId)) reasons.push('ACTOR_NOT_ALLOWED');
    if (rule.preconditions.some(condition => facts.get(condition.factId) !== condition.value)) reasons.push('PRECONDITION_NOT_MET');
    if (rule.effects.some(effect => written.has(effect.factId) && written.get(effect.factId) !== effect.value)) reasons.push('CONFLICTING_EARLIER_ACTION');
    const applied = reasons.length === 0, changes = [];
    if (applied) for (const effect of rule.effects) { const before = facts.get(effect.factId); changes.push({ factId: effect.factId, before, after: effect.value }); facts.set(effect.factId, effect.value); written.set(effect.factId, effect.value); }
    const deliveries = applied ? [...new Set([intent.actorId, ...rule.witnessIds])].map(entityId => ({ entityId, text: rule.observation })) : [{ entityId: intent.actorId, text: 'Your attempted action did not take effect.' }];
    outcomes.push({ intentId: intent.id, actorId: intent.actorId, ruleId: intent.ruleId, status: applied ? 'APPLIED' : 'BLOCKED', reasons, changes, deliveries });
  }
  return { round: { id: roundId, basisRound, intents, outcomes }, state: state.map(fact => ({ ...fact, value: facts.get(fact.id) })) };
}
function replay(data, project) {
  setup(data, project);
  let state = data.initialFacts.map(fact => ({ ...fact })); const rounds = new Set(), intents = new Set(), proposals = new Set();
  for (const [index, round] of data.rounds.entries()) {
    shape(round, ['id', 'basisRound', 'intents', 'outcomes']); check(round.basisRound === index && !rounds.has(round.id), 'REHEARSAL_STALE_ROUND'); rounds.add(round.id);
    const resolved = resolve(data, state, round.intents, round.id, index, intents, proposals);
    check(equal(resolved.round, round), 'REHEARSAL_OUTCOME_MISMATCH'); state = resolved.state;
  }
  return { state, rounds, intents, proposals };
}
export function validateWorldRehearsal(data, project) { replay(data, project); return data; }
export function rehearsalState(data) { return replay(data).state; }
export function resolveRehearsalRound(data, intents, roundId) {
  const prior = replay(data); check(data.rounds.length < 16 && !prior.rounds.has(roundId), 'REHEARSAL_ROUND_LIMIT');
  return resolve(data, prior.state, intents, roundId, data.rounds.length, prior.intents, prior.proposals).round;
}
export function validateWorldRehearsalTransition(previous, data, version) {
  validateWorldRehearsal(data);
  check(Number.isSafeInteger(version) && version === data.rounds.length + 1, 'REHEARSAL_VERSION_INVALID');
  if (!previous) { check(version === 1 && data.rounds.length === 0, 'REHEARSAL_INITIAL_ROUNDS_FORBIDDEN'); return; }
  const before = previous.data ?? previous; validateWorldRehearsal(before);
  const base = value => Object.fromEntries(Object.entries(value).filter(([field]) => field !== 'rounds'));
  check(equal(base(before), base(data)), 'REHEARSAL_SETUP_IMMUTABLE');
  check(data.rounds.length === before.rounds.length + 1 && equal(data.rounds.slice(0, -1), before.rounds), 'REHEARSAL_HISTORY_IMMUTABLE');
}
export function characterRehearsalContext(data, entityId) {
  validateWorldRehearsal(data); check(data.participants.some(party => party.entityId === entityId), 'REHEARSAL_CHARACTER_NOT_PARTICIPANT');
  const events = data.rounds.flatMap(round => round.outcomes.flatMap(outcome => outcome.deliveries.filter(delivery => delivery.entityId === entityId).map(delivery => ({ roundId: round.id, text: delivery.text }))));
  return { allowedActions: data.rules.filter(rule => rule.actorIds.includes(entityId)).map(rule => ({ id: rule.id, label: rule.label })), perceivedEvents: events.slice(-24), earlierPerceivedCount: Math.max(0, events.length - 24) };
}
