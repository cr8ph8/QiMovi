// read-protected-authors — read-only companion to `scan-protected-author-emulation`.
//
// Returns the protected-authors registry (optionally filtered by category or
// active flag) plus recent emulation flags for a specific entry when
// `entry_id` is supplied. Does NOT perform detection, does NOT write to
// `author_emulation_flags`, and does NOT log governance events. Wrapped by
// `readOnlyHandler` → any accidental write on the injected `read` client
// throws at call-site, and every call emits an evidence tuple bound to
// either the entry context (when provided) or a global governance context.
//
// GET / POST / QUERY body:
//   { entry_id?: string, category?: "paper_seed" | "wga_screenwriter" | "admin_added",
//     include_inactive?: boolean, limit?: number }
// Access: admin only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readOnlyHandler } from "../_shared/queryContract.ts";

const VALID_CATEGORIES = new Set(["paper_seed", "wga_screenwriter", "admin_added"]);

serve(
  readOnlyHandler(
    async ({ body, principalId }) => {
      const b = (body ?? {}) as {
        entry_id?: string;
        category?: string;
        include_inactive?: boolean;
        limit?: number;
      };
      if (!principalId) throw new Error("Unauthorized");

      const url = Deno.env.get("SUPABASE_URL")!;
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, service);

      // Admin gate — this registry is not user-visible.
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: principalId,
        _role: "admin",
      });
      if (!isAdmin) throw new Error("Admin access required");

      const limit = Math.min(500, Math.max(1, Number(b.limit ?? 200)));
      const includeInactive = Boolean(b.include_inactive);
      const category = b.category && VALID_CATEGORIES.has(b.category) ? b.category : null;

      let authorsQuery = admin
        .from("protected_authors")
        .select("id, name, category, active, notes, created_at")
        .order("name", { ascending: true })
        .limit(limit);
      if (!includeInactive) authorsQuery = authorsQuery.eq("active", true);
      if (category) authorsQuery = authorsQuery.eq("category", category);
      const { data: authors, error: authorsErr } = await authorsQuery;
      if (authorsErr) throw authorsErr;

      // Optional per-entry emulation-flag slice, so governance can look at one
      // submission and immediately see everything the scanner flagged for it.
      let flags: unknown[] = [];
      if (b.entry_id) {
        const { data: flagRows, error: flagsErr } = await admin
          .from("author_emulation_flags")
          .select(
            "id, function_name, matched_author, match_kind, admin_reviewed, admin_notes, created_at",
          )
          .eq("entry_id", b.entry_id)
          .order("created_at", { ascending: false })
          .limit(50);
        if (flagsErr) throw flagsErr;
        flags = flagRows ?? [];
      }

      // Grouped counts by category so panel cards can render without an extra
      // roundtrip.
      const counts: Record<string, number> = {};
      for (const a of authors ?? []) {
        counts[a.category] = (counts[a.category] ?? 0) + 1;
      }

      return {
        entry_id: b.entry_id ?? null,
        filter: {
          category,
          include_inactive: includeInactive,
        },
        authors: authors ?? [],
        counts,
        emulation_flags: flags,
      };
    },
    {
      name: "read-protected-authors",
      context: (body) => {
        const b = (body ?? {}) as { entry_id?: string };
        return b.entry_id ? { kind: "entry", id: b.entry_id } : null;
      },
    },
  ),
);
