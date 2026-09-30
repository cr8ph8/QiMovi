import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function QFLedgerTab({ projectId }: { projectId: string }) {
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [chars, syms, bible] = await Promise.all([
        supabase.from("qframe_characters").select("*").eq("project_id", projectId),
        supabase.from("qframe_symbols").select("*").eq("project_id", projectId),
        supabase.from("qframe_visual_bible").select("*").eq("project_id", projectId).maybeSingle(),
      ]);
      setLedger({
        characters: chars.data ?? [],
        symbols: syms.data ?? [],
        color_arc: bible.data?.color_arc ?? {},
        perspective_arc: bible.data?.perspective_arc ?? {},
      });
      setLoading(false);
    })();
  }, [projectId]);

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>;

  return (
    <div className="space-y-4 py-6">
      <h3 className="font-display text-xl">Continuity Ledger</h3>
      <p className="text-sm text-muted-foreground">Read-only. Aggregated from Characters, Symbols, and Bible. Every shot packet is linted against this.</p>
      <Card><CardContent className="p-4">
        <pre className="text-xs whitespace-pre-wrap font-mono overflow-x-auto">{JSON.stringify(ledger, null, 2)}</pre>
      </CardContent></Card>
    </div>
  );
}
