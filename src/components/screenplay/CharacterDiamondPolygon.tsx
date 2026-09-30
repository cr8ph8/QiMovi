/**
 * CharacterDiamondPolygon — 4-vertex SVG identity polygon.
 * Adapted from Qi Character Forge donor. Maps qi's `character_diamonds`
 * jsonb axes (epistemic / normative / affective / relational) into 0..1
 * "richness" scores by counting populated sub-arrays.
 *
 * Pure presentational — no data fetching, no side effects.
 */
import { motion } from "framer-motion";

export type AxisKey = "epistemic" | "normative" | "affective" | "relational";

export interface DiamondAxes {
  epistemic?: unknown;
  normative?: unknown;
  affective?: unknown;
  relational?: unknown;
}

const VERTICES: AxisKey[] = ["epistemic", "normative", "affective", "relational"];

const LABEL: Record<AxisKey, string> = {
  epistemic: "Epistemic",
  normative: "Normative",
  affective: "Affective",
  relational: "Relational",
};

/** Counts items across all string-array fields inside an axis jsonb object. */
function axisRichness(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  let count = 0;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(v)) count += v.length;
    else if (typeof v === "string" && v.trim().length > 0) count += 1;
  }
  // Normalize: 8+ items ≈ saturated.
  return Math.max(0, Math.min(1, count / 8));
}

interface Props {
  axes: DiamondAxes;
  baseline?: DiamondAxes;
  size?: number;
  className?: string;
}

export default function CharacterDiamondPolygon({ axes, baseline, size = 180, className }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.40;

  const pos = (vertex: AxisKey, v: number) => {
    const radius = r * (0.15 + 0.85 * v);
    switch (vertex) {
      case "epistemic":  return { x: cx,          y: cy - radius };
      case "relational": return { x: cx + radius, y: cy };
      case "affective":  return { x: cx,          y: cy + radius };
      case "normative":  return { x: cx - radius, y: cy };
    }
  };

  const current = Object.fromEntries(
    VERTICES.map((v) => [v, axisRichness((axes as Record<string, unknown>)[v])]),
  ) as Record<AxisKey, number>;

  const base = Object.fromEntries(
    VERTICES.map((v) => [v, baseline ? axisRichness((baseline as Record<string, unknown>)[v]) : 0]),
  ) as Record<AxisKey, number>;

  const polyPoints = (vals: Record<AxisKey, number>) =>
    VERTICES.map((v) => {
      const p = pos(v, vals[v]);
      return `${p.x},${p.y}`;
    }).join(" ");

  const rings = [0.25, 0.5, 0.75, 1.0].map((t) =>
    VERTICES.map((v) => {
      const p = pos(v, t);
      return `${p.x},${p.y}`;
    }).join(" "),
  );

  const hasAny = VERTICES.some((v) => current[v] > 0);

  return (
    <div className={className}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block mx-auto">
        {rings.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            className="stroke-border/40"
            strokeWidth={i === 3 ? 1 : 0.5}
            strokeDasharray={i === 3 ? "0" : "2 3"}
          />
        ))}
        {VERTICES.map((v) => {
          const p = pos(v, 1.0);
          return (
            <line
              key={v}
              x1={cx} y1={cy}
              x2={p.x} y2={p.y}
              className="stroke-border/30"
              strokeWidth={0.5}
            />
          );
        })}

        {baseline && (
          <polygon
            points={polyPoints(base)}
            fill="hsl(var(--muted-foreground) / 0.10)"
            stroke="hsl(var(--muted-foreground) / 0.55)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {hasAny && (
          <motion.polygon
            points={polyPoints(current)}
            fill="hsl(var(--primary) / 0.20)"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          />
        )}

        {hasAny &&
          VERTICES.map((v) => {
            const p = pos(v, current[v]);
            return (
              <circle
                key={v}
                cx={p.x}
                cy={p.y}
                r={3}
                fill="hsl(var(--primary))"
                stroke="hsl(var(--background))"
                strokeWidth={1.25}
              />
            );
          })}

        {VERTICES.map((v) => {
          const p = pos(v, 1.0);
          const dx = p.x - cx;
          const dy = p.y - cy;
          const len = Math.hypot(dx, dy) || 1;
          const lx = p.x + (dx / len) * 12;
          const ly = p.y + (dy / len) * 12;
          const anchor = v === "relational" ? "start" : v === "normative" ? "end" : "middle";
          return (
            <text
              key={v}
              x={lx}
              y={ly}
              fontSize={9}
              className="fill-muted-foreground"
              textAnchor={anchor}
              dominantBaseline="middle"
              fontWeight={600}
              style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
            >
              {LABEL[v]}
            </text>
          );
        })}
      </svg>

      <div className="grid grid-cols-4 gap-1 mt-2">
        {VERTICES.map((v) => (
          <div key={v} className="text-center">
            <p className="text-[8px] font-mono uppercase text-muted-foreground tracking-wider">
              {LABEL[v].slice(0, 4)}
            </p>
            <p className="text-[10px] font-mono font-bold text-primary">
              {Math.round(current[v] * 100)}
            </p>
          </div>
        ))}
      </div>

      {!hasAny && (
        <p className="text-[9px] font-mono text-muted-foreground italic text-center mt-1">
          Latent axes not populated. Generate a diamond to render the identity polygon.
        </p>
      )}
    </div>
  );
}
