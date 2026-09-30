// read-governance-events — canonical read of the governance audit trail.
//
// Returns recent `governance_events` rows, optionally filtered by event_type,
// event_status, entry_id, or a time window. Does NOT insert new events, does
// NOT recompute row_hash, does NOT touch the ledger. Wrapped by
// `readOnlyHandler` → any accidental write on the injected `read` client
// throws at call-site, and every call emits an evidence tuple. When
// `entry_id` is supplied the tuple is bound to that entry context so the
// panel can validate the response against the specific submission.
//
// GET / POST / QUERY body:
//   { entry_id?: string,
//     event_type?: string,
//     event_status?: string,
//     since?: ISO8601 string,
//     limit?: number (max 200) }
// Access: admin only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readOnlyHandler } from "../_shared/queryContract.ts";

// Whitelist keeps H(q) meaningful — arbitrary event_type strings from the
// caller are trimmed and length-capped so the query hash can't be poisoned.
function sanitizeShort(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) return null;
  if (!/^[a-z0-9_.:-]+$/i.test(trimmed)) return null;
  return trimmed;
}

serve(
  readOnlyHandler(
    async ({ body, principalId }) => {
      const b = (body ?? {}) as {
        entry_id?: string;
        event_type?: string;
        event_status?: string;
        since?: string;
        limit?: number;
      };
      if (!principalId) throw new Error("Unauthorized");

      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);

      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: principalId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Admin access required");

      const eventType = sanitizeShort(b.event_type);
      const eventStatus = sanitizeShort(b.event_status);
      const limit = Math.min(200, Math.max(1, Number(b.limit ?? 100)));

      let sinceISO: string | null = null;
      if (b.since && typeof b.since === "string") {
        const parsed = new Date(b.since);
        if (!Number.isNaN(parsed.getTime())) sinceISO = parsed.toISOString();
      }

      let q = admin
        .from("governance_events")
        .select(
          "id, entry_id, version_id, event_type, event_status, provider, model_name, routing_reason, privacy_mode, correlation_id, prev_hash, row_hash, metadata_json, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (b.entry_id) q = q.eq("entry_id", b.entry_id);
      if (eventType) q = q.eq("event_type", eventType);
      if (eventStatus) q = q.eq("event_status", eventStatus);
      if (sinceISO) q = q.gte("created_at", sinceISO);

      const { data: events, error } = await q;
      if (error) throw error;

      // Small histogram helps the panel render distribution without a second
      // roundtrip, and is deterministic given the same input row set.
      const byType: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const e of events ?? []) {
        byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
        byStatus[e.event_status] = (byStatus[e.event_status] ?? 0) + 1;
      }

      return {
        entry_id: b.entry_id ?? null,
        filter: {
          event_type: eventType,
          event_status: eventStatus,
          since: sinceISO,
          limit,
        },
        events: events ?? [],
        summary: {
          count: (events ?? []).length,
          by_type: byType,
          by_status: byStatus,
        },
      };
    },
    {
      name: "read-governance-events",
      context: (body) => {
        const b = (body ?? {}) as { entry_id?: string };
        return b.entry_id ? { kind: "entry", id: b.entry_id } : null;
      },
    },
  ),
);
