import {
  assertSha256,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { DECISIONS, GENESIS_HASH, RISK_TIERS, SCHEMA } from "./constants.mjs";
import { validateDelta, validateTitleGenesis } from "./contracts.mjs";
import { KernelError, invariant } from "./errors.mjs";
import { applyDelta } from "./reducer.mjs";

const EVENT_KEYS = new Set([
  "schema_version",
  "sequence",
  "event_id",
  "event_type",
  "aggregate_id",
  "occurred_at_ms",
  "proposal_id",
  "proposal_hash",
  "decision",
  "reason_codes",
  "effective_risk",
  "receipt_hashes",
  "delta",
  "genesis_state",
  "state_before_version",
  "state_before_hash",
  "state_after_version",
  "state_after_hash",
  "previous_event_hash",
  "event_hash",
]);

const ID_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function exactEventKeys(event) {
  invariant(event && typeof event === "object" && !Array.isArray(event), "INVALID_EVENT", "Event must be an object.");
  const unknown = Object.keys(event).filter((key) => !EVENT_KEYS.has(key));
  const missing = [...EVENT_KEYS].filter((key) => !(key in event));
  invariant(unknown.length === 0 && missing.length === 0, "INVALID_EVENT_SHAPE", "Event keys do not match the v1 contract.", { unknown, missing });
}

function safeNonnegativeInteger(value, field) {
  invariant(Number.isSafeInteger(value) && value >= 0, "INVALID_EVENT", `${field} must be a non-negative safe integer.`);
}

function identifier(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_EVENT", `${field} is not a valid identifier.`);
}

function uniqueSortedIdentifiers(values, field, { allowEmpty = true } = {}) {
  invariant(Array.isArray(values), "INVALID_EVENT", `${field} must be an array.`);
  if (!allowEmpty) invariant(values.length > 0, "INVALID_EVENT", `${field} must not be empty.`);
  for (const value of values) identifier(value, `${field} item`);
  invariant(new Set(values).size === values.length, "INVALID_EVENT", `${field} must not contain duplicates.`);
  const sorted = [...values].sort();
  invariant(values.every((value, index) => value === sorted[index]), "INVALID_EVENT", `${field} must use canonical code-unit order.`);
}

function uniqueSortedHashes(values, field) {
  invariant(Array.isArray(values), "INVALID_EVENT", `${field} must be an array.`);
  for (const value of values) assertSha256(value, `${field} item`);
  invariant(new Set(values).size === values.length, "INVALID_EVENT", `${field} must not contain duplicates.`);
  const sorted = [...values].sort();
  invariant(values.every((value, index) => value === sorted[index]), "INVALID_EVENT", `${field} must use canonical code-unit order.`);
}

export function validateEventContract(event) {
  exactEventKeys(event);
  invariant(event.schema_version === SCHEMA.event, "UNSUPPORTED_SCHEMA", `Unsupported event schema: ${event.schema_version}.`);
  safeNonnegativeInteger(event.sequence, "event.sequence");
  invariant(event.sequence >= 1, "INVALID_EVENT", "event.sequence must be at least 1.");
  identifier(event.event_id, "event.event_id");
  identifier(event.aggregate_id, "event.aggregate_id");
  safeNonnegativeInteger(event.occurred_at_ms, "event.occurred_at_ms");
  safeNonnegativeInteger(event.state_after_version, "event.state_after_version");
  assertSha256(event.state_after_hash, "event.state_after_hash");
  assertSha256(event.previous_event_hash, "event.previous_event_hash");
  assertSha256(event.event_hash, "event.event_hash");
  uniqueSortedIdentifiers(event.reason_codes, "event.reason_codes");
  uniqueSortedHashes(event.receipt_hashes, "event.receipt_hashes");
  invariant(Array.isArray(event.delta) && event.delta.length <= 64, "INVALID_EVENT", "event.delta must contain at most 64 operations.");
  if (event.delta.length > 0) validateDelta(event.delta);

  if (event.event_type === "GENESIS") {
    invariant(event.proposal_id === null && event.proposal_hash === null && event.decision === null, "INVALID_GENESIS", "GENESIS cannot contain a proposal or decision.");
    invariant(event.reason_codes.length === 0, "INVALID_GENESIS", "GENESIS cannot contain reason codes.");
    invariant(event.effective_risk === null, "INVALID_GENESIS", "GENESIS cannot contain an effective risk.");
    invariant(event.receipt_hashes.length === 0, "INVALID_GENESIS", "GENESIS cannot contain verifier receipts.");
    invariant(event.delta.length === 0, "INVALID_GENESIS", "GENESIS cannot contain a state delta.");
    invariant(event.genesis_state !== null, "MISSING_GENESIS_STATE", "GENESIS event must carry its initial state envelope.");
    invariant(event.state_before_version === null && event.state_before_hash === null, "INVALID_GENESIS", "GENESIS cannot have a prior state.");
    invariant(event.state_after_version === 0, "INVALID_GENESIS", "GENESIS must produce aggregate version 0.");
    return event;
  }

  invariant(event.event_type === "DECISION", "UNKNOWN_EVENT_TYPE", `Unknown event type: ${event.event_type}.`);
  identifier(event.proposal_id, "event.proposal_id");
  assertSha256(event.proposal_hash, "event.proposal_hash");
  invariant(DECISIONS.includes(event.decision), "INVALID_DECISION", `Unknown decision: ${event.decision}.`);
  invariant(RISK_TIERS.includes(event.effective_risk), "INVALID_RISK", `Unknown effective risk: ${event.effective_risk}.`);
  invariant(event.genesis_state === null, "INVALID_DECISION_EVENT", "DECISION event cannot carry genesis_state.");
  safeNonnegativeInteger(event.state_before_version, "event.state_before_version");
  assertSha256(event.state_before_hash, "event.state_before_hash");
  if (event.decision === "COMMIT") {
    invariant(event.delta.length > 0, "INVALID_DECISION_EVENT", "COMMIT must carry a non-empty state delta.");
  } else {
    invariant(event.reason_codes.length > 0, "INVALID_DECISION_EVENT", `${event.decision} must carry at least one reason code.`);
  }
  return event;
}

function eventHashPayload(event) {
  const payload = cloneCanonical(event);
  delete payload.event_hash;
  return payload;
}

export function verifyEventChain(events) {
  invariant(Array.isArray(events), "INVALID_EVENT_CHAIN", "events must be an array.");
  let previous = GENESIS_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    validateEventContract(event);
    invariant(event.sequence === index + 1, "EVENT_SEQUENCE_BROKEN", "Event sequence is missing, duplicated, or reordered.");
    invariant(event.event_id === `evt-${String(event.sequence).padStart(12, "0")}`, "EVENT_ID_MISMATCH", "Event ID does not match sequence.");
    invariant(timingSafeHashEqual(event.previous_event_hash, previous), "EVENT_CHAIN_BROKEN", "Event previous hash does not match the ledger head.");
    const observed = hashCanonical(eventHashPayload(event));
    invariant(timingSafeHashEqual(event.event_hash, observed), "EVENT_HASH_MISMATCH", "Event hash does not match canonical event bytes.");
    previous = event.event_hash;
  }
  return { event_count: events.length, history_head: previous };
}

export function replayEvents(events) {
  const chain = verifyEventChain(events);
  const aggregates = new Map();

  for (const event of events) {
    if (event.event_type === "GENESIS") {
      validateTitleGenesis(event.genesis_state, { allowLegacy: true });
      invariant(event.genesis_state.aggregate_id === event.aggregate_id, "GENESIS_AGGREGATE_MISMATCH", "GENESIS event aggregate_id must match its embedded aggregate.");
      invariant(!aggregates.has(event.aggregate_id), "DUPLICATE_GENESIS", `Duplicate genesis for ${event.aggregate_id}.`);
      invariant(event.state_after_version === event.genesis_state.version && event.state_after_hash === event.genesis_state.state_hash, "INVALID_GENESIS", "GENESIS state fields do not match its envelope.");
      aggregates.set(event.aggregate_id, cloneCanonical(event.genesis_state));
      continue;
    }

    const current = aggregates.get(event.aggregate_id);
    invariant(current, "MISSING_GENESIS", `No genesis found for ${event.aggregate_id}.`);
    invariant(current.version === event.state_before_version, "REPLAY_VERSION_MISMATCH", "Event state_before_version does not match replay state.");
    invariant(timingSafeHashEqual(current.state_hash, event.state_before_hash), "REPLAY_HASH_MISMATCH", "Event state_before_hash does not match replay state.");

    if (event.decision === "COMMIT") {
      const next = applyDelta(current, event.delta);
      invariant(next.version === event.state_after_version, "REPLAY_VERSION_MISMATCH", "Replayed commit version does not match event.");
      invariant(timingSafeHashEqual(next.state_hash, event.state_after_hash), "REPLAY_HASH_MISMATCH", "Replayed commit hash does not match event.");
      aggregates.set(event.aggregate_id, next);
    } else {
      invariant(event.state_after_version === current.version, "NON_COMMIT_STATE_WRITE", `${event.decision} changed the state version in history.`);
      invariant(timingSafeHashEqual(event.state_after_hash, current.state_hash), "NON_COMMIT_STATE_WRITE", `${event.decision} changed the state hash in history.`);
    }
  }

  return {
    aggregates: Object.fromEntries([...aggregates.entries()].sort(([left], [right]) => left.localeCompare(right))),
    event_count: chain.event_count,
    history_head: chain.history_head,
  };
}

export function assertReplayMatches(events, readAggregate) {
  const replay = replayEvents(events);
  for (const [aggregateId, reconstructed] of Object.entries(replay.aggregates)) {
    const current = readAggregate(aggregateId);
    if (!current) {
      throw new KernelError("REPLAY_AGGREGATE_MISSING", `Stored aggregate is missing: ${aggregateId}.`);
    }
    invariant(current.version === reconstructed.version, "REPLAY_VERSION_MISMATCH", `Stored version differs for ${aggregateId}.`);
    invariant(timingSafeHashEqual(current.state_hash, reconstructed.state_hash), "REPLAY_HASH_MISMATCH", `Stored hash differs for ${aggregateId}.`);
  }
  return replay;
}
