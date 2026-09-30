import fs from "node:fs";

import {
  assertSha256,
  cloneCanonical,
  hashCanonical,
  timingSafeHashEqual,
} from "./canonical-json.mjs";
import { SCHEMA } from "./constants.mjs";
import { invariant } from "./errors.mjs";

export const IMPACT_STATUSES = Object.freeze([
  "UNAFFECTED",
  "NEEDS_REVIEW",
  "STALE",
  "INVALID",
]);

export const DEPENDENCY_RELATIONS = Object.freeze([
  "DERIVES_EXACTLY",
  "DEPENDS_MATERIALLY",
  "SATISFIES_REQUIREMENT",
  "GOVERNS_GATE",
]);

const GRAPH_SCHEMA = "filmstack-dependency-graph/v1";
const SOURCE_SCHEMA = "filmstack-dependency-rule-source/v1";
const IMPACT_SCHEMA = "filmstack-artifact-impact/v1";
const GRAPH_KEYS = new Set([
  "schema_version",
  "graph_id",
  "graph_version",
  "rules_version",
  "registry_hash",
  "rules",
  "graph_hash",
]);
const SOURCE_KEYS = new Set([
  "schema_version",
  "graph_id",
  "graph_version",
  "rules_version",
  "rules",
]);
const RULE_KEYS = new Set([
  "rule_id",
  "from",
  "to",
  "relation",
  "required",
  "scope_mode",
]);
const ENDPOINT_KEYS = new Set(["kind", "key"]);
const REPORT_KEYS = new Set([
  "schema_version",
  "registry_hash",
  "graph_hash",
  "rules_version",
  "base_state_hash",
  "triggers",
  "impacts",
  "impact_hash",
]);
const TRIGGER_KEYS = new Set(["node_id", "change"]);
const IMPACT_KEYS = new Set(["artifact_key", "status", "root_causes", "rule_ids"]);
const ID_PATTERN = /^(?!(?:__proto__|constructor|prototype|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FACT_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const EVIDENCE_CLASS_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const ARTIFACT_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_RULES = 2048;

function exactKeys(value, expected, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), "INVALID_DEPENDENCY_GRAPH", `${label} must be an object.`);
  const unknown = Object.keys(value).filter((key) => !expected.has(key)).sort();
  const missing = [...expected].filter((key) => !(key in value)).sort();
  invariant(unknown.length === 0 && missing.length === 0, "INVALID_DEPENDENCY_GRAPH", `${label} keys do not match the contract.`, { unknown, missing });
}

function validateId(value, field) {
  invariant(typeof value === "string" && ID_PATTERN.test(value), "INVALID_DEPENDENCY_GRAPH", `${field} is invalid.`);
}

function sortedUniqueStrings(values, field, pattern = ID_PATTERN) {
  invariant(Array.isArray(values), "INVALID_ARTIFACT_IMPACT", `${field} must be an array.`);
  invariant(values.every((value) => typeof value === "string" && pattern.test(value)), "INVALID_ARTIFACT_IMPACT", `${field} has an invalid value.`);
  invariant(new Set(values).size === values.length, "INVALID_ARTIFACT_IMPACT", `${field} contains duplicates.`);
  invariant(values.every((value, index) => value === [...values].sort()[index]), "INVALID_ARTIFACT_IMPACT", `${field} must be sorted.`);
}

function endpointId(endpoint) {
  if (endpoint.kind === "FACT") return `fact:${endpoint.key}`;
  if (endpoint.kind === "EVIDENCE_CLASS") return `evidence-class:${endpoint.key}`;
  return `artifact:${endpoint.key}`;
}

function validateEndpoint(endpoint, field) {
  exactKeys(endpoint, ENDPOINT_KEYS, field);
  invariant(["FACT", "EVIDENCE_CLASS", "ARTIFACT_TYPE"].includes(endpoint.kind), "INVALID_DEPENDENCY_GRAPH", `${field}.kind is unsupported.`);
  const pattern = endpoint.kind === "ARTIFACT_TYPE"
    ? ARTIFACT_PATTERN
    : endpoint.kind === "EVIDENCE_CLASS"
      ? EVIDENCE_CLASS_PATTERN
      : FACT_PATTERN;
  invariant(typeof endpoint.key === "string" && pattern.test(endpoint.key), "INVALID_DEPENDENCY_GRAPH", `${field}.key is invalid.`);
}

function validateRule(rule) {
  exactKeys(rule, RULE_KEYS, "Dependency rule");
  validateId(rule.rule_id, "rule_id");
  validateEndpoint(rule.from, "rule.from");
  validateEndpoint(rule.to, "rule.to");
  invariant(rule.to.kind === "ARTIFACT_TYPE", "INVALID_DEPENDENCY_GRAPH", "MVP dependency targets must be artifact types.");
  invariant(DEPENDENCY_RELATIONS.includes(rule.relation), "INVALID_DEPENDENCY_GRAPH", `Unknown relation: ${rule.relation}.`);
  if (rule.from.kind === "EVIDENCE_CLASS") {
    invariant(rule.relation === "SATISFIES_REQUIREMENT", "INVALID_DEPENDENCY_GRAPH", "Evidence-class dependencies must use SATISFIES_REQUIREMENT.");
  }
  invariant(typeof rule.required === "boolean", "INVALID_DEPENDENCY_GRAPH", "rule.required must be boolean.");
  invariant(rule.scope_mode === "TITLE_WIDE", "INVALID_DEPENDENCY_GRAPH", "Only TITLE_WIDE scope is supported in the MVP.");
  invariant(endpointId(rule.from) !== endpointId(rule.to), "DEPENDENCY_SELF_CYCLE", `Self-edge in ${rule.rule_id}.`);
}

function graphHashPayload(graph) {
  const payload = cloneCanonical(graph);
  delete payload.graph_hash;
  return payload;
}

function ruleOrder(left, right) {
  return left.rule_id.localeCompare(right.rule_id);
}

function artifactKeysFromRegistry(registry) {
  invariant(registry && typeof registry === "object" && Array.isArray(registry.records), "INVALID_ARTIFACT_REGISTRY", "A validated artifact registry is required.");
  assertSha256(registry.registry_hash, "registry.registry_hash");
  return new Set(registry.records.map((record) => record.artifact_key));
}

function graphTopology(graph) {
  const nodes = new Set();
  const outgoing = new Map();
  const indegree = new Map();
  for (const rule of graph.rules) {
    const from = endpointId(rule.from);
    const to = endpointId(rule.to);
    nodes.add(from);
    nodes.add(to);
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(rule);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    if (!indegree.has(from)) indegree.set(from, indegree.get(from) ?? 0);
  }
  for (const rules of outgoing.values()) rules.sort(ruleOrder);

  const ready = [...nodes].filter((node) => (indegree.get(node) ?? 0) === 0).sort();
  const order = [];
  while (ready.length > 0) {
    const node = ready.shift();
    order.push(node);
    for (const rule of outgoing.get(node) ?? []) {
      const target = endpointId(rule.to);
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }
  invariant(order.length === nodes.size, "DEPENDENCY_CYCLE", "Dependency graph contains a directed cycle.");
  return { order, outgoing };
}

export function validateDependencyGraph(graph, { registry = null, requireCoverage = true } = {}) {
  exactKeys(graph, GRAPH_KEYS, "Dependency graph");
  invariant(graph.schema_version === GRAPH_SCHEMA, "INVALID_DEPENDENCY_GRAPH", `Unsupported graph schema: ${graph.schema_version}.`);
  validateId(graph.graph_id, "graph_id");
  invariant(Number.isSafeInteger(graph.graph_version) && graph.graph_version >= 1, "INVALID_DEPENDENCY_GRAPH", "graph_version must be a positive safe integer.");
  validateId(graph.rules_version, "rules_version");
  assertSha256(graph.registry_hash, "registry_hash");
  assertSha256(graph.graph_hash, "graph_hash");
  invariant(Array.isArray(graph.rules) && graph.rules.length > 0 && graph.rules.length <= MAX_RULES, "INVALID_DEPENDENCY_GRAPH", `rules must contain 1..${MAX_RULES} entries.`);

  const ruleIds = new Set();
  const endpoints = new Set();
  for (const rule of graph.rules) {
    validateRule(rule);
    invariant(!ruleIds.has(rule.rule_id), "DUPLICATE_DEPENDENCY_RULE", `Duplicate rule_id: ${rule.rule_id}.`);
    ruleIds.add(rule.rule_id);
    const edge = `${endpointId(rule.from)}>${endpointId(rule.to)}`;
    invariant(!endpoints.has(edge), "DUPLICATE_DEPENDENCY_EDGE", `Duplicate dependency edge: ${edge}.`);
    endpoints.add(edge);
  }
  invariant(graph.rules.every((rule, index) => index === 0 || graph.rules[index - 1].rule_id.localeCompare(rule.rule_id) < 0), "NON_CANONICAL_DEPENDENCY_GRAPH", "Rules must be sorted by rule_id.");

  if (registry) {
    const artifactKeys = artifactKeysFromRegistry(registry);
    invariant(timingSafeHashEqual(graph.registry_hash, registry.registry_hash), "REGISTRY_GRAPH_MISMATCH", "Graph is bound to another artifact registry.");
    const incoming = new Set();
    for (const rule of graph.rules) {
      if (rule.from.kind === "ARTIFACT_TYPE") {
        invariant(artifactKeys.has(rule.from.key), "UNKNOWN_DEPENDENCY_ENDPOINT", `Unknown source artifact: ${rule.from.key}.`);
      }
      invariant(artifactKeys.has(rule.to.key), "UNKNOWN_DEPENDENCY_ENDPOINT", `Unknown target artifact: ${rule.to.key}.`);
      incoming.add(rule.to.key);
    }
    if (requireCoverage) {
      const uncovered = [...artifactKeys].filter((key) => !incoming.has(key)).sort();
      invariant(uncovered.length === 0, "UNCOVERED_ARTIFACT_TYPES", `Artifact types lack dependency rules: ${uncovered.join(", ")}.`, { uncovered });
    }
  }

  graphTopology(graph);
  const observed = hashCanonical(graphHashPayload(graph));
  invariant(timingSafeHashEqual(observed, graph.graph_hash), "DEPENDENCY_GRAPH_HASH_MISMATCH", "Dependency graph hash does not match canonical content.");
  return graph;
}

export function compileDependencyGraph({ registry, source }) {
  exactKeys(source, SOURCE_KEYS, "Dependency rule source");
  invariant(source.schema_version === SOURCE_SCHEMA, "INVALID_DEPENDENCY_GRAPH", `Unsupported dependency source schema: ${source.schema_version}.`);
  const rules = cloneCanonical(source.rules).sort(ruleOrder);
  const draft = {
    schema_version: GRAPH_SCHEMA,
    graph_id: source.graph_id,
    graph_version: source.graph_version,
    rules_version: source.rules_version,
    registry_hash: registry.registry_hash,
    rules,
  };
  const graph = { ...draft, graph_hash: hashCanonical(draft) };
  validateDependencyGraph(graph, { registry });
  return cloneCanonical(graph);
}

export function loadDependencyGraph(path, { registry = null, requireCoverage = true } = {}) {
  const graph = JSON.parse(fs.readFileSync(path, "utf8"));
  validateDependencyGraph(graph, { registry, requireCoverage });
  return cloneCanonical(graph);
}

function strongest(left, right) {
  return IMPACT_STATUSES[Math.max(IMPACT_STATUSES.indexOf(left), IMPACT_STATUSES.indexOf(right))];
}

function relationImpact(rule, upstream) {
  if (upstream === "INVALID" || upstream === "LOST") {
    return rule.required ? "INVALID" : "NEEDS_REVIEW";
  }
  if (upstream === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  if (rule.relation === "DERIVES_EXACTLY") return "STALE";
  return "NEEDS_REVIEW";
}

function triggerMap(state, operations, graph, additionalTriggers) {
  const relevantFacts = new Set(
    graph.rules.filter((rule) => rule.from.kind === "FACT").map((rule) => rule.from.key),
  );
  const relevantArtifactSources = new Set(
    graph.rules.filter((rule) => rule.from.kind === "ARTIFACT_TYPE").map((rule) => rule.from.key),
  );
  const triggers = new Map();
  const relevantNodes = new Set(graph.rules.map((rule) => endpointId(rule.from)));
  for (const trigger of additionalTriggers) {
    invariant(trigger && typeof trigger === "object" && Object.keys(trigger).length === 2, "INVALID_ARTIFACT_TRIGGER", "Additional artifact trigger must contain node_id and change.");
    invariant(/^evidence-class:[a-z][a-z0-9._:-]{0,127}$/.test(trigger.node_id), "INVALID_ARTIFACT_TRIGGER", `Invalid evidence-class trigger: ${trigger.node_id}.`);
    invariant(["CHANGED", "LOST"].includes(trigger.change), "INVALID_ARTIFACT_TRIGGER", `Invalid evidence-class change: ${trigger.change}.`);
    if (!relevantNodes.has(trigger.node_id)) continue;
    const current = triggers.get(trigger.node_id);
    triggers.set(trigger.node_id, current === "LOST" || trigger.change === "LOST" ? "LOST" : "CHANGED");
  }
  for (const operation of operations) {
    if (operation.kind === "RECORD_ARTIFACT_INSTANCE" && relevantArtifactSources.has(operation.payload.artifact_key)) {
      triggers.set(`artifact:${operation.payload.artifact_key}`, "CHANGED");
      continue;
    }
    if (!["UPSERT_FACT", "REMOVE_FACT"].includes(operation.kind) || !relevantFacts.has(operation.target)) continue;
    const nodeId = `fact:${operation.target}`;
    if (operation.kind === "REMOVE_FACT") {
      if (Object.hasOwn(state.facts, operation.target)) triggers.set(nodeId, "LOST");
      continue;
    }
    const before = Object.hasOwn(state.facts, operation.target) ? hashCanonical(state.facts[operation.target]) : "ABSENT";
    const after = hashCanonical(operation.payload.value);
    if (before !== after) triggers.set(nodeId, "CHANGED");
  }
  return triggers;
}

function impactHashPayload(report) {
  const payload = cloneCanonical(report);
  delete payload.impact_hash;
  return payload;
}

export function validateArtifactImpactReport(report) {
  exactKeys(report, REPORT_KEYS, "Artifact impact report");
  invariant(report.schema_version === IMPACT_SCHEMA, "INVALID_ARTIFACT_IMPACT", `Unsupported impact schema: ${report.schema_version}.`);
  assertSha256(report.registry_hash, "impact.registry_hash");
  assertSha256(report.graph_hash, "impact.graph_hash");
  assertSha256(report.base_state_hash, "impact.base_state_hash");
  assertSha256(report.impact_hash, "impact.impact_hash");
  validateId(report.rules_version, "impact.rules_version");
  invariant(Array.isArray(report.triggers) && report.triggers.length > 0, "INVALID_ARTIFACT_IMPACT", "Impact report requires at least one trigger.");
  invariant(Array.isArray(report.impacts) && report.impacts.length > 0, "INVALID_ARTIFACT_IMPACT", "Impact report requires at least one artifact impact.");
  let previousTrigger = "";
  for (const trigger of report.triggers) {
    exactKeys(trigger, TRIGGER_KEYS, "Impact trigger");
    invariant(/^(?:(?:fact|evidence-class):[a-z][a-z0-9._:-]{0,127}|artifact:[A-Z][A-Z0-9_]{0,127})$/.test(trigger.node_id), "INVALID_ARTIFACT_IMPACT", `Invalid trigger node: ${trigger.node_id}.`);
    invariant(["CHANGED", "LOST"].includes(trigger.change), "INVALID_ARTIFACT_IMPACT", `Invalid trigger change: ${trigger.change}.`);
    invariant(previousTrigger < trigger.node_id, "NON_CANONICAL_ARTIFACT_IMPACT", "Impact triggers must be unique and sorted.");
    previousTrigger = trigger.node_id;
  }
  let previousArtifact = "";
  for (const impact of report.impacts) {
    exactKeys(impact, IMPACT_KEYS, "Artifact impact");
    invariant(ARTIFACT_PATTERN.test(impact.artifact_key), "INVALID_ARTIFACT_IMPACT", `Invalid artifact key: ${impact.artifact_key}.`);
    invariant(["NEEDS_REVIEW", "STALE", "INVALID"].includes(impact.status), "INVALID_ARTIFACT_IMPACT", `Invalid impact status: ${impact.status}.`);
    sortedUniqueStrings(impact.root_causes, "impact.root_causes", /^(?:fact|evidence-class|artifact):[A-Za-z][A-Za-z0-9._:-]{0,127}$/);
    sortedUniqueStrings(impact.rule_ids, "impact.rule_ids");
    invariant(previousArtifact < impact.artifact_key, "NON_CANONICAL_ARTIFACT_IMPACT", "Artifact impacts must be unique and sorted.");
    previousArtifact = impact.artifact_key;
  }
  const observed = hashCanonical(impactHashPayload(report));
  invariant(timingSafeHashEqual(observed, report.impact_hash), "ARTIFACT_IMPACT_HASH_MISMATCH", "Impact report hash does not match canonical content.");
  return report;
}

export function computeArtifactImpactReport({ stateEnvelope, operations, graph, additionalTriggers = [] }) {
  validateDependencyGraph(graph, { requireCoverage: false });
  invariant(Array.isArray(additionalTriggers), "INVALID_ARTIFACT_TRIGGER", "additionalTriggers must be an array.");
  const triggers = triggerMap(stateEnvelope.state, operations, graph, additionalTriggers);
  if (triggers.size === 0) return null;

  const { order, outgoing } = graphTopology(graph);
  const effects = new Map();
  for (const [nodeId, change] of triggers) {
    effects.set(nodeId, {
      signal: change,
      status: "UNAFFECTED",
      roots: new Set([nodeId]),
      rules: new Set(),
    });
  }

  for (const nodeId of order) {
    const upstream = effects.get(nodeId);
    if (!upstream) continue;
    for (const rule of outgoing.get(nodeId) ?? []) {
      const targetId = endpointId(rule.to);
      const candidateStatus = relationImpact(rule, upstream.signal === "CHANGED" || upstream.signal === "LOST" ? upstream.signal : upstream.status);
      const current = effects.get(targetId) ?? {
        signal: candidateStatus,
        status: "UNAFFECTED",
        roots: new Set(),
        rules: new Set(),
      };
      current.status = strongest(current.status, candidateStatus);
      current.signal = current.status;
      for (const root of upstream.roots) current.roots.add(root);
      for (const ruleId of upstream.rules) current.rules.add(ruleId);
      current.rules.add(rule.rule_id);
      effects.set(targetId, current);
    }
  }

  const impacts = [...effects.entries()]
    .filter(([nodeId, effect]) => nodeId.startsWith("artifact:") && effect.status !== "UNAFFECTED")
    .map(([nodeId, effect]) => ({
      artifact_key: nodeId.slice("artifact:".length),
      status: effect.status,
      root_causes: [...effect.roots].sort(),
      rule_ids: [...effect.rules].sort(),
    }))
    .sort((left, right) => left.artifact_key.localeCompare(right.artifact_key));
  if (impacts.length === 0) return null;

  const draft = {
    schema_version: IMPACT_SCHEMA,
    registry_hash: graph.registry_hash,
    graph_hash: graph.graph_hash,
    rules_version: graph.rules_version,
    base_state_hash: stateEnvelope.state_hash,
    triggers: [...triggers.entries()]
      .map(([node_id, change]) => ({ node_id, change }))
      .sort((left, right) => left.node_id.localeCompare(right.node_id)),
    impacts,
  };
  const report = { ...draft, impact_hash: hashCanonical(draft) };
  validateArtifactImpactReport(report);
  return cloneCanonical(report);
}

export function createArtifactImpactOperation({
  stateEnvelope,
  operations,
  graph,
  additionalTriggers = [],
  opId = "apply-artifact-impacts",
}) {
  const report = computeArtifactImpactReport({ stateEnvelope, operations, graph, additionalTriggers });
  if (!report) return null;
  return {
    op_id: opId,
    kind: "APPLY_ARTIFACT_IMPACTS",
    target: "artifact_impacts",
    expected_target_hash: stateEnvelope.state.schema_version === SCHEMA.titleState
      ? hashCanonical({
          invalidations: stateEnvelope.state.invalidations,
          artifact_heads: stateEnvelope.state.artifact_heads,
          artifact_instance_impacts: stateEnvelope.state.artifact_instance_impacts,
        })
      : hashCanonical(stateEnvelope.state.invalidations),
    payload: report,
  };
}

export function mergeImpactStatus(existing, incoming) {
  invariant([undefined, "NEEDS_REVIEW", "STALE", "INVALID"].includes(existing), "INVALID_INVALIDATION_STATUS", `Invalid existing impact status: ${existing}.`);
  invariant(["NEEDS_REVIEW", "STALE", "INVALID"].includes(incoming), "INVALID_INVALIDATION_STATUS", `Invalid incoming impact status: ${incoming}.`);
  return existing === undefined ? incoming : strongest(existing, incoming);
}
