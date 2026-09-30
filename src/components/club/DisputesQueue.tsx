// Admin (chapter creator) queue of pending review disputes.
// Lets the creator approve (restore reward, mark review approved) or
// uphold (keep review rejected) a dispute on cycles in their chapters.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldAlert, Check, X, Loader2 } from "lucide-react";

interface DisputeRow {
  id: string;
  review_id: string;
  user_id: string;
  reason: string;
  status: "open" | "approved" | "upheld" | "withdrawn";
  created_at: string;
  review?: {
    id: string;
    cycle_id: string;
    what_worked: string;
    what_didnt: string;
    one_improvement: string;
    ai_rationale: string | null;
  } | null;
}

export function DisputesQueue() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("review_disputes" as any)
      .select("id, review_id, user_id, reason, status, created_at, review:club_reviews(id, cycle_id, what_worked, what_didnt, one_improvement, ai_rationale)")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data as unknown as DisputeRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const decide = async (d: DisputeRow, decision: "approved" | "upheld") => {
    setBusy(d.id);
    try {
      const patch: any = {
        status: decision,
        resolved_at: new Date().toISOString(),
        resolved_by: user?.id ?? null,
      };
      const { error } = await supabase
        .from("review_disputes" as any)
        .update(patch)
        .eq("id", d.id);
      if (error) throw error;

      if (decision === "approved" && d.review_id) {
        await supabase
          .from("club_reviews" as any)
          .update({ status: "approved" })
          .eq("id", d.review_id);
      }
      toast.success(decision === "approved" ? "Dispute approved" : "Dispute upheld");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not record decision");
    } finally {
      setBusy(null);
    }
  };

  if (!user) return null;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <h3 className="font-display text-lg">Review Disputes</h3>
        </div>
        <Badge variant="secondary" className="text-[10px]">{rows.length} open</Badge>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open disputes.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((d) => (
            <div key={d.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Dispute opened {new Date(d.created_at).toLocaleDateString()}
                </p>
                <Badge variant="outline" className="text-[10px] capitalize">{d.status}</Badge>
              </div>
              <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {d.reason}</p>
              {d.review?.ai_rationale && (
                <p className="text-xs text-muted-foreground italic">
                  AI: {d.review.ai_rationale}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy === d.id}
                  onClick={() => decide(d, "approved")}
                >
                  {busy === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
                  Approve review
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === d.id}
                  onClick={() => decide(d, "upheld")}
                >
                  <X className="h-3 w-3 mr-1" /> Uphold rejection
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
