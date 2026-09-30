import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { parseFountain } from "@/lib/fountain-parser";
import PitchPackageBuilder from "@/components/PitchPackageBuilder";
import UnavailableMode from "./UnavailableMode";

interface Props { entryId: string }

interface EntryRow {
  id: string;
  user_id: string;
  title: string;
  logline: string | null;
  script_text: string | null;
}

/**
 * Pitch mode panel — lifts the structured Pitch Package Builder out of
 * the legacy EntryDetail collapsible into a first-class workspace surface.
 */
export default function PitchPanel({ entryId }: Props) {
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("entries")
        .select("id, user_id, title, logline, script_text")
        .eq("id", entryId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setDenied(true);
      } else {
        setEntry(data as EntryRow);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  const parsed = useMemo(() => parseFountain(entry?.script_text || ""), [entry?.script_text]);

  if (loading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (denied || !entry) {
    return (
      <UnavailableMode
        title="Pitch package unavailable"
        reason="We couldn't load this entry. You may not have permission to view its pitch materials."
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PitchPackageBuilder
        entryId={entry.id}
        entryUserId={entry.user_id}
        title={entry.title}
        logline={entry.logline}
        parsed={parsed}
      />
    </div>
  );
}
