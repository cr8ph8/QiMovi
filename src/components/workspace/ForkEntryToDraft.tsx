import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitFork, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

interface Props {
  entry: {
    id: string;
    title: string;
    raw: Record<string, unknown>;
  };
  /** Where to land after creating the draft. "write" | "submit". */
  targetMode?: "write" | "submit";
}

/**
 * Submitted entries are immutable historical events. When a writer opens the
 * Write (or Submit) tab on an entry, we offer to fork its `script_text` into
 * a new `screenplay_drafts` row that carries `source_entry_id` for lineage.
 * If a fork already exists for this entry + user, we route to it instead.
 */
export default function ForkEntryToDraft({ entry, targetMode = "write" }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [existingDraftId, setExistingDraftId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("screenplay_drafts")
        .select("id")
        .eq("user_id", user.id)
        .eq("source_entry_id", entry.id)
        .order("last_edited_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setExistingDraftId((data?.id as string) ?? null);
        setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, entry.id]);

  const fork = async () => {
    if (!user) return;
    setForking(true);
    const raw = entry.raw as Record<string, any>;
    const { data, error } = await (supabase as any)
      .from("screenplay_drafts")
      .insert({
        user_id: user.id,
        title: entry.title || raw.title || "Untitled",
        fountain_text: raw.script_text || "",
        format: raw.length_category || null,
        genre: raw.genre || null,
        page_count: raw.page_count ?? null,
        source_entry_id: entry.id,
      })
      .select("id")
      .single();
    setForking(false);
    if (error || !data?.id) {
      toast.error(error?.message || "Could not create draft");
      return;
    }
    toast.success("Continuation draft created");
    navigate(`/entry/${data.id}#${targetMode}`, { replace: true });
  };

  // If a fork already exists, jump there.
  useEffect(() => {
    if (existingDraftId) {
      navigate(`/entry/${existingDraftId}#${targetMode}`, { replace: true });
    }
  }, [existingDraftId, targetMode, navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-lg text-center space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 border border-primary/30">
          <GitFork className="h-6 w-6 text-primary" />
        </div>
        <h3 className="font-playfair text-2xl font-bold">
          {targetMode === "submit" ? "Resubmit as new draft" : "Continue editing as new draft"}
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The original submission is a recorded moment in this screenplay's history — its scores,
          evidence bundle, and audit trail stay intact. To keep working on the script we fork it
          into a new draft linked back to this entry. Past Insights, present edits, and future
          submissions all stay connected.
        </p>
        <Button onClick={fork} disabled={forking || checking || !user} size="lg" className="gap-2">
          {forking || checking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {targetMode === "submit" ? "Fork & open Submit" : "Fork & open Editor"}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
