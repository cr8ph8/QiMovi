import { useEffect, useState } from "react";
import { Package, Download, RefreshCw, ShieldCheck, AlertTriangle, GitBranch, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface Props {
  entryId: string;
}

interface BundleRow {
  id: string;
  payload_hash: string;
  prev_hash: string | null;
  story_plan_hash: string | null;
  provenance_hash: string | null;
  continuity_verdict: string | null;
  token_count: number | null;
  created_at: string;
  payload_json: any;
}

function shortHash(h: string | null) {
  if (!h) return "—";
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

function verdictColor(v: string | null) {
  if (v === "PASS") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (v === "BLOCK" || v === "REJECT") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (v === "WARN") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export function ContextBundlePanel({ entryId }: Props) {
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  async function load() {
    setLoading(true);
    // Resolve project_id from legacy map then fetch bundles.
    const { data: leg } = await (supabase as any)
      .from("project_legacy_map")
      .select("project_id")
      .eq("source_table", "entries")
      .eq("source_id", entryId)
      .maybeSingle();
    const pid = (leg as any)?.project_id;
    if (!pid) {
      setBundles([]);
      setLoading(false);
      return;
    }
    const { data } = await (supabase as any)
      .from("context_bundles")
      .select("id, payload_hash, prev_hash, story_plan_hash, provenance_hash, continuity_verdict, token_count, created_at, payload_json")
      .eq("project_id", pid)
      .order("created_at", { ascending: false })
      .limit(10);
    setBundles((data as any) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [entryId]);

  async function build() {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("build-context-bundle", {
        body: { entry_id: entryId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Context bundle built", {
        description: `hash ${shortHash((data as any).payload_hash)}`,
      });
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to build bundle");
    } finally {
      setBuilding(false);
    }
  }

  function download(b: BundleRow) {
    const blob = new Blob([JSON.stringify(b.payload_json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `context_bundle_${b.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Context Bundle
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            A single, deterministic API payload that bundles the latest story
            plan, provenance snapshot, and narrative-gate verdict. Each build
            is hash-chained for tamper evidence.
          </p>
        </div>
        <Button onClick={build} disabled={building} className="shrink-0">
          {building ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Build bundle (5 tokens)
        </Button>
      </header>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : bundles.length === 0 ? (
        <div className="p-8 border border-dashed border-border rounded-xl text-center text-sm text-muted-foreground">
          No bundles yet. Build one to assemble an API-ready payload for this entry.
        </div>
      ) : (
        <ul className="space-y-3">
          {bundles.map((b, idx) => (
            <li key={b.id} className="p-4 rounded-xl border border-border bg-card/60 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <Badge variant="outline" className={verdictColor(b.continuity_verdict)}>
                      {b.continuity_verdict ?? "no verdict"}
                    </Badge>
                    {idx === 0 && <Badge variant="outline" className="border-primary/40 text-primary">latest</Badge>}
                    <span className="text-muted-foreground">{new Date(b.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground space-y-0.5">
                    <div className="flex items-center gap-1.5"><ShieldCheck className="h-3 w-3" /> payload {shortHash(b.payload_hash)}</div>
                    <div className="flex items-center gap-1.5"><GitBranch className="h-3 w-3" /> prev {shortHash(b.prev_hash)}</div>
                    <div className="flex gap-3 pt-1">
                      <span>story_plan {shortHash(b.story_plan_hash)}</span>
                      <span>provenance {shortHash(b.provenance_hash)}</span>
                      {b.token_count != null && <span>~{b.token_count} tok</span>}
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => download(b)}>
                  <Download className="h-3 w-3 mr-1.5" /> JSON
                </Button>
              </div>
              {!b.payload_json?.story_plan && (
                <div className="flex items-center gap-2 text-[11px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  No story_plan artifact attached — bundle includes provenance + continuity only.
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ContextBundlePanel;
