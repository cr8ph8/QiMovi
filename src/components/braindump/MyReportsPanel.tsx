import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck } from "lucide-react";

type MyReport = {
  id: string;
  comment_id: string;
  brief_id: string;
  brief_title: string | null;
  reason: string | null;
  status: "pending" | "reviewed" | "dismissed";
  appeal_status: "none" | "requested" | "upheld" | "overturned";
  appeal_response: string | null;
  comment_hidden: boolean;
  comment_preview: string | null;
  created_at: string;
  reviewed_at: string | null;
  appeal_requested_at: string | null;
  appeal_resolved_at: string | null;
};

const statusVariant = (s: MyReport["status"]) =>
  s === "pending" ? "destructive" : s === "reviewed" ? "default" : "secondary";

const appealVariant = (s: MyReport["appeal_status"]) =>
  s === "requested" ? "outline"
    : s === "upheld" ? "destructive"
    : s === "overturned" ? "secondary"
    : "outline";

export function MyReportsPanel({ briefId }: { briefId?: string }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MyReport[]>([]);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setAuthed(false);
        setLoading(false);
        return;
      }
      setAuthed(true);
      const { data, error } = await supabase.rpc("list_my_brief_comment_reports", {
        p_limit: 50,
      });
      if (cancelled) return;
      if (error) {
        console.warn("list_my_brief_comment_reports failed", error);
        setRows([]);
      } else {
        const all = (data ?? []) as MyReport[];
        setRows(briefId ? all.filter((r) => r.brief_id === briefId) : all);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [briefId]);

  if (!authed) return null;
  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-4">
          <Loader2 className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> My reports ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded border p-2 text-sm space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(r.status)} className="text-[10px] h-4">
                  {r.status}
                </Badge>
                {r.appeal_status !== "none" && (
                  <Badge variant={appealVariant(r.appeal_status)} className="text-[10px] h-4">
                    appeal: {r.appeal_status}
                  </Badge>
                )}
                {r.comment_hidden && (
                  <Badge variant="outline" className="text-[10px] h-4">comment hidden</Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              {!briefId && r.brief_title && (
                <div className="text-xs text-muted-foreground">on "{r.brief_title}"</div>
              )}
              {r.comment_preview && (
                <p className="text-xs text-muted-foreground line-clamp-2 italic">
                  "{r.comment_preview}"
                </p>
              )}
              {r.reason && (
                <p className="text-xs"><span className="text-muted-foreground">Your reason:</span> {r.reason}</p>
              )}
              {r.appeal_status === "requested" && (
                <p className="text-xs text-muted-foreground">
                  The brief owner has disputed this report. An admin will review.
                </p>
              )}
              {r.appeal_response && (
                <p className="text-xs"><span className="text-muted-foreground">Admin note:</span> {r.appeal_response}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
