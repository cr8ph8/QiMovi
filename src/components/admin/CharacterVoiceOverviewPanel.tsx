/**
 * CharacterVoiceOverviewPanel — God Mode admin surface for character and voice analysis.
 * Shows system-wide character/voice metrics across all entries with parsed screenplay text.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseFountain } from "@/lib/fountain-parser";
import {
  analyzeCharacters,
  computeVoiceMetrics,
  distinctivenessLabel,
  distinctivenessColor,
  balanceLabel,
  balanceColor,
  type CharacterProfile,
  type VoiceMetrics,
} from "@/lib/character";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, RefreshCw, AlertTriangle, Fingerprint } from "lucide-react";

interface EntryVoiceSummary {
  entryId: string;
  title: string;
  characterCount: number;
  avgDistinctiveness: number;
  dialogueBalance: number;
  lowDistinctivenessFlags: string[];
  dominantCharacter: string | null;
}

export default function CharacterVoiceOverviewPanel() {
  const [summaries, setSummaries] = useState<EntryVoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("entries")
      .select("id, title, script_text")
      .not("script_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!data) { setLoading(false); return; }

    const results: EntryVoiceSummary[] = [];
    for (const entry of data) {
      if (!entry.script_text) continue;
      const parsed = parseFountain(entry.script_text);
      if (parsed.stats.uniqueCharacters.length === 0) continue;
      const profiles = analyzeCharacters(parsed);
      const voice = computeVoiceMetrics(profiles);
      results.push({
        entryId: entry.id,
        title: entry.title,
        characterCount: voice.characterCount,
        avgDistinctiveness: voice.avgDistinctiveness,
        dialogueBalance: voice.dialogueBalance,
        lowDistinctivenessFlags: voice.lowDistinctivenessFlags,
        dominantCharacter: voice.dominantCharacter,
      });
    }

    setSummaries(results);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const flaggedCount = summaries.filter((s) => s.lowDistinctivenessFlags.length > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Fingerprint className="h-5 w-5 text-primary" />
        <h3 className="font-display text-sm font-bold">Character & Voice Analysis</h3>
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
          {summaries.length} entries analyzed
        </span>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={fetch} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg bg-muted/40 p-3 text-center">
          <p className="text-lg font-mono font-bold text-foreground">{summaries.length}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Entries Analyzed</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3 text-center">
          <p className="text-lg font-mono font-bold text-foreground">
            {summaries.length > 0 ? Math.round(summaries.reduce((s, e) => s + e.avgDistinctiveness, 0) / summaries.length) : 0}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Avg Distinctiveness</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3 text-center">
          <p className="text-lg font-mono font-bold text-foreground">
            {summaries.length > 0 ? Math.round(summaries.reduce((s, e) => s + e.dialogueBalance, 0) / summaries.length) : 0}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Avg Balance</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3 text-center">
          <p className={`text-lg font-mono font-bold ${flaggedCount > 0 ? "text-amber-500" : "text-emerald-500"}`}>
            {flaggedCount}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Flagged</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No entries with screenplay data found.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Entry</th>
                <th className="text-center py-2 px-3 font-mono text-[10px] text-muted-foreground">Chars</th>
                <th className="text-center py-2 px-3 font-mono text-[10px] text-muted-foreground">Distinctiveness</th>
                <th className="text-center py-2 px-3 font-mono text-[10px] text-muted-foreground hidden sm:table-cell">Balance</th>
                <th className="text-center py-2 px-3 font-mono text-[10px] text-muted-foreground hidden md:table-cell">Dominant</th>
                <th className="text-center py-2 px-3 font-mono text-[10px] text-muted-foreground">Flags</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.entryId} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                  <td className="py-2 px-3 text-xs truncate max-w-[180px]">{s.title}</td>
                  <td className="py-2 px-3 text-center text-xs font-mono">{s.characterCount}</td>
                  <td className="py-2 px-3 text-center">
                    <Badge variant="outline" className={`text-[9px] font-mono ${distinctivenessColor(s.avgDistinctiveness)}`}>
                      {s.avgDistinctiveness} — {distinctivenessLabel(s.avgDistinctiveness)}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-center hidden sm:table-cell">
                    <Badge variant="outline" className={`text-[9px] font-mono ${balanceColor(s.dialogueBalance)}`}>
                      {balanceLabel(s.dialogueBalance)}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-center hidden md:table-cell text-xs font-mono text-muted-foreground truncate max-w-[100px]">
                    {s.dominantCharacter || "—"}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {s.lowDistinctivenessFlags.length > 0 ? (
                      <span className="text-amber-500 text-[10px] font-mono flex items-center justify-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {s.lowDistinctivenessFlags.length}
                      </span>
                    ) : (
                      <span className="text-emerald-500 text-[10px] font-mono">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
