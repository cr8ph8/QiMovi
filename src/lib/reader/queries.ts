// Reader system — Supabase queries (Phase B).
// Wires reader pages to live `entries` + `artifacts`. Falls back to demo data
// when nothing is found, so the UI stays useful on empty accounts.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEMO_DOCS,
  type ReaderDoc,
  type DocStatus,
  type Confidentiality,
} from "@/lib/reader/types";

export interface ReaderEntry {
  id: string;
  title: string;
  logline: string | null;
  genre: string | null;
  page_count: number | null;
  length_category: string | null;
  visibility: string;
  author: string | null;
  user_id: string;
  status: string;
  ai_fields: Record<string, unknown> | null;
  created_at: string;
}

const ENTRY_COLS =
  "id,title,logline,genre,page_count,length_category,visibility,author,user_id,status,ai_fields,created_at";

/** Entries the current user can read: their own + qi_list/public + collaborator access. */
export function useAccessibleEntries() {
  const [entries, setEntries] = useState<ReaderEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();

      const pubRes = await supabase
        .from("entries")
        .select(ENTRY_COLS)
        .in("visibility", ["qi_list", "public"])
        .order("created_at", { ascending: false })
        .limit(60);

      let ownData: ReaderEntry[] = [];
      let collabIds: string[] = [];
      if (user) {
        const ownRes = await supabase
          .from("entries")
          .select(ENTRY_COLS)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        ownData = (ownRes.data ?? []) as unknown as ReaderEntry[];

        const collabRes = await supabase
          .from("project_collaborators")
          .select("entry_id")
          .eq("user_id", user.id);
        collabIds = (collabRes.data ?? []).map((r) => r.entry_id).filter(Boolean);
      }

      let collabEntries: ReaderEntry[] = [];
      if (collabIds.length) {
        const { data } = await supabase
          .from("entries")
          .select(ENTRY_COLS)
          .in("id", collabIds);
        collabEntries = (data ?? []) as unknown as ReaderEntry[];
      }

      if (cancelled) return;
      const pubData = (pubRes.data ?? []) as unknown as ReaderEntry[];
      const all = [...pubData, ...ownData, ...collabEntries];
      const seen = new Set<string>();
      const deduped = all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
      setEntries(deduped);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return { entries, loading };
}

export function useEntry(entryId: string | undefined) {
  const [entry, setEntry] = useState<ReaderEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entryId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("entries")
        .select(ENTRY_COLS)
        .eq("id", entryId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      setEntry((data ?? null) as unknown as ReaderEntry | null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  return { entry, loading, error };
}

function statusFromArtifact(s: string): DocStatus {
  switch (s) {
    case "ready": return "Approved";
    case "draft": return "Draft";
    case "review": return "Review";
    case "locked": return "Locked";
    case "deprecated": return "Deprecated";
    default: return "Draft";
  }
}

function confidentialityFromVisibility(v?: string): Confidentiality {
  if (v === "public") return "Public";
  if (v === "qi_list" || v === "unlisted") return "Internal";
  return "Confidential";
}

/** Artifacts attached to an entry, mapped into ReaderDoc shape. */
export function useEntryArtifacts(entryId: string | undefined, entryVisibility?: string) {
  const [docs, setDocs] = useState<ReaderDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entryId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("artifacts")
        .select("id, artifact_type, status, artifact_version, artifact_data, created_at")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const mapped: ReaderDoc[] = (data ?? []).map((a) => {
        const ad = (a.artifact_data ?? {}) as Record<string, unknown>;
        const rawTitle =
          (typeof ad.title === "string" && ad.title) ||
          (typeof ad.name === "string" && ad.name) ||
          a.artifact_type.replace(/_/g, " ");
        return {
          id: a.id,
          title: String(rawTitle),
          category: a.artifact_type,
          status: statusFromArtifact(a.status),
          version: a.artifact_version,
          is_canonical: a.status === "locked",
          confidentiality: confidentialityFromVisibility(entryVisibility),
          tags: [a.artifact_type],
          updated_at: a.created_at,
          description:
            typeof ad.summary === "string"
              ? ad.summary
              : typeof ad.description === "string"
              ? ad.description
              : `${a.artifact_type} (v${a.artifact_version})`,
        };
      });
      // Fall back to DEMO_DOCS so the UI doesn't read empty on fresh accounts.
      setDocs(mapped.length ? mapped : DEMO_DOCS);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId, entryVisibility]);

  return { docs, loading };
}
