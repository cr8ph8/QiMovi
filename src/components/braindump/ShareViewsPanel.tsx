import { useEffect, useState } from "react";
import { Loader2, Eye, Globe, Code2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type ViewRow = {
  id: string;
  referrer: string | null;
  user_agent: string | null;
  surface: "public" | "embed" | string;
  viewer_user_id: string | null;
  created_at: string;
};

function refLabel(ref: string | null) {
  if (!ref) return "Direct / unknown";
  try {
    const u = new URL(ref);
    return u.hostname + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    return ref.slice(0, 80);
  }
}

function uaShort(ua: string | null) {
  if (!ua) return "";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua)) return "Safari";
  return ua.slice(0, 24);
}

export function ShareViewsPanel({ briefId }: { briefId: string }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ViewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("list_brief_views", {
      p_brief_id: briefId,
      p_limit: 50,
    });
    if (error) setError(error.message);
    else setRows((data ?? []) as ViewRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId]);

  const total = rows?.length ?? 0;
  const embedCount = rows?.filter((r) => r.surface === "embed").length ?? 0;

  return (
    <div className="space-y-2 pt-3 mt-2 border-t border-border/50">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5" /> Access audit
          {rows && (
            <span className="text-[10px] text-muted-foreground font-normal">
              · {total} view{total === 1 ? "" : "s"} · {embedCount} embed
            </span>
          )}
        </Label>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="h-7 px-2">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      {!error && rows && rows.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No views logged yet. We'll record each visit to your shared link here.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border/50 divide-y divide-border/40">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
              <Badge
                variant={r.surface === "embed" ? "outline" : "secondary"}
                className="text-[9px] h-4 px-1 gap-0.5"
              >
                {r.surface === "embed" ? <Code2 className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
                {r.surface}
              </Badge>
              <span className="flex-1 truncate text-foreground/90" title={r.referrer ?? "Direct"}>
                {refLabel(r.referrer)}
              </span>
              <span className="text-muted-foreground">{uaShort(r.user_agent)}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
