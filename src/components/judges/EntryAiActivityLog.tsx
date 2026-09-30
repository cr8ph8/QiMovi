// EntryAiActivityLog — transparency feed of AI calls executed against this entry.
// Read-only view of existing `ai_usage_log` rows. No new tables, no new writes.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Row {
  id: string;
  created_at: string;
  function_name: string;
  model_id: string;
  status: string;
  routing_reason: string | null;
  sensitivity: string | null;
  duration_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error_message: string | null;
}

interface Props {
  entryId: string | null;
  limit?: number;
}

export function EntryAiActivityLog({ entryId, limit = 25 }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("ai_usage_log")
        .select(
          "id,created_at,function_name,model_id,status,routing_reason,sensitivity,duration_ms,prompt_tokens,completion_tokens,error_message"
        )
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!cancelled) {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, limit]);

  if (!entryId) return null;

  return (
    <div className="rounded-md border border-border/40 bg-card/50 p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          AI Activity (Transparency)
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {loading ? "loading…" : `${rows.length} calls`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No AI calls logged for this entry yet.
        </p>
      ) : (
        <ul className="space-y-1 max-h-64 overflow-auto pr-1">
          {rows.map((r) => {
            const ok = r.status === "success" || r.status === "ok";
            const dur = r.duration_ms ? `${r.duration_ms}ms` : "—";
            const tok = (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
            return (
              <li
                key={r.id}
                className="text-[11px] border border-border/30 bg-background/40 rounded px-2 py-1.5"
                title={r.error_message ?? r.routing_reason ?? ""}
              >
                <div className="flex items-center gap-1.5">
                  {ok ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-red-500" />
                  )}
                  <span className="font-mono font-semibold truncate">{r.function_name}</span>
                  <span className="text-muted-foreground truncate">{r.model_id}</span>
                  <span className="ml-auto text-muted-foreground tabular-nums">{dur}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  {r.sensitivity && <span>· {r.sensitivity}</span>}
                  {tok > 0 && <span>· {tok} tok</span>}
                  {r.routing_reason && <span className="truncate">· {r.routing_reason}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
