// Donor primitive — explains the Q2E dimensions used across evaluation surfaces.
import { Sparkles, Scale, Target, Layers } from "lucide-react";

const DIMS = [
  { icon: Target, name: "Quality",     blurb: "Craft, prose, dialogue, mechanics. Does the page work?" },
  { icon: Layers, name: "Quotient",    blurb: "Structural & thematic coherence across the whole piece." },
  { icon: Scale,  name: "Equilibrium", blurb: "Tonal balance. No single element dominates the others." },
  { icon: Sparkles, name: "Energy",    blurb: "Forward propulsion — does the script keep moving?" },
];

export function Q2EExplainerPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm">The Q2E lens</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Every rubric on this platform reduces to these four axes.
      </p>
      <ul className={compact ? "mt-3 grid grid-cols-2 gap-2" : "mt-3 space-y-2"}>
        {DIMS.map(({ icon: Icon, name, blurb }) => (
          <li key={name} className="flex items-start gap-2">
            <Icon className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium">{name}</p>
              {!compact && <p className="text-[11px] text-muted-foreground">{blurb}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Q2EExplainerPanel;
