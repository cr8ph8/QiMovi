import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import CollaborationPanel from "@/components/CollaborationPanel";
import ReviewWorkflowPanel from "@/components/ReviewWorkflowPanel";
import UnavailableMode from "./UnavailableMode";

interface Props { entryId: string }

interface EntryRow {
  id: string;
  user_id: string;
  draft_number: number | null;
  sharing_mode: string | null;
}

/**
 * Collaborate mode panel — surfaces collaborators, sharing, and the
 * structured review workflow as a first-class workspace mode.
 */
export default function CollaboratePanel({ entryId }: Props) {
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [sharingMode, setSharingMode] = useState<string>("private");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("entries")
        .select("id, user_id, draft_number, sharing_mode")
        .eq("id", entryId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setDenied(true);
      } else {
        const row = data as EntryRow;
        setEntry(row);
        setSharingMode(row.sharing_mode || "private");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  if (loading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (denied || !entry) {
    return (
      <UnavailableMode
        title="Collaboration unavailable"
        reason="We couldn't load this entry's collaborator settings. You may not have permission to manage them."
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      <CollaborationPanel
        entryId={entry.id}
        entryUserId={entry.user_id}
        sharingMode={sharingMode}
        onSharingModeChange={setSharingMode}
      />
      <ReviewWorkflowPanel
        entryId={entry.id}
        entryUserId={entry.user_id}
        draftNumber={entry.draft_number ?? 1}
      />
    </div>
  );
}
