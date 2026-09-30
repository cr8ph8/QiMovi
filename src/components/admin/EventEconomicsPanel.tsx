import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Trophy, Hash, Cpu, Clock, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface UsageRow {
  competition_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
}

interface Competition {
  id: string;
  name: string;
  status: string;
  festival_id: string | null;
}

interface Festival {
  id: string;
  title: string;
  status: string;
}

interface CompAgg {
  name: string;
  status: string;
  runs: number;
  tokens: number;
  cost: number;
}

interface FestivalGroup {
  title: string;
  status: string;
  competitions: CompAgg[];
  totalRuns: number;
  totalTokens: number;
  totalCost: number;
}

export default function EventEconomicsPanel() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<FestivalGroup[]>([]);
  const [grandTotals, setGrandTotals] = useState({ runs: 0, tokens: 0, cost: 0 });

  useEffect(() => {
    async function load() {
      const [{ data: usage }, { data: comps }, { data: fests }] = await Promise.all([
        supabase.from("judge_usage_log").select("competition_id, prompt_tokens, completion_tokens, estimated_cost_cents"),
        supabase.from("competitions").select("id, name, status, festival_id"),
        supabase.from("festivals").select("id, title, status"),
      ]);

      const usageRows = (usage || []) as UsageRow[];
      const competitions = (comps || []) as Competition[];
      const festivals = (fests || []) as Festival[];

      // Aggregate by competition_id
      const compMap: Record<string, { runs: number; tokens: number; cost: number }> = {};
      for (const r of usageRows) {
        if (!compMap[r.competition_id]) compMap[r.competition_id] = { runs: 0, tokens: 0, cost: 0 };
        compMap[r.competition_id].runs++;
        compMap[r.competition_id].tokens += (r.prompt_tokens || 0) + (r.completion_tokens || 0);
        compMap[r.competition_id].cost += Number(r.estimated_cost_cents || 0);
      }

      // Build festival lookup
      const festLookup: Record<string, Festival> = {};
      for (const f of festivals) festLookup[f.id] = f;

      // Group competitions by festival
      const festGroups: Record<string, CompAgg[]> = {};
      for (const c of competitions) {
        const key = c.festival_id || "__unassigned__";
        if (!festGroups[key]) festGroups[key] = [];
        const agg = compMap[c.id] || { runs: 0, tokens: 0, cost: 0 };
        festGroups[key].push({ name: c.name, status: c.status, ...agg });
      }

      // Build final groups
      const result: FestivalGroup[] = [];
      for (const [festId, compList] of Object.entries(festGroups)) {
        const fest = festLookup[festId];
        const totalRuns = compList.reduce((s, c) => s + c.runs, 0);
        const totalTokens = compList.reduce((s, c) => s + c.tokens, 0);
        const totalCost = compList.reduce((s, c) => s + c.cost, 0);
        result.push({
          title: fest ? fest.title : "Unassigned",
          status: fest ? fest.status : "—",
          competitions: compList.sort((a, b) => b.cost - a.cost),
          totalRuns,
          totalTokens,
          totalCost,
        });
      }
      result.sort((a, b) => b.totalCost - a.totalCost);

      const gRuns = result.reduce((s, g) => s + g.totalRuns, 0);
      const gTokens = result.reduce((s, g) => s + g.totalTokens, 0);
      const gCost = result.reduce((s, g) => s + g.totalCost, 0);

      setGroups(result);
      setGrandTotals({ runs: gRuns, tokens: gTokens, cost: gCost });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  const avgCostPerRun = grandTotals.runs > 0 ? grandTotals.cost / grandTotals.runs : 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" /> Event Economics
        </h3>
        <p className="text-xs text-muted-foreground">AI costs broken down by festival and competition.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total AI Cost", value: `$${(grandTotals.cost / 100).toFixed(2)}`, icon: DollarSign },
          { label: "Total Runs", value: String(grandTotals.runs), icon: Hash },
          { label: "Total Tokens", value: `${(grandTotals.tokens / 1000).toFixed(1)}k`, icon: Cpu },
          { label: "Avg Cost/Run", value: `$${(avgCostPerRun / 100).toFixed(4)}`, icon: DollarSign },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border/50 bg-card/80 p-4">
            <div className="flex items-center gap-2 mb-2">
              <card.icon className="h-4 w-4 text-primary" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{card.label}</span>
            </div>
            <p className="font-display text-xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Festival tree */}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No competitions or usage data yet.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <Collapsible key={group.title} defaultOpen={group.totalCost > 0}>
              <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
                <CollapsibleTrigger className="flex items-center gap-3 w-full px-5 py-3.5 hover:bg-muted/20 transition-colors cursor-pointer group">
                  <Trophy className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-display text-sm font-bold tracking-tight flex-1 text-left">{group.title}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{group.status}</Badge>
                  <span className="text-xs font-mono text-muted-foreground">{group.totalRuns} runs</span>
                  <span className="text-xs font-mono text-muted-foreground">{(group.totalTokens / 1000).toFixed(1)}k tok</span>
                  <span className="text-sm font-mono font-bold text-primary">${(group.totalCost / 100).toFixed(2)}</span>
                  {/* Placeholder columns */}
                  <span className="text-[10px] text-muted-foreground/40 hidden md:inline" title="Coming Soon">Human: —</span>
                  <span className="text-[10px] text-muted-foreground/40 hidden md:inline" title="Coming Soon">Vol. Hrs: —</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t border-border/30">
                    {group.competitions.map((comp) => (
                      <div key={comp.name} className="flex items-center gap-3 px-5 py-2.5 border-b border-border/20 last:border-b-0">
                        <span className="text-muted-foreground/50 text-xs pl-4">├─</span>
                        <span className="text-sm flex-1">{comp.name}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">{comp.status}</Badge>
                        <span className="text-xs font-mono text-muted-foreground">{comp.runs} runs</span>
                        <span className="text-xs font-mono text-muted-foreground">{(comp.tokens / 1000).toFixed(1)}k tok</span>
                        <span className="text-sm font-mono text-primary">${(comp.cost / 100).toFixed(3)}</span>
                        <span className="text-[10px] text-muted-foreground/40 hidden md:inline" title="Coming Soon">—</span>
                        <span className="text-[10px] text-muted-foreground/40 hidden md:inline" title="Coming Soon">—</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </div>
      )}

      {/* Coming soon note */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-dashed border-border/40 bg-muted/10">
        <Clock className="h-4 w-4 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground/60">
          <span className="font-semibold">Coming Soon:</span> Human reviewer costs and volunteer hours tracking will be added in a future update.
        </p>
      </div>
    </div>
  );
}
