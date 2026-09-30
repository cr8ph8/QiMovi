/**
 * Read-endpoint contract tests.
 *
 * Guarantees under test:
 *   1. Read-only handlers reject insert/update/upsert/delete at call-site.
 *   2. Every successful read response emits `x-query-hash` and
 *      `x-evidence-hash` headers.
 *   3. Disallowed HTTP methods (PUT/PATCH/DELETE) are rejected with 405.
 *   4. Response headers include CORS `Access-Control-Expose-Headers` so
 *      browser callers can actually read the hash headers.
 *
 * These run under `deno test --allow-net --allow-env` and do not touch a
 * real database — the handler is invoked with a stubbed env and the
 * evidence-log write path is fire-and-forget (any error is swallowed).
 *
 * Ops/resources sanitizers are disabled per-test because @supabase/supabase-js
 * spawns a realtime client that opens intervals we can't join from a unit test.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { corsHeaders, makeReadClient, readOnlyHandler } from "./queryContract.ts";

// Wrapper that disables Deno's op/resource leak sanitizers. Supabase's
// realtime client keeps intervals alive for the lifetime of the process,
// which trips the sanitizer in unit tests that never open a socket.
function test(name: string, fn: () => void | Promise<void>) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn,
  });
}

// ── Env stub ──────────────────────────────────────────────────────────────
// The handler needs URL/keys to build supabase clients. We do NOT need them
// to be real — the test handler never issues a query; the evidence-log write
// is fire-and-forget and its failure is caught inside queryContract.ts.
function withStubEnv(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prev = {
      url: Deno.env.get("SUPABASE_URL"),
      anon: Deno.env.get("SUPABASE_ANON_KEY"),
      service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    };
    Deno.env.set("SUPABASE_URL", "http://127.0.0.1:0");
    Deno.env.set("SUPABASE_ANON_KEY", "anon-stub");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-stub");
    try {
      await fn();
    } finally {
      if (prev.url === undefined) Deno.env.delete("SUPABASE_URL");
      else Deno.env.set("SUPABASE_URL", prev.url);
      if (prev.anon === undefined) Deno.env.delete("SUPABASE_ANON_KEY");
      else Deno.env.set("SUPABASE_ANON_KEY", prev.anon);
      if (prev.service === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
      else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prev.service);
    }
  };
}

// ── makeReadClient: write ops are forbidden ──────────────────────────────

test("makeReadClient blocks insert/update/upsert/delete", () => {
  const client = makeReadClient("http://127.0.0.1:0", "anon-stub");
  const table = client.from("any_table");
  for (const op of ["insert", "update", "upsert", "delete"] as const) {
    assertThrows(
      // deno-lint-ignore no-explicit-any
      () => (table as any)[op]({ x: 1 }),
      Error,
      `write op '${op}' is forbidden`,
      `expected ${op}() to throw inside a readOnlyHandler`,
    );
  }
});

test("makeReadClient still exposes read builders (select)", () => {
  const client = makeReadClient("http://127.0.0.1:0", "anon-stub");
  const table = client.from("any_table");
  // deno-lint-ignore no-explicit-any
  assertEquals(typeof (table as any).select, "function");
});

// ── readOnlyHandler: headers on successful response ──────────────────────

test(
  "readOnlyHandler emits x-query-hash and x-evidence-hash on success",
  withStubEnv(async () => {
    const handler = readOnlyHandler(async () => ({ ok: true, items: [1, 2, 3] }), {
      name: "test-endpoint",
      allowAnonymous: true,
    });

    const res = await handler(
      new Request("http://localhost/test-endpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "hello" }),
      }),
    );

    assertEquals(res.status, 200);
    const qh = res.headers.get("x-query-hash");
    const eh = res.headers.get("x-evidence-hash");
    assert(qh, "x-query-hash must be present");
    assert(eh, "x-evidence-hash must be present");
    assertMatch(qh!, /^sha256:[0-9a-f]{64}$/);
    assertMatch(eh!, /^sha256:[0-9a-f]{64}$/);
    assertEquals(res.headers.get("Cache-Control"), "private, no-store");
    assertEquals(res.headers.get("x-committed"), "false");
    // Context binding headers are always emitted, even when no context is bound.
    assertEquals(res.headers.get("x-evidence-context"), "none");
    assert(res.headers.get("x-evidence-canonical-length"));
    await res.text();
  }),
);

test(
  "readOnlyHandler binds x-evidence-context when a context is declared",
  withStubEnv(async () => {
    const entryId = "11111111-2222-3333-4444-555555555555";
    const handler = readOnlyHandler(async () => ({ ok: true }), {
      name: "with-ctx",
      allowAnonymous: true,
      context: (body) => {
        const b = (body ?? {}) as { entry_id?: string };
        return b.entry_id ? { kind: "entry", id: b.entry_id } : null;
      },
    });
    const res = await handler(
      new Request("http://localhost/with-ctx", {
        method: "POST",
        body: JSON.stringify({ entry_id: entryId }),
      }),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("x-evidence-context"), `entry:${entryId}`);
    await res.text();
  }),
);

test(
  "different context ids produce different query hashes",
  withStubEnv(async () => {
    const mk = (id: string) =>
      readOnlyHandler(async () => ({ ok: true }), {
        name: "ctx-hash",
        allowAnonymous: true,
        context: () => ({ kind: "entry", id }),
      });
    const idA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const req = () =>
      new Request("http://localhost/ctx-hash", { method: "POST", body: "{}" });
    const rA = await mk(idA)(req());
    const rB = await mk(idB)(req());
    const qA = rA.headers.get("x-query-hash");
    const qB = rB.headers.get("x-query-hash");
    assert(qA && qB);
    assert(qA !== qB, "context id must be folded into the query hash");
    // Evidence body is identical, so the evidence hash should still match.
    assertEquals(rA.headers.get("x-evidence-hash"), rB.headers.get("x-evidence-hash"));
    await Promise.all([rA.text(), rB.text()]);
  }),
);

test(
  "identical inputs are deterministic across query and evidence hashes",
  withStubEnv(async () => {
    const mk = () =>
      readOnlyHandler(async () => ({ ok: true, items: [1, 2, 3] }), {
        name: "determinism",
        allowAnonymous: true,
        context: () => ({ kind: "entry", id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
      });
    const req = () =>
      new Request("http://localhost/determinism", {
        method: "POST",
        body: JSON.stringify({ foo: "bar" }),
      });
    const r1 = await mk()(req());
    const r2 = await mk()(req());
    assertEquals(r1.headers.get("x-query-hash"), r2.headers.get("x-query-hash"));
    assertEquals(r1.headers.get("x-evidence-hash"), r2.headers.get("x-evidence-hash"));
    await Promise.all([r1.text(), r2.text()]);
  }),
);

test(
  "readOnlyHandler emits hash headers on GET requests too",
  withStubEnv(async () => {
    const handler = readOnlyHandler(async () => ({ ok: true }), {
      name: "test-get",
      allowAnonymous: true,
    });
    const res = await handler(
      new Request("http://localhost/test-get?foo=bar", { method: "GET" }),
    );
    assertEquals(res.status, 200);
    assert(res.headers.get("x-query-hash"));
    assert(res.headers.get("x-evidence-hash"));
    await res.text();
  }),
);

test(
  "evidence hash is deterministic for identical payloads and differs for different ones",
  withStubEnv(async () => {
    const h1 = readOnlyHandler(async () => ({ a: 1, b: 2 }), {
      name: "det",
      allowAnonymous: true,
    });
    const h2 = readOnlyHandler(async () => ({ b: 2, a: 1 }), {
      name: "det",
      allowAnonymous: true,
    });
    const h3 = readOnlyHandler(async () => ({ a: 1, b: 3 }), {
      name: "det",
      allowAnonymous: true,
    });

    const mk = () =>
      new Request("http://localhost/det", {
        method: "POST",
        body: JSON.stringify({}),
      });

    const r1 = await h1(mk());
    const r2 = await h2(mk());
    const r3 = await h3(mk());

    const e1 = r1.headers.get("x-evidence-hash");
    const e2 = r2.headers.get("x-evidence-hash");
    const e3 = r3.headers.get("x-evidence-hash");
    assertEquals(e1, e2, "canonicalization must be key-order independent");
    assert(e1 !== e3, "different payloads must yield different evidence hashes");

    await Promise.all([r1.text(), r2.text(), r3.text()]);
  }),
);

// ── readOnlyHandler: method + auth guards ────────────────────────────────

test(
  "readOnlyHandler rejects write methods (PUT/PATCH/DELETE) with 405",
  withStubEnv(async () => {
    const handler = readOnlyHandler(async () => ({ ok: true }), {
      name: "guard",
      allowAnonymous: true,
    });
    for (const method of ["PUT", "PATCH", "DELETE"] as const) {
      const res = await handler(new Request("http://localhost/guard", { method }));
      assertEquals(res.status, 405, `${method} must be rejected`);
      await res.text();
    }
  }),
);

test(
  "readOnlyHandler requires auth by default",
  withStubEnv(async () => {
    const handler = readOnlyHandler(async () => ({ ok: true }), { name: "authed" });
    const res = await handler(
      new Request("http://localhost/authed", { method: "POST", body: "{}" }),
    );
    assertEquals(res.status, 401);
    await res.text();
  }),
);

test(
  "readOnlyHandler handles OPTIONS preflight with CORS headers",
  withStubEnv(async () => {
    const handler = readOnlyHandler(async () => ({}), {
      name: "preflight",
      allowAnonymous: true,
    });
    const res = await handler(
      new Request("http://localhost/preflight", { method: "OPTIONS" }),
    );
    assert(res.status === 200 || res.status === 204);
    assertEquals(
      res.headers.get("Access-Control-Allow-Origin"),
      corsHeaders["Access-Control-Allow-Origin"],
    );
    await res.text();
  }),
);

// ── CORS: browsers can read the hash headers ─────────────────────────────

test("CORS Expose-Headers advertises hash headers to browsers", () => {
  const expose = corsHeaders["Access-Control-Expose-Headers"];
  assertStringIncludes(expose, "x-query-hash");
  assertStringIncludes(expose, "x-evidence-hash");
});

// ── Handler failures still don't leak writes ─────────────────────────────

test(
  "readOnlyHandler returns 500 (no hash headers) when handler throws",
  withStubEnv(async () => {
    const handler = readOnlyHandler(
      async () => {
        throw new Error("boom");
      },
      { name: "boom", allowAnonymous: true },
    );
    const res = await handler(
      new Request("http://localhost/boom", { method: "POST", body: "{}" }),
    );
    assertEquals(res.status, 500);
    // The error response is a plain json() and intentionally does NOT carry
    // a synthetic evidence hash — evidence must only exist for real reads.
    assertEquals(res.headers.get("x-evidence-hash"), null);
    await res.text();
  }),
);
