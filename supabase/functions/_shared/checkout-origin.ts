export const PRODUCTION_CHECKOUT_ORIGIN = "https://caniscreenwrite.com";

function normalizeHttpsOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Select a checkout return origin from an exact allowlist. Configured preview
 * origins are a comma-separated list and are normalized before comparison.
 */
export function resolveCheckoutOrigin(
  requestOrigin: string | null,
  configuredOrigins = "",
): string {
  const allowed = new Set<string>([PRODUCTION_CHECKOUT_ORIGIN]);
  for (const candidate of configuredOrigins.split(",")) {
    const normalized = normalizeHttpsOrigin(candidate.trim());
    if (normalized) allowed.add(normalized);
  }

  const normalizedRequest = requestOrigin
    ? normalizeHttpsOrigin(requestOrigin.trim())
    : null;
  return normalizedRequest && allowed.has(normalizedRequest)
    ? normalizedRequest
    : PRODUCTION_CHECKOUT_ORIGIN;
}
