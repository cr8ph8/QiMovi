/**
 * RouteClassificationAlertsCard
 * ─────────────────────────────
 * Governance alert surface for the RouteEnforcementPanel. Compares the live
 * `QUERY_READY_ENDPOINTS` registry against the last snapshot this browser saw
 * and highlights every route whose (intent, enforced) pair — and therefore its
 * QUERY-boundary class — has flipped.
 *
 * Two transitions carry the loudest weight:
 *   • enforced_read → reclassified_write  (a read guarantee was withdrawn)
 *   • reclassified_write → enforced_read  (a new read guarantee is now promised)
 *
 * Each transition shows the field-level diff (intent / enforced / badges /
 * purpose) so operators can see exactly what shifted before they acknowledge.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  acknowledgeAll,
  acknowledgeTransition,
  computeRouteTransitions,
  seedSnapshot,
  type FieldDiff,
  type RouteTransition,
  type TransitionKind,
} from "@/lib/governance/routeClassificationAlerts";
import { toast } from "sonner";

const KIND_META: Record<
  TransitionKind,
  { label: string; icon: typeof AlertTriangle; tone: "destructive" | "default" | "secondary" | "outline"; blurb: string }
> = {
  read_to_write: {
    label: "Enforced read → Reclassified write",
    icon: ShieldAlert,
    tone: "destructive",
    blurb:
      "A route that previously guaranteed read-only semantics now performs a governed write. Callers that assumed no side effects must be re-audited.",
  },
  write_to_read: {
    label: "Reclassified write → Enforced read",
    icon: ShieldCheck,
    tone: "default",
    blurb:
      "A route that used to be write-shaped is now wrapped by `readOnlyHandler`. Downstream code can rely on the new read-only contract.",
  },
  attributes_changed: {
    label: "Contract attributes changed",
    icon: AlertTriangle,
    tone: "outline",
    blurb:
      "Class stayed the same, but badges, purpose, or intent flags shifted. Review the diff before acknowledging.",
  },
  added: {
    label: "Route added to registry",
    icon: Sparkles,
    tone: "secondary",
    blurb: "New endpoint declared its QUERY-readiness contract.",
  },
  removed: {
    label: "Route removed from registry",
    icon: Trash2,
    tone: "secondary",
    blurb: "Endpoint was withdrawn from the readiness registry.",
  },
};

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (Array.isArray(v)) return v.length === 0 ? "∅" : v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function DiffRow({ diff }: { diff: FieldDiff }) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto_1fr] items-start gap-2 text-xs">
      <span className="font-mono uppercase text-muted-foreground">{diff.field}</span>
      <code className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive break-words">
        {renderValue(diff.before)}
      </code>
      <ArrowRight className="h-3 w-3 mt-1 text-muted-foreground" />
      <code className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 break-words">
        {renderValue(diff.after)}
      </code>
    </div>
  );
}

function TransitionCard({
  t,
  onAcknowledge,
}: {
  t: RouteTransition;
  onAcknowledge: (t: RouteTransition) => void;
}) {
  const meta = KIND_META[t.kind];
  const Icon = meta.icon;
  const critical = t.kind === "read_to_write";
  return (
    <div
      className={`rounded-md border p-3 space-y-2 ${
        critical
          ? "border-destructive/50 bg-destructive/5"
          : "border-border bg-muted/20"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon
              className={`h-4 w-4 ${
                critical ? "text-destructive" : "text-muted-foreground"
              }`}
            />
            <span className="font-mono text-sm">{t.name}</span>
            <Badge variant={meta.tone} className="text-[10px]">
              {meta.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">{meta.blurb}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={() => onAcknowledge(t)}
        >
          <CheckCircle2 className="h-3 w-3" />
          Acknowledge
        </Button>
      </div>

      {t.diffs.length > 0 && (
        <div className="space-y-1 rounded bg-background/60 p-2 border">
          {t.diffs.map((d) => (
            <DiffRow key={d.field} diff={d} />
          ))}
        </div>
      )}

      {(t.kind === "added" || t.kind === "removed") && (
        <div className="text-xs text-muted-foreground">
          {t.kind === "added" && t.after && (
            <>
              Registered as{" "}
              <Badge variant="outline" className="text-[10px]">
                {t.after.klass === "enforced_read" ? "enforced read" : "reclassified write"}
              </Badge>
              . Intent <code>{t.after.intent}</code>, enforced{" "}
              <code>{String(t.after.enforced)}</code>.
            </>
          )}
          {t.kind === "removed" && t.before && (
            <>
              Previously{" "}
              <Badge variant="outline" className="text-[10px]">
                {t.before.klass === "enforced_read" ? "enforced read" : "reclassified write"}
              </Badge>
              . Removing a route drops its contract from this dashboard.
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function RouteClassificationAlertsCard() {
  const [tick, setTick] = useState(0);
  const result = useMemo(() => computeRouteTransitions(), [tick]);

  // Seed on first run so the very first visit doesn't spuriously flag every
  // route as "added". After seeding we recompute once (which yields an empty
  // transition list, as expected).
  useEffect(() => {
    if (result.firstRun) {
      seedSnapshot();
      setTick((n) => n + 1);
    }
  }, [result.firstRun]);

  const active = result.transitions.filter(
    (t) => !result.acknowledged.has(t.signature),
  );
  const critical = active.filter((t) => t.kind === "read_to_write");
  const promotions = active.filter((t) => t.kind === "write_to_read");

  return (
    <Card
      className={
        critical.length > 0
          ? "border-destructive/60"
          : promotions.length > 0
            ? "border-emerald-500/40"
            : ""
      }
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <ShieldAlert
              className={`h-4 w-4 ${
                critical.length > 0 ? "text-destructive" : "text-muted-foreground"
              }`}
            />
            Route classification alerts
          </span>
          <span className="text-xs font-normal text-muted-foreground flex items-center gap-2">
            {critical.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {critical.length} read→write
              </Badge>
            )}
            {promotions.length > 0 && (
              <Badge variant="default" className="text-[10px]">
                {promotions.length} write→read
              </Badge>
            )}
            {active.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => {
                  acknowledgeAll(active);
                  toast.success(`Acknowledged ${active.length} transition(s)`);
                  setTick((n) => n + 1);
                }}
              >
                Ack all
              </Button>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            No pending route-classification transitions. The registry matches
            the last snapshot this browser saw.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The QUERY-readiness registry has changed since this browser last
              acknowledged it. Each entry below shows the exact field-level diff
              between the stored snapshot and the current code-owned registry.
            </p>
            {active.map((t) => (
              <TransitionCard
                key={t.signature}
                t={t}
                onAcknowledge={(tr) => {
                  acknowledgeTransition(tr);
                  toast.success(`Acknowledged ${tr.name}`);
                  setTick((n) => n + 1);
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
