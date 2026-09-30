import { KernelError, invariant } from "./errors.mjs";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 32;
const MAX_NODES = 10000;
const MAX_SERIALIZED_BYTES = 1024 * 1024;

function normalize(value, context, depth) {
  invariant(depth <= MAX_DEPTH, "JSON_TOO_DEEP", `Canonical JSON exceeds depth ${MAX_DEPTH}.`);
  context.nodes += 1;
  invariant(context.nodes <= MAX_NODES, "JSON_TOO_LARGE", `Canonical JSON exceeds ${MAX_NODES} nodes.`);

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    invariant(Number.isSafeInteger(value), "NON_CANONICAL_NUMBER", "Numbers must be safe integers; use integer minor units or decimal strings.");
    invariant(!Object.is(value, -0), "NON_CANONICAL_NUMBER", "Negative zero is not permitted.");
    return value;
  }
  if (Array.isArray(value)) {
    const arrayKeys = Reflect.ownKeys(value).filter((key) => key !== "length");
    invariant(
      arrayKeys.length === value.length
        && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean)
        && arrayKeys.every((key) => typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key) && Number(key) < value.length),
      "NON_CANONICAL_ARRAY",
      "Arrays must be dense and may not carry non-index properties.",
    );
    return value.map((item) => normalize(item, context, depth + 1));
  }

  invariant(value && typeof value === "object", "NON_JSON_VALUE", `Unsupported JSON value type: ${typeof value}.`);
  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, "NON_PLAIN_OBJECT", "Only plain JSON objects are permitted.");

  const output = {};
  for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    invariant(!FORBIDDEN_KEYS.has(key), "FORBIDDEN_JSON_KEY", `Forbidden JSON key: ${key}.`);
    output[key] = normalize(value[key], context, depth + 1);
  }
  return output;
}

export function canonicalValue(value) {
  return normalize(value, { nodes: 0 }, 0);
}

export function canonicalJson(value) {
  const serialized = JSON.stringify(canonicalValue(value));
  // UTF-8 uses at least one byte per UTF-16 code unit in JSON text. This
  // cheap bound avoids allocating an encoded buffer for an oversized string.
  invariant(serialized.length <= MAX_SERIALIZED_BYTES && new TextEncoder().encode(serialized).byteLength <= MAX_SERIALIZED_BYTES, "JSON_TOO_LARGE", `Canonical JSON exceeds ${MAX_SERIALIZED_BYTES} bytes.`);
  return serialized;
}

export function cloneCanonical(value) {
  return JSON.parse(canonicalJson(value));
}

export function assertSha256(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new KernelError("INVALID_SHA256", `${field} must be a lowercase 64-character SHA-256.`);
  }
}

