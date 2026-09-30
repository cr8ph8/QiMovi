import { useEffect, useState } from "react";
import { Loader2, ScrollText, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AuditEntry = {
  id: string;
  comment_id: string | null;
  report_id: string | null;
  action: string;
  actor_user_id: string | null;
  actor_label: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const ACTION_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "destructive" | "outline" }> = {
  comment_posted: { label: "Comment posted", tone: "secondary" },
  comment_hidden: { label: "Hidden by owner", tone: "outline" },
  comment_unhidden: { label: "Unhidden", tone: "secondary" },
  comment_deleted: { label: "Deleted", tone: "destructive" },
  comment_reported: { label: "Reported", tone: "destructive" },
  report_reviewed: { label: "Report reviewed", tone: "default" },
  report_dismissed: { label: "Report dismissed", tone: "secondary" },
  comment_auto_hidden: { label: "Auto-hidden (3+ reports)", tone: "destructive" },
};

export function BriefCommentAuditLog({ briefId }: { briefId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("brief_comment_audit")
        .select("id, comment_id, report_id, action, actor_user_id, actor_label, details, created_at")
        .eq("brief_id", briefId)
        .order("created_at", { ascending: false })
        .limit(100);
      setEntries((data ?? []) as AuditEntry[]);
      setLoading(false);
    })();
  }, [open, briefId]);

  return (
    <Card>
      <CardHeader>
        <button
          className="flex w-full items-center justify-between"
          onClick={() => setOpen((o) => !o)}
        >
          <CardTitle className="font-display text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            Moderation audit log
          </CardTitle>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No moderation activity yet.</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {entries.map((e) => {
                const meta = ACTION_LABELS[e.action] ?? { label: e.action, tone: "outline" as const };
                const reason = (e.details as { reason?: string })?.reason;
                const preview = (e.details as { body_preview?: string })?.body_preview;
                const author = (e.details as { author_name?: string })?.author_name ?? e.actor_label;
                return (
                  <li
                    key={e.id}
                    className="rounded-md border p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                      <span className="text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-foreground/80">
                      <span className="font-medium">Actor: </span>
                      {e.actor_user_id ? (
                        <code className="text-[10px]">{e.actor_user_id.slice(0, 8)}…</code>
                      ) : (
                        <span className="text-muted-foreground italic">anonymous viewer</span>
                      )}
                      {author && e.action === "comment_posted" && (
                        <> · as <span className="italic">{author}</span></>
                      )}
                    </div>
                    {reason && (
                      <div className="text-muted-foreground">Reason: {reason}</div>
                    )}
                    {preview && (
                      <div className="text-muted-foreground line-clamp-2">"{preview}"</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {entries.length === 100 && (
            <p className="text-[11px] text-muted-foreground mt-2">Showing latest 100 events.</p>
          )}
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
