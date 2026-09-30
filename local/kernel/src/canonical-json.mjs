import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json-core.mjs";

// The exact same bounded serializer serves Node storage and browser contracts.
export { canonicalValue, canonicalJson, cloneCanonical, assertSha256 } from "./canonical-json-core.mjs";

export function hashCanonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function timingSafeHashEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== 64 || right.length !== 64) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}
