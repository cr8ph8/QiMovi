import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Download } from "lucide-react";

export function QFExportTab({ projectId }: { projectId: string }) {
  const [exporting, setExporting] = useState(false);

  const run = async () => {
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("qframe-export-bundle", { body: { project_id: projectId } });
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `qframe-${projectId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Bundle downloaded");
    } catch (e: any) { toast.error(e.message ?? "Export failed"); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4 py-6">
      <h3 className="font-display text-xl">Export bundle</h3>
      <p className="text-sm text-muted-foreground">
        Generates a single JSON containing the project, music sections, visual bible, characters, symbols, shots, and shot packet refs.
        Hand this to Runway / Luma / Veo workflows. Costs 20 tokens.
      </p>
      <Card><CardContent className="p-6 flex justify-center">
        <Button onClick={run} disabled={exporting} className="gap-2">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Download className="h-4 w-4"/>}
          Generate &amp; download
        </Button>
      </CardContent></Card>
    </div>
  );
}
