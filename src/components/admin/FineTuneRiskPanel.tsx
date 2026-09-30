import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, AlertTriangle, BookOpen, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface EmulationFlag {
  id: string;
  user_id: string | null;
  entry_id: string | null;
  function_name: string;
  matched_author: string;
  match_kind: string;
  disclosure_id: string | null;
  admin_reviewed: boolean;
  created_at: string;
}

/**
 * Fine-Tune Market Substitution risk panel.
 * Surfaces author-emulation flags from the AI router plus retroactive sweep results.
 * Motivated by Chakrabarty/Ginsburg/Dhillon (2025) — see mem://legal/ai-copyright.
 */
export default function FineTuneRiskPanel() {
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<EmulationFlag[]>([]);
  const [counts, setCounts] = useState({ open: 0, reviewed: 0, disclosed: 0, authors_active: 0 });
  const [scanning, setScanning] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: flagRows }, { count: authors }, { count: disclosed }] = await Promise.all([
      supabase
        .from("author_emulation_flags")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("protected_authors").select("*", { count: "exact", head: true }).eq("active", true),
      supabase.from("fine_tune_disclosures").select("*", { count: "exact", head: true }).neq("disclosure_type", "none"),
    ]);
    const rows = (flagRows || []) as EmulationFlag[];
    setFlags(rows);
    setCounts({
      open: rows.filter((r) => !r.admin_reviewed).length,
      reviewed: rows.filter((r) => r.admin_reviewed).length,
      disclosed: disclosed ?? 0,
      authors_active: authors ?? 0,
    });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runRetroactiveScan() {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("scan-protected-author-emulation");
      if (error) throw error;
      toast.success(`Retroactive scan complete: ${data?.flagged ?? 0} new flag(s) across ${data?.scanned ?? 0} log entries`);
      await load();
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message || e}`);
    } finally {
      setScanning(false);
    }
  }

  async function markReviewed(id: string) {
    const { error } = await supabase
      .from("author_emulation_flags")
      .update({ admin_reviewed: true })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    setFlags((prev) => prev.map((f) => f.id === id ? { ...f, admin_reviewed: true } : f));
    setCounts((c) => ({ ...c, open: Math.max(0, c.open - 1), reviewed: c.reviewed + 1 }));
  }

  if (loading) {
    return (
      <div className="p-6 rounded-xl border border-border/50 bg-card/80">
        <Skeleton className="h-5 w-48 mb-4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl border border-border/50 bg-card/80 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <h4 className="font-body text-sm font-semibold">Fine-Tune Market-Substitution Risk</h4>
        </div>
        <Button size="sm" variant="outline" onClick={runRetroactiveScan} disabled={scanning}>
          <RefreshCw className={`h-3 w-3 mr-1.5 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning…" : "Retroactive scan"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Chakrabarty/Ginsburg/Dhillon (2025) demonstrates that author-specific fine-tuning produces
        non-verbatim output preferred by readers over expert humans and largely invisible to AI
        detectors. The router flags requests that name a protected author; this panel routes those
        flags for review under disclose-and-watermark policy.
      </p>

      {/* Counts */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="Open flags" value={counts.open} accent="amber" />
        <Stat label="Reviewed" value={counts.reviewed} accent="muted" />
        <Stat label="User disclosures" value={counts.disclosed} accent="primary" />
        <Stat label="Authors active" value={counts.authors_active} accent="muted" />
      </div>

      {/* Recent flags */}
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {flags.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No emulation flags recorded yet.</p>
        )}
        {flags.map((f) => (
          <div key={f.id} className="p-3 rounded-md border border-border/40 bg-background/40 text-xs space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-mono">
                  <BookOpen className="h-3 w-3 text-primary" />
                  <span className="font-semibold capitalize">{f.matched_author}</span>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {f.match_kind.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="text-muted-foreground">
                  <span className="font-mono">{f.function_name}</span>
                  {f.entry_id && <span className="ml-2">entry <span className="font-mono">{f.entry_id.slice(0, 8)}</span></span>}
                  <span className="ml-2">· {new Date(f.created_at).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  {f.disclosure_id
                    ? <Badge className="text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Disclosed</Badge>
                    : <Badge className="text-[9px] bg-amber-500/20 text-amber-400 border-amber-500/30">No disclosure</Badge>}
                </div>
              </div>
              {!f.admin_reviewed ? (
                <Button size="sm" variant="ghost" onClick={() => markReviewed(f.id)}>
                  <Check className="h-3 w-3 mr-1" /> Mark reviewed
                </Button>
              ) : (
                <Badge variant="outline" className="text-[9px] text-muted-foreground">reviewed</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "amber"|"primary"|"muted" }) {
  const color = accent === "amber" ? "text-amber-400"
    : accent === "primary" ? "text-primary"
    : "text-foreground";
  return (
    <div className="rounded-md border border-border/30 bg-background/30 p-2">
      <div className={`font-display text-xl font-bold ${color} flex items-center justify-center gap-1`}>
        {accent === "amber" && value > 0 && <AlertTriangle className="h-4 w-4" />}
        {value}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}
