// Browser counterpart of local/kernel/src/canonical-json.mjs. Hashes bind bytes,
// not creative approval; parity is checked against the kernel in api.test.ts.
export function canonicalJson(value: unknown): string {
  let nodes = 0;
  function normalize(item: unknown, depth: number): unknown {
    if (depth > 32 || ++nodes > 10000) throw new Error('The workspace record exceeds canonical JSON limits.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new Error('The workspace record contains a non-canonical number.');
      return item;
    }
    if (Array.isArray(item)) {
      const keys = Reflect.ownKeys(item).filter(key => key !== 'length');
      if (keys.length !== item.length || !Array.from({ length: item.length }, (_, index) => Object.prototype.hasOwnProperty.call(item, index)).every(Boolean) || !keys.every(key => typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < item.length)) throw new Error('The workspace record contains a non-canonical array.');
      return item.map(child => normalize(child, depth + 1));
    }
    if (!item || typeof item !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('The workspace record contains a non-JSON value.');
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('The workspace record contains a forbidden JSON key.');
      output[key] = normalize((item as Record<string, unknown>)[key], depth + 1);
    }
    return output;
  }
  const serialized = JSON.stringify(normalize(value, 0));
  if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024) throw new Error('The workspace record exceeds canonical JSON limits.');
  return serialized;
}

export async function hashCanonical(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
