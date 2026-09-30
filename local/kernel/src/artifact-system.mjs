import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifactRegistry } from "./artifact-registry.mjs";
import { cloneCanonical } from "./canonical-json.mjs";
import { validateDependencyGraph } from "./dependency-graph.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadCompiledArtifactSystem({
  registryPath = path.join(packageRoot, "registry", "artifact-registry.v1.json"),
  graphPath = path.join(packageRoot, "registry", "dependency-graph.v1.json"),
} = {}) {
  const registry = readJson(registryPath);
  validateArtifactRegistry(registry);
  const dependencyGraph = readJson(graphPath);
  validateDependencyGraph(dependencyGraph, { registry });
  return Object.freeze({
    registry: cloneCanonical(registry),
    dependencyGraph: cloneCanonical(dependencyGraph),
  });
}

