/**
 * CharacterVoiceRegimeBadge — derives a voice regime from the latest
 * voice_drift_analysis row for an entry. Read-only.
 *
 * Schema (public.voice_drift_analysis):
 *   id, entry_id, drift_score (numeric), flagged (boolean), details (jsonb),
 *   created_at
 *
 * The regime classification mirrors the donor Voice Engine taxonomy, but
 * is computed from drift_score + flagged so it works without LLM data:
 *
 *   drift < 0.20 + !flagged                → Stable
 *   drift < 0.45                           → Drifting
 *   drift < 0.70 + flagged                 → Destabilized
 *   drift >= 0.70                          → Cornered
 *
 * If `details.regime` is present (free-text from a future analyzer), it
 * overrides the heuristic.
 */
import { useEffect, useState } from "react";
import { Mic, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  drift_score: number | null;
  flagged: boolean | null;
  details: unknown;
  created_at: string;
}

function regimeFor(drift: number, flagged: boolean): { label: string; tone: string } {
  if (drift >= 0.7) return { label: "Cornered", tone: "text-red-400 border-red-400/30 bg-red-400/10" };
  if (drift >= 0.45 && flagged) return { label: "Destabilized", tone: "text-amber-400 border-amber-400/30 bg-amber-400/10" };
  if (drift >= 0.2) return { label: "Drifting", tone: "text-amber-500/80 border-amber-500/20 bg-amber-500/5" };
  return { label: "Stable", tone: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" };
}

export default function CharacterVoiceRegimeBadge({ entryId }: { entryId?: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("voice_drift_analysis" as any)
        .select("drift_score, flagged, details, created_at")
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setRow((data as unknown as Row) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  if (!entryId) return null;

  if (loading) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> voice…
      </div>
    );
  }

  if (!row) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[9px] font-mono text-muted-foreground">
        <Mic className="h-2.5 w-2.5" /> no voice analysis
      </div>
    );
  }

  const drift = row.drift_score ?? 0;
  const flagged = row.flagged ?? false;
  const details = (row.details ?? {}) as Record<string, unknown>;
  const override = typeof details.regime === "string" ? (details.regime as string) : null;
  const r = override
    ? { label: override, tone: "text-primary border-primary/30 bg-primary/10" }
    : regimeFor(Number(drift), flagged);

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-mono ${r.tone}`}
      title={`Voice regime · drift ${(Number(drift) * 100).toFixed(0)}%`}
    >
      <Mic className="h-2.5 w-2.5" />
      <span className="uppercase tracking-wider">{r.label}</span>
      <span className="opacity-70">· {(Number(drift) * 100).toFixed(0)}%</span>
    </div>
  );
}
