import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Loader2, Download, Wand2, ShieldAlert, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { computeDiff } from "@/lib/diff";

interface Analysis {
  id: string; title: string | null; mode: string; original_text: string;
  revised_text: string | null; scores: Record<string, number>; created_at: string;
  model: string | null; tokens_spent: number;
}
interface Signal {
  id: string; phrase: string; signal_type: string; severity: string;
  explanation: string | null; replacement_suggestion: string | null;
  span_start: number | null; span_end: number | null; color: string;
}
interface Claim {
  id: string; claim_text: string; claim_type: string; evidence_status: string;
  risk_level: string; action: string; suggested_rewrite: string | null; ordinal: number;
}

const COLOR_CLASS: Record<string, string> = {
  yellow: "bg-yellow-500/30 border-b-2 border-yellow-500",
  orange: "bg-orange-500/30 border-b-2 border-orange-500",
  red: "bg-red-500/30 border-b-2 border-red-500",
  blue: "bg-blue-500/30 border-b-2 border-blue-500",
  green: "bg-emerald-500/30 border-b-2 border-emerald-500",
};

const ACTION_BADGE: Record<string, string> = {
  ACCEPT: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  REVISE: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
  ESCALATE: "bg-orange-500/20 text-orange-200 border-orange-500/40",
  REJECT: "bg-red-500/20 text-red-200 border-red-500/40",
};

const SCORE_LABELS: Record<string, string> = {
  ai_signal_density: "AI-style Signal Density",
  specificity: "Specificity",
  evidence_quality: "Evidence Quality",
  claim_discipline: "Claim Discipline",
  human_texture: "Human Texture",
  overclaim_risk: "Overclaim Risk",
};

function HighlightedText({ text, signals }: { text: string; signals: Signal[] }) {
  const segments = useMemo(() => {
    const spans = signals
      .filter(s => s.span_start != null && s.span_end != null && s.span_end! > s.span_start!)
      .sort((a, b) => a.span_start! - b.span_start!);
    const out: Array<{ text: string; signal?: Signal }> = [];
    let cursor = 0;
    for (const s of spans) {
      if (s.span_start! < cursor) continue; // skip overlaps
      if (s.span_start! > cursor) out.push({ text: text.slice(cursor, s.span_start!) });
      out.push({ text: text.slice(s.span_start!, s.span_end!), signal: s });
      cursor = s.span_end!;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) });
    return out;
  }, [text, signals]);

  return (
    <div className="font-mono text-sm leading-relaxed whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.signal ? (
          <span
            key={i}
            className={`${COLOR_CLASS[seg.signal.color] ?? COLOR_CLASS.yellow} cursor-help`}
            title={`${seg.signal.signal_type} · ${seg.signal.severity}\n${seg.signal.explanation ?? ""}${seg.signal.replacement_suggestion ? `\n→ ${seg.signal.replacement_suggestion}` : ""}`}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{v}</span>
      </div>
      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export default function SignalCheckReport() {
  const { id } = useParams<{ id: string }>();
  useDocumentTitle("SignalCheck — Report");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [rewriting, setRewriting] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [a, s, c] = await Promise.all([
      supabase.from("signalcheck_analyses").select("*").eq("id", id).single(),
      supabase.from("signalcheck_signals").select("*").eq("analysis_id", id),
      supabase.from("signalcheck_claims").select("*").eq("analysis_id", id).order("ordinal"),
    ]);
    if (a.data) setAnalysis(a.data as any);
    if (s.data) setSignals(s.data as any);
    if (c.data) setClaims(c.data as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const handleRewrite = async () => {
    if (!id) return;
    setRewriting(true);
    try {
      const { data, error } = await supabase.functions.invoke("signalcheck-rewrite", { body: { analysis_id: id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Rewrite complete");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Rewrite failed");
    } finally {
      setRewriting(false);
    }
  };

  const handleExport = () => {
    if (!analysis) return;
    const lines = [
      `# SignalCheck Report — ${analysis.title || "Untitled"}`,
      `*Mode: ${analysis.mode} · ${new Date(analysis.created_at).toLocaleString()}*`,
      "",
      "> Editorial risk scores. Not a verdict on authorship.",
      "",
      "## Scores",
      ...Object.entries(analysis.scores).map(([k, v]) => `- **${SCORE_LABELS[k] ?? k}**: ${v}/100`),
      "",
      "## Signals",
      ...signals.map(s => `- [${s.severity}] *${s.signal_type}* — "${s.phrase}"${s.replacement_suggestion ? ` → ${s.replacement_suggestion}` : ""}`),
      "",
      "## Claim Ledger",
      ...claims.map(c => `- **${c.action}** [${c.claim_type} · ${c.evidence_status}] — "${c.claim_text}"${c.suggested_rewrite ? `\n  → ${c.suggested_rewrite}` : ""}`),
      "",
      "## Original",
      "",
      analysis.original_text,
      "",
      ...(analysis.revised_text ? ["## Revised", "", analysis.revised_text] : []),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signalcheck-${analysis.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  if (!analysis) return <div className="p-12 text-center text-muted-foreground">Analysis not found.</div>;

  const diffLines = analysis.revised_text ? computeDiff(analysis.original_text, analysis.revised_text) : [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link to="/signalcheck/analyze" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
            <ArrowLeft className="h-3 w-3" /> Back to Analyzer
          </Link>
          <h1 className="font-display text-3xl">{analysis.title || "Untitled"}</h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            mode: {analysis.mode} · model: {analysis.model} · {analysis.tokens_spent} tokens
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4 mr-2" /> Markdown</Button>
          <Button onClick={handleRewrite} disabled={rewriting}>
            {rewriting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
            {analysis.revised_text ? "Re-rewrite (40)" : "Rewrite (40)"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90 flex gap-2">
        <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
        These are editorial risk scores — they describe signals associated with AI-polished writing, not proof of authorship. Polished writers, non-native English speakers, and academic prose can score high without being machine-generated.
      </div>

      <Tabs defaultValue="text" className="space-y-4">
        <TabsList>
          <TabsTrigger value="text">Highlighted Text</TabsTrigger>
          <TabsTrigger value="scores">Scores</TabsTrigger>
          <TabsTrigger value="ledger">Claim Ledger ({claims.length})</TabsTrigger>
          <TabsTrigger value="signals">Signals ({signals.length})</TabsTrigger>
          <TabsTrigger value="rewrite" disabled={!analysis.revised_text}>Rewrite</TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <Card className="p-6 bg-card/60">
            <div className="flex flex-wrap gap-3 mb-4 text-[10px] font-mono">
              <Badge className="bg-yellow-500/30 text-yellow-100 border-yellow-500/40">vague/inflated</Badge>
              <Badge className="bg-orange-500/30 text-orange-100 border-orange-500/40">unsupported</Badge>
              <Badge className="bg-red-500/30 text-red-100 border-red-500/40">overclaim</Badge>
              <Badge className="bg-blue-500/30 text-blue-100 border-blue-500/40">needs source</Badge>
              <Badge className="bg-emerald-500/30 text-emerald-100 border-emerald-500/40">grounded</Badge>
            </div>
            <HighlightedText text={analysis.original_text} signals={signals} />
          </Card>
        </TabsContent>

        <TabsContent value="scores">
          <Card className="p-6 bg-card/60 grid sm:grid-cols-2 gap-x-8 gap-y-4">
            {Object.entries(SCORE_LABELS).map(([k, label]) => (
              <ScoreBar key={k} label={label} value={analysis.scores[k] ?? 0} />
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="ledger">
          <Card className="bg-card/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Suggested Rewrite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-sm text-sm">{c.claim_text}</TableCell>
                    <TableCell className="text-xs font-mono">{c.claim_type}</TableCell>
                    <TableCell className="text-xs font-mono">{c.evidence_status}</TableCell>
                    <TableCell className="text-xs font-mono">{c.risk_level}</TableCell>
                    <TableCell><Badge className={ACTION_BADGE[c.action]} variant="outline">{c.action}</Badge></TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">{c.suggested_rewrite || "—"}</TableCell>
                  </TableRow>
                ))}
                {claims.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No claims extracted.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="signals">
          <Card className="p-6 bg-card/60 space-y-3">
            {signals.map(s => (
              <div key={s.id} className="p-3 rounded-md border border-border/40 bg-background/40">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[10px]">{s.signal_type} · {s.severity}</Badge>
                  <span className={`inline-block w-2 h-2 rounded-full bg-${s.color}-500`} />
                </div>
                <div className="font-mono text-sm">"{s.phrase}"</div>
                {s.explanation && <p className="text-xs text-muted-foreground mt-1">{s.explanation}</p>}
                {s.replacement_suggestion && <p className="text-xs text-primary mt-1">→ {s.replacement_suggestion}</p>}
              </div>
            ))}
            {signals.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No signals flagged.</p>}
          </Card>
        </TabsContent>

        <TabsContent value="rewrite">
          {analysis.revised_text && (
            <Card className="bg-card/60 p-6">
              <div className="grid md:grid-cols-2 gap-4 font-mono text-sm">
                <div>
                  <h3 className="text-xs uppercase text-muted-foreground mb-2">Original</h3>
                  <div className="whitespace-pre-wrap leading-relaxed">{analysis.original_text}</div>
                </div>
                <div>
                  <h3 className="text-xs uppercase text-muted-foreground mb-2">Revised</h3>
                  <div className="whitespace-pre-wrap leading-relaxed">
                    {diffLines.map((l, i) => (
                      <div key={i} className={
                        l.type === "add" ? "bg-emerald-500/10 border-l-2 border-emerald-500 pl-2" :
                        l.type === "remove" ? "bg-red-500/10 border-l-2 border-red-500 pl-2 line-through opacity-60" :
                        ""
                      }>{l.text || "\u00a0"}</div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
