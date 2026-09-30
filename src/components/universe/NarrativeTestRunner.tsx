import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import DualLensScorecard, {
  type CausalScore,
  type RelationalScore,
} from "./DualLensScorecard";
import type { NarrativeTradition } from "@/lib/narrativeTradition";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

interface EntryRef { id: string; title: string }

interface TestRow {
  id: string;
  entry_id: string | null;
  causal_score: CausalScore;
  relational_score: RelationalScore;
  alignment_to_canon: number | null;
  tradition_detected: NarrativeTradition | null;
  divergence_notes: string[] | null;
  run_at: string;
}

export default function NarrativeTestRunner({
  universeId,
  entries,
}: {
  universeId: string;
  entries: EntryRef[];
}) {
  const [mode, setMode] = useState<"entry" | "text">(entries.length > 0 ? "entry" : "text");
  const [entryId, setEntryId] = useState<string>(entries[0]?.id ?? "");
  const [rawText, setRawText] = useState("");
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<TestRow | null>(null);
  const [history, setHistory] = useState<TestRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("universe_narrative_tests" as any)
        .select("*")
        .eq("universe_id", universeId)
        .order("run_at", { ascending: false })
        .limit(10);
      const rows = (data ?? []) as unknown as TestRow[];
      setHistory(rows);
      if (rows.length > 0) setLatest(rows[0]);
    })();
  }, [universeId]);

  const run = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    if (mode === "entry" && !entryId) {
      toast.error("Pick an entry to test");
      return;
    }
    if (mode === "text" && rawText.trim().length < 80) {
      toast.error("Add at least a paragraph of text to test");
      return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-canonical-narrative", {
        body: mode === "entry"
          ? { universe_id: universeId, entry_id: entryId }
          : { universe_id: universeId, raw_text: rawText },
      });
      if (error) throw error;
      const row = (data as any)?.test as TestRow;
      if (row) {
        setLatest(row);
        setHistory((h) => [row, ...h].slice(0, 10));
        toast.success("Narrative test complete");
      } else {
        toast.error("No result returned");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Test failed";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border/50 bg-card/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="text-xs font-mono uppercase tracking-wide">Test target</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as "entry" | "text")}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="entry" disabled={entries.length === 0}>Universe entry</SelectItem>
              <SelectItem value="text">Paste raw text</SelectItem>
            </SelectContent>
          </Select>

          {mode === "entry" && entries.length > 0 && (
            <Select value={entryId} onValueChange={setEntryId}>
              <SelectTrigger className="min-w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {entries.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button onClick={run} disabled={PAID_AI_SECURITY_HOLD || running} className="gap-2 ml-auto">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run dual-lens test
          </Button>
        </div>

        {mode === "text" && (
          <Textarea
            rows={6}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste a treatment, outline, or scene. The tester scores it on Causal Pressure (Western) and Relational Meaning (Eastern), then measures alignment to your universe canon."
          />
        )}
      </div>

      {latest && (
        <DualLensScorecard
          causal={latest.causal_score ?? {}}
          relational={latest.relational_score ?? {}}
          alignment={latest.alignment_to_canon}
          detected={latest.tradition_detected ?? undefined}
          divergenceNotes={latest.divergence_notes ?? undefined}
        />
      )}

      {history.length > 1 && (
        <div>
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
            Variance matrix — recent runs
          </h4>
          <div className="rounded-lg border border-border/40 divide-y divide-border/30">
            {history.map((row) => {
              const entry = entries.find((e) => e.id === row.entry_id);
              return (
                <button
                  key={row.id}
                  onClick={() => setLatest(row)}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-3 hover:bg-muted/30 transition"
                >
                  <span className="font-mono text-muted-foreground w-32 truncate">
                    {new Date(row.run_at).toLocaleString()}
                  </span>
                  <span className="flex-1 truncate">{entry?.title ?? "(raw text)"}</span>
                  <span className="font-mono">
                    C {Math.round((row.causal_score?.composite ?? 0))} ·
                    R {Math.round((row.relational_score?.composite ?? 0))}
                  </span>
                  {typeof row.alignment_to_canon === "number" && (
                    <span className="font-mono text-primary w-20 text-right">
                      ↔ {Math.round(row.alignment_to_canon)}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
