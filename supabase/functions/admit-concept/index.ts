// admit-concept — OKF admission gate.
// Runs Φ (frontmatter validity) and Ψ (contradiction / status conflict with
// verified siblings) on a proposed concept, then commits it to
// project_artifacts and writes a hash-chained governance_events row.
//
// Body: {
//   project_id: string,
//   concept: {
//     type: string,             // Character | Location | Rule | Timeline | RuntimeFact | ...
//     title: string,
//     status?: "draft" | "prototype" | "verified" | "deprecated",
//     risk?: "low" | "medium" | "critical",
//     tags?: string[],
//     source?: string,          // asset_id | scene_id | url
//     body?: string,            // markdown body
//   }
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logGovernanceAction } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_STATUS = new Set(["draft", "prototype", "verified", "deprecated"]);
const ALLOWED_RISK = new Set(["low", "medium", "critical"]);
const CONCEPT_ADMISSION_ON_HOLD = true;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    if (CONCEPT_ADMISSION_ON_HOLD) {
      return json({
        error: "security_maintenance",
        message: "Concept admission is temporarily paused during a security upgrade.",
      }, 503);
    }

    const body = await req.json().catch(() => ({}));
    const project_id: string | undefined = body?.project_id;
    const concept = body?.concept;

    // ---- Φ: frontmatter validity ----
    // Structured checks so the drilldown can render all rules (pass + fail),
    // each with `inputs`: the exact predicate arguments (field, observed value,
    // observed type, and allowed enum where applicable).
    const typeOf = (v: any) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    const phiChecks = [
      { id: "project_id", label: "project_id present", pass: !!project_id, reason: project_id ? "ok" : "project_id is required",
        inputs: { field: "project_id", predicate: "is truthy string", observed_value: project_id ?? null, observed_type: typeOf(project_id) } },
      { id: "concept_object", label: "concept object present", pass: !!concept && typeof concept === "object", reason: concept ? "ok" : "concept is required",
        inputs: { field: "concept", predicate: "typeof === 'object' && not null", observed_type: typeOf(concept), observed_keys: concept && typeof concept === "object" ? Object.keys(concept) : [] } },
      { id: "concept_type", label: "concept.type required (string)", pass: !!(concept?.type && typeof concept.type === "string"), reason: concept?.type ? "ok" : "concept.type is required",
        inputs: { field: "concept.type", predicate: "non-empty string", observed_value: concept?.type ?? null, observed_type: typeOf(concept?.type) } },
      { id: "concept_title", label: "concept.title required (string)", pass: !!(concept?.title && typeof concept.title === "string"), reason: concept?.title ? "ok" : "concept.title is required",
        inputs: { field: "concept.title", predicate: "non-empty string", observed_value: concept?.title ?? null, observed_type: typeOf(concept?.title) } },
      { id: "status_enum", label: `status ∈ {${[...ALLOWED_STATUS].join(", ")}}`, pass: !concept?.status || ALLOWED_STATUS.has(concept.status), reason: !concept?.status ? "unset (defaults to draft)" : ALLOWED_STATUS.has(concept.status) ? "ok" : `invalid status: ${concept.status}`,
        inputs: { field: "concept.status", predicate: "unset || value ∈ allowed", observed_value: concept?.status ?? null, observed_type: typeOf(concept?.status), allowed: [...ALLOWED_STATUS], default: "draft" } },
      { id: "risk_enum", label: `risk ∈ {${[...ALLOWED_RISK].join(", ")}}`, pass: !concept?.risk || ALLOWED_RISK.has(concept.risk), reason: !concept?.risk ? "unset (defaults to low)" : ALLOWED_RISK.has(concept.risk) ? "ok" : `invalid risk: ${concept.risk}`,
        inputs: { field: "concept.risk", predicate: "unset || value ∈ allowed", observed_value: concept?.risk ?? null, observed_type: typeOf(concept?.risk), allowed: [...ALLOWED_RISK], default: "low" } },
    ];
    const phi: string[] = phiChecks.filter((c) => !c.pass).map((c) => c.reason);
    if (phi.length) {
      // Ledger the Φ rejection so the timeline can render it
      try {
        const adminEarly = createClient(url, service);
        await adminEarly.from("governance_events").insert({
          event_type: "okf_admit",
          event_status: "reject_phi",
          metadata_json: {
            project_id: project_id ?? null,
            concept_type: concept?.type ?? null,
            concept_title: concept?.title ?? null,
            reasons: phi,
            phi_checks: phiChecks,
            proposed: concept ?? null,
            triggered_by: user.id,
            stage: "phi",
            verdict: "reject",
          },
        });
      } catch (_) { /* non-fatal */ }
      await logGovernanceAction({
        userId: user.id,
        action: "okf.admit.reject",
        target: { project_id: project_id ?? null, concept_title: concept?.title ?? null },
        details: { stage: "phi", reasons: phi },
      });
      return json({ verdict: "reject", stage: "phi", reasons: phi, phi_checks: phiChecks }, 200);
    }

    const admin = createClient(url, service);

    // Ownership check
    const { data: proj, error: projErr } = await admin
      .from("projects")
      .select("id, owner_id, title")
      .eq("id", project_id)
      .maybeSingle();
    if (projErr) throw projErr;
    if (!proj) return json({ error: "Project not found" }, 404);
    if (proj.owner_id !== user.id) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
    }

    // ---- Ψ: contradiction check against verified siblings of the same type+title ----
    const { data: siblings } = await admin
      .from("project_artifacts")
      .select("id, payload_json, version")
      .eq("project_id", project_id)
      .eq("artifact_type", "okf_concept")
      .eq("is_current", true);

    const norm = (s: string) => s.trim().toLowerCase();
    const sameSlotSiblings = (siblings ?? []).filter((s: any) => {
      const p = s.payload_json ?? {};
      return p?.concept && norm(p.concept.type ?? "") === norm(concept.type) &&
             norm(p.concept.title ?? "") === norm(concept.title);
    });
    const previousSnapshot = sameSlotSiblings.length
      ? {
          id: sameSlotSiblings[0].id,
          version: sameSlotSiblings[0].version,
          concept: (sameSlotSiblings[0].payload_json as any)?.concept ?? null,
        }
      : null;

    const conflicts: Array<{ id: string; reason: string; sibling_status?: string; sibling_version?: number }> = [];
    for (const s of sameSlotSiblings) {
      const p: any = s.payload_json ?? {};
      // Ψ rules:
      // - Cannot silently downgrade a verified sibling
      // - Cannot revive a deprecated sibling without explicit status=verified
      if (p.concept.status === "verified" && concept.status !== "verified") {
        conflicts.push({ id: s.id, sibling_status: p.concept.status, sibling_version: s.version, reason: "would downgrade a verified sibling" });
      }
      if (p.concept.status === "deprecated" && (concept.status ?? "draft") !== "verified") {
        conflicts.push({ id: s.id, sibling_status: p.concept.status, sibling_version: s.version, reason: "would revive a deprecated sibling as non-verified" });
      }
    }

    if (conflicts.length) {
      const siblingSnapshots = sameSlotSiblings.map((s: any) => ({
        id: s.id,
        version: s.version,
        status: s.payload_json?.concept?.status ?? null,
        risk: s.payload_json?.concept?.risk ?? null,
        tags: Array.isArray(s.payload_json?.concept?.tags) ? s.payload_json.concept.tags : [],
        title: s.payload_json?.concept?.title ?? null,
        type: s.payload_json?.concept?.type ?? null,
      }));
      await admin.from("governance_events").insert({
        event_type: "okf_admit",
        event_status: "reject_psi",
        metadata_json: {
          project_id,
          concept_type: concept.type,
          concept_title: concept.title,
          conflicts,
          phi_checks: phiChecks,
          proposed: concept,
          previous: previousSnapshot,
          sibling_snapshots: siblingSnapshots,
          triggered_by: user.id,
          stage: "psi",
          verdict: "reject",
        },
      });
      await logGovernanceAction({
        userId: user.id,
        action: "okf.admit.reject",
        target: { project_id, concept_title: concept.title, concept_type: concept.type },
        details: { stage: "psi", conflicts },
      });
      return json({ verdict: "reject", stage: "psi", conflicts, phi_checks: phiChecks }, 200);
    }

    // ---- Escalate: critical-risk verified concepts require human review ----
    const requestedStatus = concept.status ?? "draft";
    const shouldEscalate = concept.risk === "critical" && requestedStatus === "verified";
    if (shouldEscalate) {
      await admin.from("governance_events").insert({
        event_type: "okf_admit",
        event_status: "escalate",
        metadata_json: {
          project_id,
          concept_type: concept.type,
          concept_title: concept.title,
          risk: concept.risk,
          status: requestedStatus,
          reason: "critical-risk concept requesting verified status",
          phi_checks: phiChecks,
          proposed: concept,
          previous: previousSnapshot,
          triggered_by: user.id,
          stage: "escalate",
          verdict: "escalate",
        },
      });
      await logGovernanceAction({
        userId: user.id,
        action: "okf.admit.escalate",
        target: { project_id, concept_title: concept.title, concept_type: concept.type },
        details: { risk: concept.risk, status: requestedStatus },
      });
      return json({
        verdict: "escalate",
        stage: "escalate",
        reason: "critical-risk concept requesting verified status requires admin review",
      }, 200);
    }

    // ---- Commit: retire previous version for same slot, insert new ----
    const prevIds = (siblings ?? [])
      .filter((s: any) => {
        const p = s.payload_json ?? {};
        return p?.concept && norm(p.concept.type ?? "") === norm(concept.type) &&
               norm(p.concept.title ?? "") === norm(concept.title);
      })
      .map((s: any) => s.id);

    if (prevIds.length) {
      await admin.from("project_artifacts").update({ is_current: false }).in("id", prevIds);
    }

    const nextVersion = (siblings ?? []).reduce((max: number, s: any) => {
      const p = s.payload_json ?? {};
      const sameSlot = p?.concept && norm(p.concept.type ?? "") === norm(concept.type) &&
                       norm(p.concept.title ?? "") === norm(concept.title);
      return sameSlot ? Math.max(max, s.version ?? 1) : max;
    }, 0) + 1;

    const payload = {
      concept: {
        type: concept.type,
        title: concept.title,
        status: concept.status ?? "draft",
        risk: concept.risk ?? "low",
        tags: Array.isArray(concept.tags) ? concept.tags : [],
        source: concept.source ?? null,
        body: typeof concept.body === "string" ? concept.body : "",
        updated: new Date().toISOString(),
      },
    };

    const { data: inserted, error: insErr } = await admin
      .from("project_artifacts")
      .insert({
        project_id,
        artifact_type: "okf_concept",
        payload_json: payload,
        is_current: true,
        version: nextVersion,
        created_by: user.id,
      })
      .select("id, version, created_at")
      .single();
    if (insErr) throw insErr;

    // Ledger row
    await admin.from("governance_events").insert({
      event_type: "okf_admit",
      event_status: "commit",
      metadata_json: {
        project_id,
        artifact_id: inserted.id,
        concept_type: concept.type,
        concept_title: concept.title,
        status: payload.concept.status,
        risk: payload.concept.risk,
        version: nextVersion,
        phi_checks: phiChecks,
        proposed: payload.concept,
        previous: previousSnapshot,
        triggered_by: user.id,
        stage: "commit",
        verdict: "commit",
      },
    });

    await logGovernanceAction({
      userId: user.id,
      action: "okf.admit.commit",
      target: { project_id, artifact_id: inserted.id },
      details: { concept_type: concept.type, status: payload.concept.status, version: nextVersion },
    });

    return json({
      verdict: "commit",
      artifact_id: inserted.id,
      version: nextVersion,
      status: payload.concept.status,
    }, 200);
  } catch (err) {
    console.error("admit-concept error", err);
    const msg = err instanceof Error ? err.message : "unknown error";
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
