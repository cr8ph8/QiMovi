// read-evidence-bundle — read-only companion to `export-evidence-bundle`.
//
// Returns the last persisted TPAS evidence bundle for an entry, plus a fresh
// summary of governance/version counts. Never persists, never mutates hashes.
// Wrapped by readOnlyHandler → any accidental write attempt on the injected
// `read` client throws; every call emits an evidence tuple to
// `query_evidence_log`.
//
// GET / POST / QUERY body: { entry_id: string }
// Access: admin only, Pro+ plan.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readOnlyHandler } from "../_shared/queryContract.ts";

serve(
  readOnlyHandler(
    async ({ body, principalId }) => {
      const b = (body ?? {}) as { entry_id?: string };
      const entry_id = b.entry_id;
      if (!entry_id) throw new Error("entry_id required");
      if (!principalId) throw new Error("Unauthorized");

      // Admin plan/role check needs to bypass RLS; use a raw service client
      // *only for these two lookups*. All governed data comes through `read`
      // via the readOnlyHandler-injected client if we needed RLS; here we
      // deliberately want admin-visible bundle data, so use admin service.
      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);

      const { data: planResult } = await admin.rpc("get_user_plan", {
        p_user_id: principalId,
      });
      if ((planResult ?? "free") === "free") {
        throw new Error("This feature requires the Pro plan");
      }
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: principalId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Admin access required");

      const { data: entry, error: entryErr } = await admin
        .from("entries")
        .select("id, title, sensitivity, evidence_bundle_hash, parsed_metadata, created_at")
        .eq("id", entry_id)
        .maybeSingle();
      if (entryErr || !entry) throw new Error("Entry not found");

      const [{ count: versions_count }, { count: events_count }, { count: nodes_count }] =
        await Promise.all([
          admin.from("screenplay_versions").select("id", { count: "exact", head: true }).eq("entry_id", entry_id),
          admin.from("governance_events").select("id", { count: "exact", head: true }).eq("entry_id", entry_id),
          admin.from("provenance_nodes").select("id", { count: "exact", head: true }).eq("entry_id", entry_id),
        ]);

      const parsed = (entry.parsed_metadata ?? {}) as Record<string, unknown>;
      const bundle = (parsed.tpas_evidence_bundle ?? null) as Record<string, unknown> | null;

      return {
        entry_id,
        title: entry.title,
        sensitivity: entry.sensitivity,
        evidence_bundle_hash: entry.evidence_bundle_hash ?? null,
        bundle,
        summary: {
          versions: versions_count ?? 0,
          governance_events: events_count ?? 0,
          provenance_nodes: nodes_count ?? 0,
          bundle_present: Boolean(bundle),
        },
      };
    },
    {
      name: "read-evidence-bundle",
      context: (body) => {
        const b = (body ?? {}) as { entry_id?: string };
        return b.entry_id ? { kind: "entry", id: b.entry_id } : null;
      },
    },
  ),
);
