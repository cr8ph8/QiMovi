import {
  PRODUCTION_CHECKOUT_ORIGIN,
  resolveCheckoutOrigin,
} from "./checkout-origin.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("checkout origin accepts production and configured preview origins", () => {
  assertEquals(
    resolveCheckoutOrigin(PRODUCTION_CHECKOUT_ORIGIN),
    PRODUCTION_CHECKOUT_ORIGIN,
  );
  assertEquals(
    resolveCheckoutOrigin(
      "https://preview.example.test/some/path",
      "https://preview.example.test",
    ),
    "https://preview.example.test",
  );
});

Deno.test("checkout origin rejects lookalikes, non-HTTPS schemes, and malformed input", () => {
  for (const origin of [
    "https://caniscreenwrite.com.attacker.test",
    "http://preview.example.test",
    "javascript:alert(1)",
    "not a url",
    null,
  ]) {
    assertEquals(
      resolveCheckoutOrigin(origin),
      PRODUCTION_CHECKOUT_ORIGIN,
    );
  }
});
