// publication-gate — Hampton PLC-style claim/evidence/gate for admin
// publication surfaces (news_articles, changelog_releases, landing_page_config).
//
// Actions (POST body { action, ... }):
//   - extract  : materialize claims for a record's current version
//   - decide   : record a per-claim admission decision + evidence
//   - evaluate : is the record admissible? returns blockers
//   - admit    : re-check evaluate, then flip the actual publish flag inside
//                a single ledger append (governance_events)
//   - rollback : unpublish + record reason
//   - export_bundle : return signed JSON of claims + decisions + governance
//                     events for a record version (admin evidence export)
//
// All state changes require admin role. Evidence and admission events append
// to `governance_events` — no parallel provenance store.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canonicalize,
  corsHeaders,
  sha256Hex,
} from "../_shared/queryContract.ts";
import {
  extractClaims,
  gatedFieldsPayload,
  type PublicationSurface,
} from "../_shared/claimExtraction.ts";

type Decision = "PENDING" | "COMMIT" | "DAMP" | "REJECT" | "ESCALATE" | "WAIVED";
const READY_DECISIONS: Decision[] = ["COMMIT", "DAMP", "WAIVED"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadRecord(
  admin: SupabaseClient,
  surface: PublicationSurface,
  record_id: string,
): Promise<Record<string, unknown> | null> {
  const table =
    surface === "news_article"
      ? "news_articles"
      : surface === "changelog_release"
        ? "changelog_releases"
        : "landing_page_config";
  const { data, error } = await admin.from(table).select("*").eq("id", record_id).maybeSingle();
  if (error) throw new Error(`load ${surface} failed: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function currentVersion(
  admin: SupabaseClient,
  surface: PublicationSurface,
  record_id: string,
  record: Record<string, unknown>,
): Promise<{ version: number; contentHash: string }> {
  const contentHash = await sha256Hex(canonicalize(gatedFieldsPayload(surface, record)));

  // Look up the most recent claim row's version hint stored in the log via
  // its associated content hash (kept in evidence_note on the sentinel row we
  // maintain per version). If not found, start at 1.
  const { data } = await admin
    .from("publication_claims")
    .select("record_version, evidence_note")
    .eq("surface", surface)
    .eq("record_id", record_id)
    .order("record_version", { ascending: false })
    .limit(1);
  if (data && data.length > 0) {
    const latest = data[0] as { record_version: number; evidence_note: string | null };
    // If content hash matches the sentinel note, reuse version; otherwise bump.
    const sentinelMatch = (latest.evidence_note ?? "").includes(`content:${contentHash}`);
    return {
      version: sentinelMatch ? latest.record_version : latest.record_version + 1,
      contentHash,
    };
  }
  return { version: 1, contentHash };
}

async function ensureAdmin(
  admin: SupabaseClient,
  authHeader: string | null,
): Promise<string> {
  if (!authHeader) throw new Response("Unauthorized", { status: 401 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await userClient.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) throw new Response("Unauthorized", { status: 401 });
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", uid)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) throw new Response("Forbidden", { status: 403 });
  return uid;
}

async function writeLedger(
  admin: SupabaseClient,
  event_type: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from("governance_events").insert({
    event_type,
    event_status: "recorded",
    metadata_json: metadata,
  });
  if (error) console.error(`[publication-gate] ledger write failed:`, error.message);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "Server misconfigured" }, 500);
  const admin = createClient(url, service);

  let uid: string;
  try {
    uid = await ensureAdmin(admin, req.headers.get("Authorization"));
  } catch (r) {
    if (r instanceof Response) return json({ error: r.statusText }, r.status);
    return json({ error: "Auth failure" }, 401);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = String(body?.action ?? "");
  const surface = body?.surface as PublicationSurface | undefined;

  try {
    if (action === "extract") {
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const record = await loadRecord(admin, surface, body.record_id);
      if (!record) return json({ error: "Record not found" }, 404);
      const { version, contentHash } = await currentVersion(admin, surface, body.record_id, record);
      const claims = extractClaims(surface, record);

      // Insert new claims for this version. Unique (surface, record_id, version, claim_text)
      // guarantees idempotency.
      const rows = claims.map((c) => ({
        surface,
        record_id: body.record_id,
        record_version: version,
        claim_text: c.claim_text,
        claim_kind: c.claim_kind,
        decision: "PENDING",
      }));
      if (rows.length > 0) {
        await admin.from("publication_claims").upsert(rows, {
          onConflict: "surface,record_id,record_version,claim_text",
          ignoreDuplicates: true,
        });
      }
      // Maintain a sentinel note recording the content hash on any one row so
      // we can detect content-identical re-extractions without bumping version.
      const { data: any1 } = await admin
        .from("publication_claims")
        .select("id")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .eq("record_version", version)
        .limit(1);
      if (any1 && any1[0]) {
        await admin
          .from("publication_claims")
          .update({ evidence_note: `content:${contentHash}` })
          .eq("id", (any1[0] as { id: string }).id)
          .is("evidence_note", null);
      }

      const { data: allClaims } = await admin
        .from("publication_claims")
        .select("*")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .eq("record_version", version)
        .order("created_at", { ascending: true });
      return json({ version, contentHash, claims: allClaims ?? [] });
    }

    if (action === "decide") {
      const { claim_id, decision, evidence_url, evidence_note } = body as {
        claim_id?: string; decision?: Decision; evidence_url?: string; evidence_note?: string;
      };
      if (!claim_id || !decision) return json({ error: "claim_id + decision required" }, 400);
      if (decision === "COMMIT" && !evidence_url) {
        return json({ error: "COMMIT requires evidence_url" }, 400);
      }
      const { data: updated, error } = await admin
        .from("publication_claims")
        .update({
          decision,
          evidence_url: evidence_url ?? null,
          evidence_note: evidence_note ?? null,
          decided_by: uid,
          decided_at: new Date().toISOString(),
        })
        .eq("id", claim_id)
        .select("*")
        .maybeSingle();
      if (error || !updated) return json({ error: error?.message ?? "Not found" }, 404);
      await writeLedger(admin, "publication_claim_decision", {
        claim_id,
        surface: updated.surface,
        record_id: updated.record_id,
        record_version: updated.record_version,
        claim_kind: updated.claim_kind,
        decision,
        evidence_hash: await sha256Hex(
          canonicalize({ claim_text: updated.claim_text, evidence_url: evidence_url ?? null }),
        ),
        decided_by: uid,
      });
      return json({ claim: updated });
    }

    if (action === "evaluate" || action === "admit") {
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const record = await loadRecord(admin, surface, body.record_id);
      if (!record) return json({ error: "Record not found" }, 404);
      const { version, contentHash } = await currentVersion(admin, surface, body.record_id, record);

      const { data: claimsData } = await admin
        .from("publication_claims")
        .select("*")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .eq("record_version", version);
      const claims = (claimsData ?? []) as Array<{
        id: string; claim_text: string; claim_kind: string; decision: Decision; evidence_url: string | null;
      }>;
      const blockers = claims.filter((c) => !READY_DECISIONS.includes(c.decision));

      if (action === "evaluate") {
        return json({ version, contentHash, ready: blockers.length === 0, blockers, claims });
      }

      if (blockers.length > 0) {
        return json({ error: "Not admissible", ready: false, blockers }, 409);
      }
      if (claims.length === 0) {
        return json({ error: "Extract claims before admitting", ready: false }, 409);
      }

      // Flip the publish flag per surface.
      const now = new Date().toISOString();
      if (surface === "news_article") {
        await admin
          .from("news_articles")
          .update({ status: "published", published_at: now, updated_at: now })
          .eq("id", body.record_id);
      } else if (surface === "changelog_release") {
        await admin
          .from("changelog_releases")
          .update({ is_published: true, updated_at: now })
          .eq("id", body.record_id);
      } else if (surface === "landing_page") {
        // Landing page has no publish flag: touching updated_at is the
        // admission signal for this surface.
        await admin
          .from("landing_page_config")
          .update({ updated_at: now })
          .eq("id", body.record_id);
      }

      const evidenceHash = await sha256Hex(
        canonicalize({
          surface,
          record_id: body.record_id,
          record_version: version,
          content_hash: contentHash,
          claims: [...claims]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((c) => ({
              id: c.id,
              claim_text: c.claim_text,
              claim_kind: c.claim_kind,
              decision: c.decision,
              evidence_url: c.evidence_url,
            })),
        }),
      );
      await writeLedger(admin, "publication_admitted", {
        surface,
        record_id: body.record_id,
        record_version: version,
        content_hash: contentHash,
        evidence_hash: evidenceHash,
        admitted_by: uid,
        claim_count: claims.length,
      });
      return json({ ready: true, admitted: true, version, evidence_hash: evidenceHash });
    }

    if (action === "rollback") {
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const reason = String(body?.reason ?? "").slice(0, 500);
      const now = new Date().toISOString();
      if (surface === "news_article") {
        await admin.from("news_articles").update({ status: "draft", updated_at: now }).eq("id", body.record_id);
      } else if (surface === "changelog_release") {
        await admin.from("changelog_releases").update({ is_published: false, updated_at: now }).eq("id", body.record_id);
      }
      await writeLedger(admin, "publication_rolled_back", {
        surface,
        record_id: body.record_id,
        reason,
        rolled_back_by: uid,
      });
      return json({ ok: true });
    }

    if (action === "versions") {
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const { data } = await admin
        .from("publication_claims")
        .select("record_version, claim_kind, decision, evidence_note, decided_at, created_at")
        .eq("surface", surface)
        .eq("record_id", body.record_id);
      const byVersion = new Map<number, {
        version: number;
        claim_count: number;
        content_hash: string | null;
        decided_count: number;
        last_activity_at: string | null;
      }>();
      for (const r of (data ?? []) as Array<{
        record_version: number;
        decision: Decision;
        evidence_note: string | null;
        decided_at: string | null;
        created_at: string;
      }>) {
        const v = r.record_version;
        const bucket = byVersion.get(v) ?? {
          version: v, claim_count: 0, content_hash: null, decided_count: 0, last_activity_at: null,
        };
        bucket.claim_count += 1;
        if (READY_DECISIONS.includes(r.decision) || r.decision === "REJECT" || r.decision === "ESCALATE") {
          bucket.decided_count += 1;
        }
        const sentinelMatch = (r.evidence_note ?? "").match(/content:([a-f0-9]{64})/);
        if (sentinelMatch && !bucket.content_hash) bucket.content_hash = sentinelMatch[1];
        const ts = r.decided_at ?? r.created_at;
        if (!bucket.last_activity_at || ts > bucket.last_activity_at) bucket.last_activity_at = ts;
        byVersion.set(v, bucket);
      }
      const versions = Array.from(byVersion.values()).sort((a, b) => b.version - a.version);

      // Layer in "approved" state from governance_events (publication_admitted).
      // A version counts as approved when an admit event was recorded for it.
      const { data: admitEvents } = await admin
        .from("governance_events")
        .select("metadata, created_at")
        .eq("event_type", "publication_admitted")
        .contains("metadata", { surface, record_id: body.record_id })
        .order("created_at", { ascending: false })
        .limit(200);
      const admittedByVersion = new Map<number, string>();
      for (const ev of (admitEvents ?? []) as Array<{ metadata: any; created_at: string }>) {
        const v = Number(ev.metadata?.record_version);
        if (Number.isFinite(v) && !admittedByVersion.has(v)) {
          admittedByVersion.set(v, ev.created_at);
        }
      }
      const enriched = versions.map((v) => ({
        ...v,
        admitted: admittedByVersion.has(v.version),
        admitted_at: admittedByVersion.get(v.version) ?? null,
      }));
      const latestAdmittedVersion =
        enriched.filter((v) => v.admitted).map((v) => v.version).sort((a, b) => b - a)[0] ?? null;
      return json({ versions: enriched, latest_admitted_version: latestAdmittedVersion });
    }

    if (action === "diff") {
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const from = Number(body?.from_version);
      const to = Number(body?.to_version);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        return json({ error: "from_version + to_version required" }, 400);
      }
      const { data } = await admin
        .from("publication_claims")
        .select("*")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .in("record_version", [from, to])
        .order("created_at", { ascending: true });
      const rows = (data ?? []) as Array<{
        id: string; record_version: number; claim_text: string; claim_kind: string;
        decision: Decision; evidence_url: string | null; evidence_note: string | null;
      }>;
      const fromRows = rows.filter((r) => r.record_version === from);
      const toRows = rows.filter((r) => r.record_version === to);
      const fromByText = new Map(fromRows.map((r) => [r.claim_text, r]));
      const toByText = new Map(toRows.map((r) => [r.claim_text, r]));

      const added = toRows.filter((r) => !fromByText.has(r.claim_text));
      const removed = fromRows.filter((r) => !toByText.has(r.claim_text));
      const changed: Array<{ from: typeof rows[number]; to: typeof rows[number] }> = [];
      const unchanged: typeof rows = [];
      for (const t of toRows) {
        const f = fromByText.get(t.claim_text);
        if (!f) continue;
        if (
          f.claim_kind !== t.claim_kind ||
          f.decision !== t.decision ||
          (f.evidence_url ?? "") !== (t.evidence_url ?? "") ||
          (f.evidence_note ?? "") !== (t.evidence_note ?? "")
        ) {
          changed.push({ from: f, to: t });
        } else {
          unchanged.push(t);
        }
      }
      return json({
        from_version: from,
        to_version: to,
        counts: {
          added: added.length,
          removed: removed.length,
          changed: changed.length,
          unchanged: unchanged.length,
        },
        added, removed, changed, unchanged,
      });
    }

    if (action === "export_bundle") {
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const record = await loadRecord(admin, surface, body.record_id);
      if (!record) return json({ error: "Record not found" }, 404);
      const requestedVersion = Number(body?.record_version);
      const { version: currentVer, contentHash } = await currentVersion(
        admin, surface, body.record_id, record,
      );
      const version = Number.isFinite(requestedVersion) && requestedVersion > 0
        ? requestedVersion
        : currentVer;

      const { data: claimRows } = await admin
        .from("publication_claims")
        .select("*")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .eq("record_version", version)
        .order("created_at", { ascending: true });

      // Governance events tied to this surface+record — filter client-side by
      // metadata_json.record_id/surface since it's stored as JSONB.
      const { data: allEvents } = await admin
        .from("governance_events")
        .select("*")
        .in("event_type", [
          "publication_claim_decision",
          "publication_admitted",
          "publication_rolled_back",
        ])
        .order("created_at", { ascending: true })
        .limit(1000);
      const events = ((allEvents ?? []) as Array<{
        id: string; event_type: string; created_at: string;
        metadata_json: Record<string, unknown> | null;
      }>).filter((e) => {
        const m = e.metadata_json ?? {};
        return (m as any).surface === surface && (m as any).record_id === body.record_id;
      });

      const claims = (claimRows ?? []) as Array<Record<string, unknown>>;
      const bundle = {
        schema: "publication_evidence_bundle_v1",
        generated_at: new Date().toISOString(),
        generated_by: uid,
        surface,
        record_id: body.record_id,
        record_version: version,
        is_current_version: version === currentVer,
        content_hash: contentHash,
        record_snapshot: gatedFieldsPayload(surface, record),
        claim_count: claims.length,
        decision_summary: claims.reduce((acc: Record<string, number>, c: any) => {
          const d = String(c.decision ?? "PENDING");
          acc[d] = (acc[d] ?? 0) + 1;
          return acc;
        }, {}),
        claims: claims.map((c: any) => ({
          id: c.id,
          claim_text: c.claim_text,
          claim_kind: c.claim_kind,
          decision: c.decision,
          evidence_url: c.evidence_url,
          evidence_note: c.evidence_note,
          decided_by: c.decided_by,
          decided_at: c.decided_at,
          created_at: c.created_at,
        })),
        governance_events: events.map((e) => ({
          id: e.id,
          event_type: e.event_type,
          created_at: e.created_at,
          metadata: e.metadata_json,
        })),
      };
      const bundleHash = await sha256Hex(canonicalize({
        ...bundle,
        // Exclude non-deterministic fields from the integrity hash.
        generated_at: null,
        generated_by: null,
      }));
      return json({ ...bundle, bundle_hash: bundleHash });
    }

    if (action === "restore_version") {
      // Guarded rollback: clone claim rows from `from_version` into a NEW
      // version (max+1) so the record's admission gate re-evaluates against
      // the historical claim set. Preserves text/kind/decision/evidence so
      // operators see the restored state; sentinel note records lineage.
      if (!surface || !body?.record_id) return json({ error: "surface + record_id required" }, 400);
      const fromVersion = Number(body?.from_version);
      const reason = String(body?.reason ?? "").trim();
      const REASON_CODES = [
        "DAMP_UNSUPPORTED",
        "REJECT_FABRICATED",
        "REJECT_POLICY",
        "REJECT_LEGAL",
        "REVERT_ACCIDENTAL_COMMIT",
        "OTHER",
      ] as const;
      const reasonCode = String(body?.reason_code ?? "").trim().toUpperCase();
      const reasonNotes = String(body?.reason_notes ?? "").trim().slice(0, 2000);
      if (!Number.isFinite(fromVersion) || fromVersion <= 0) {
        return json({ error: "from_version required" }, 400);
      }
      if (!REASON_CODES.includes(reasonCode as typeof REASON_CODES[number])) {
        return json({ error: `reason_code must be one of ${REASON_CODES.join(", ")}` }, 400);
      }
      if (reasonCode === "OTHER" && reasonNotes.length < 4) {
        return json({ error: "reason_notes (min 4 chars) required when reason_code is OTHER" }, 400);
      }
      if (reason.length < 4) {
        return json({ error: "reason (min 4 chars) required" }, 400);
      }
      const record = await loadRecord(admin, surface, body.record_id);
      if (!record) return json({ error: "Record not found" }, 404);

      const contentHash = await sha256Hex(canonicalize(gatedFieldsPayload(surface, record)));

      const { data: sourceRows, error: srcErr } = await admin
        .from("publication_claims")
        .select("*")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .eq("record_version", fromVersion);
      if (srcErr) return json({ error: srcErr.message }, 500);
      const source = (sourceRows ?? []) as Array<{
        claim_text: string; claim_kind: string; decision: Decision;
        evidence_url: string | null; evidence_note: string | null;
      }>;
      if (source.length === 0) {
        return json({ error: `No claims found for v${fromVersion}` }, 404);
      }

      const { data: maxRow } = await admin
        .from("publication_claims")
        .select("record_version")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .order("record_version", { ascending: false })
        .limit(1);
      const maxVersion = (maxRow?.[0] as { record_version: number } | undefined)?.record_version ?? 0;
      if (fromVersion >= maxVersion) {
        return json({ error: "from_version must be older than the latest version" }, 409);
      }

      // Guardrail: refuse to roll back past an already-approved (admitted)
      // version. If a newer approved version exists, the operator must first
      // un-admit / roll back that version through the normal `rollback` action.
      const { data: admitEvents } = await admin
        .from("governance_events")
        .select("metadata, created_at")
        .eq("event_type", "publication_admitted")
        .contains("metadata", { surface, record_id: body.record_id })
        .order("created_at", { ascending: false })
        .limit(200);
      const admittedVersions = new Map<number, string>();
      for (const ev of (admitEvents ?? []) as Array<{ metadata: any; created_at: string }>) {
        const v = Number(ev.metadata?.record_version);
        if (Number.isFinite(v) && !admittedVersions.has(v)) {
          admittedVersions.set(v, ev.created_at);
        }
      }
      const newerApproved = [...admittedVersions.entries()]
        .filter(([v]) => v > fromVersion)
        .sort((a, b) => b[0] - a[0])[0];
      if (newerApproved) {
        return json({
          error: "blocked_by_approved_version",
          message: `Cannot restore v${fromVersion}: v${newerApproved[0]} was already approved on ${newerApproved[1]}. Roll back v${newerApproved[0]} first.`,
          latest_admitted_version: newerApproved[0],
          latest_admitted_at: newerApproved[1],
        }, 409);
      }
      const newVersion = maxVersion + 1;
      const nowIso = new Date().toISOString();

      const sentinel = `content:${contentHash} restored_from:v${fromVersion}`;
      const cloned = source.map((r, idx) => ({
        surface,
        record_id: body.record_id,
        record_version: newVersion,
        claim_text: r.claim_text,
        claim_kind: r.claim_kind,
        decision: r.decision,
        evidence_url: r.evidence_url,
        evidence_note: idx === 0
          ? sentinel
          : (r.evidence_note && !r.evidence_note.startsWith("content:") ? r.evidence_note : null),
        decided_by: uid,
        decided_at: nowIso,
      }));
      const { error: insErr } = await admin.from("publication_claims").insert(cloned);
      if (insErr) return json({ error: insErr.message }, 500);

      await writeLedger(admin, "publication_claims_restored", {
        surface,
        record_id: body.record_id,
        from_version: fromVersion,
        new_version: newVersion,
        content_hash: contentHash,
        claim_count: cloned.length,
        reason,
        reason_code: reasonCode,
        reason_notes: reasonNotes || null,
        restored_by: uid,
      });

      const { data: newRows } = await admin
        .from("publication_claims")
        .select("*")
        .eq("surface", surface)
        .eq("record_id", body.record_id)
        .eq("record_version", newVersion)
        .order("created_at", { ascending: true });

      return json({
        ok: true,
        from_version: fromVersion,
        new_version: newVersion,
        content_hash: contentHash,
        claims: newRows ?? [],
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[publication-gate] error:", msg);
    return json({ error: msg }, 500);
  }
});
