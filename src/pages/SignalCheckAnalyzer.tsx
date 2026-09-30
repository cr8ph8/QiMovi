import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ShieldAlert, History } from "lucide-react";

const MODES = [
  { value: "general", label: "General Writing Review" },
  { value: "wikipedia", label: "Wikipedia / Encyclopedia Style" },
  { value: "academic", label: "Academic Paper Review" },
  { value: "linkedin", label: "LinkedIn / Thought Leadership" },
  { value: "q2e", label: "Q2E / Technical Claim Review" },
];

interface HistoryRow { id: string; title: string | null; mode: string; created_at: string; }

export default function SignalCheckAnalyzer() {
  useDocumentTitle("SignalCheck — Analyzer");
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftParam = searchParams.get("draft");
  const entryParam = searchParams.get("entry");
  const projectParam = searchParams.get("project");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState("general");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [anchorLabel, setAnchorLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate("/auth?redirect=/signalcheck/analyze");
  }, [loading, user, navigate]);

  // Resolve project_id from draft/entry/project query params via project_legacy_map.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      if (projectParam) {
        if (!cancelled) { setProjectId(projectParam); setAnchorLabel(`project ${projectParam.slice(0, 8)}`); }
        return;
      }
      const sourceTable = draftParam ? "screenplay_drafts" : entryParam ? "entries" : null;
      const sourceId = draftParam || entryParam;
      if (!sourceTable || !sourceId) return;
      const { data: map } = await (supabase as any)
        .from("project_legacy_map")
        .select("project_id")
        .eq("source_table", sourceTable)
        .eq("source_id", sourceId)
        .maybeSingle();
      if (cancelled) return;
      if (map?.project_id) {
        setProjectId(map.project_id);
        setAnchorLabel(`${sourceTable === "entries" ? "entry" : "draft"} ${sourceId.slice(0, 8)}`);
      }
      // Best-effort prefill of text + title from the canonical fountain
      // artifact (Phase B). Falls back to legacy column inside readFountain.
      if (sourceTable === "screenplay_drafts" || sourceTable === "entries") {
        const { readFountain } = await import("@/lib/screenplayArtifact");
        const art = await readFountain(sourceTable as any, sourceId);
        if (!cancelled) {
          if (art.title) setTitle(art.title);
          if (art.fountainText) setText(art.fountainText.slice(0, 20000));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, draftParam, entryParam, projectParam]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("signalcheck_analyses")
      .select("id, title, mode, created_at")
      .order("created_at", { ascending: false })
      .limit(15)
      .then(({ data }) => setHistory(data ?? []));
  }, [user]);

  const handleAnalyze = async () => {
    if (text.trim().length < 40) {
      toast.error("Paste at least 40 characters.");
      return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("signalcheck-analyze", {
        body: { text, mode, title: title || null, project_id: projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Analysis complete · ${data.tokensSpent} tokens`);
      navigate(`/signalcheck/a/${data.analysis_id}`);
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-3xl mb-1">SignalCheck Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            Paste prose. Pick a review mode. SignalCheck scores editorial risk and extracts every claim into a ledger.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90 flex gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
          SignalCheck flags <em>signals associated with AI-polished writing</em>. It does not produce a binary "written by AI" verdict.
          False positives are common on polished writers, non-native English, and formal academic prose.
        </div>

        {projectId && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200/90">
            Anchored to {anchorLabel ?? "project"}. SignalCheck will pass a verified ContentContext bundle to the AI router.
          </div>
        )}
        {(draftParam || entryParam || projectParam) && !projectId && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
            Could not resolve a unified project for this source. Running unanchored.
          </div>
        )}

        <Card className="p-4 space-y-3 bg-card/60">
          <div className="grid sm:grid-cols-2 gap-3">
            <Input placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste the text you want to review..."
            className="min-h-[400px] font-mono text-sm"
            maxLength={20000}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{text.length.toLocaleString()} / 20,000 characters</span>
            <Button onClick={handleAnalyze} disabled={running || text.trim().length < 40}>
              {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing…</> : "Analyze (25 tokens)"}
            </Button>
          </div>
        </Card>
      </div>

      <aside className="space-y-3">
        <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <History className="h-4 w-4" /> Recent Analyses
        </h2>
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground">No analyses yet.</p>
        )}
        {history.map(h => (
          <button
            key={h.id}
            onClick={() => navigate(`/signalcheck/a/${h.id}`)}
            className="block w-full text-left p-3 rounded-md border border-border/40 bg-card/40 hover:bg-card/80 transition"
          >
            <div className="text-sm truncate">{h.title || "Untitled"}</div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {h.mode} · {new Date(h.created_at).toLocaleDateString()}
            </div>
          </button>
        ))}
      </aside>
    </div>
  );
}
