import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBarColor, getScoreColor } from "@/lib/score-utils";
import { TraditionPill } from "@/components/braindump/TraditionPill";
import { detectDominantTradition, type NarrativeTradition } from "@/lib/narrativeTradition";

export interface CausalScore {
  goal?: number;
  obstacle?: number;
  tension?: number;
  arc_gap?: number;
  structure?: number;
  composite?: number;
  notes?: string;
}

export interface RelationalScore {
  pattern?: number;
  turn?: number;
  equilibrium?: number;
  meaning_density?: number;
  composite?: number;
  notes?: string;
}

interface Props {
  causal: CausalScore;
  relational: RelationalScore;
  alignment?: number | null;
  detected?: NarrativeTradition | null;
  divergenceNotes?: string[];
}

function Row({ label, value }: { label: string; value?: number }) {
  const v = Math.round(Number(value ?? 0));
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={`text-xs font-mono font-bold ${getScoreColor(v)}`}>{v}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${v}%` }}
          transition={{ duration: 0.6 }}
          className={`h-full rounded-full ${getBarColor(v)}`}
        />
      </div>
    </div>
  );
}

export default function DualLensScorecard({
  causal,
  relational,
  alignment,
  detected,
  divergenceNotes,
}: Props) {
  const tradition = detected ?? detectDominantTradition(causal.composite, relational.composite);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Dominant lens
          </span>
          <TraditionPill tradition={tradition} />
        </div>
        {typeof alignment === "number" && (
          <Badge variant="outline" className="font-mono">
            Alignment to canon: <span className={`ml-1 ${getScoreColor(alignment)}`}>{Math.round(alignment)}%</span>
          </Badge>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-amber-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base flex items-center gap-2">
              Causal Pressure
              <Badge variant="secondary" className="text-[10px]">Western</Badge>
            </CardTitle>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">
              D = G · O · T
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Goal clarity" value={causal.goal} />
            <Row label="Obstacle pressure" value={causal.obstacle} />
            <Row label="Tension (S · U · A)" value={causal.tension} />
            <Row label="Arc gap discipline" value={causal.arc_gap} />
            <Row label="Structure" value={causal.structure} />
            <div className="pt-2 border-t border-border/40 flex items-baseline justify-between">
              <span className="text-xs font-mono uppercase text-muted-foreground">Composite</span>
              <span className={`text-lg font-mono font-bold ${getScoreColor(causal.composite ?? 0)}`}>
                {Math.round(causal.composite ?? 0)}
              </span>
            </div>
            {causal.notes && <p className="text-xs text-muted-foreground italic">{causal.notes}</p>}
          </CardContent>
        </Card>

        <Card className="border-sky-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base flex items-center gap-2">
              Relational Meaning
              <Badge variant="secondary" className="text-[10px]">Eastern</Badge>
            </CardTitle>
            <p className="text-[10px] font-mono text-muted-foreground uppercase">
              M = Pattern + Turn
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Pattern density (Ki·Shō)" value={relational.pattern} />
            <Row label="Turn strength (Ten)" value={relational.turn} />
            <Row label="Equilibrium (Ketsu)" value={relational.equilibrium} />
            <Row label="Meaning density" value={relational.meaning_density} />
            <Row label="Composite" value={relational.composite} />
            <div className="pt-2 border-t border-border/40 flex items-baseline justify-between">
              <span className="text-xs font-mono uppercase text-muted-foreground">Composite</span>
              <span className={`text-lg font-mono font-bold ${getScoreColor(relational.composite ?? 0)}`}>
                {Math.round(relational.composite ?? 0)}
              </span>
            </div>
            {relational.notes && <p className="text-xs text-muted-foreground italic">{relational.notes}</p>}
          </CardContent>
        </Card>
      </div>

      {divergenceNotes && divergenceNotes.length > 0 && (
        <Card className="border-yellow-600/30 bg-yellow-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display">Divergence from canon</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-1 text-xs text-yellow-100/90">
              {divergenceNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
