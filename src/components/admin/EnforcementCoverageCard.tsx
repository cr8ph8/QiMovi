/**
 * EnforcementCoverageCard
 * ───────────────────────
 * Governance report that cross-references every deployed edge function with
 * the QUERY-readiness registry, then surfaces:
 *
 *   • how many routes are enforced read-only,
 *   • how many are reclassified writes,
 *   • which deployed functions are missing from the registry entirely
 *     (unreviewed — treated as presumed-write until inventoried),
 *   • and stale registry entries whose deployed function no longer exists.
 *
 * Rendered at the top of RouteEnforcementPanel so operators can see coverage
 * before drilling into any single route.
 */

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ShieldCheck,
  Split,
  AlertTriangle,
  PackageX,
} from "lucide-react";
import { computeEnforcementCoverage } from "@/lib/governance/enforcementCoverage";

function StatTile({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  icon: typeof ShieldCheck;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "bad"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div className="rounded-md border p-3 bg-muted/20 space-y-1">
      <div className={`flex items-center gap-1.5 text-xs ${toneClass}`}>
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function EnforcementCoverageCard() {
  const report = useMemo(() => computeEnforcementCoverage(), []);
  const [showMissing, setShowMissing] = useState(false);
  const [showStale, setShowStale] = useState(false);

  const { totals, missing, stale } = report;
  const uncoveredPct = 100 - totals.coveragePct;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            Enforcement coverage report
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {totals.registered}/{totals.deployed} functions inventoried
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Enforced read"
            value={totals.enforced}
            hint={`${totals.enforcedPct}% of deployed`}
            tone="good"
            icon={ShieldCheck}
          />
          <StatTile
            label="Reclassified write"
            value={totals.reclassified}
            hint="explicit write / mixed"
            tone="warn"
            icon={Split}
          />
          <StatTile
            label="Missing from registry"
            value={totals.missing}
            hint="presumed write (unreviewed)"
            tone={totals.missing > 0 ? "bad" : "good"}
            icon={AlertTriangle}
          />
          <StatTile
            label="Stale entries"
            value={totals.stale}
            hint="registered but not deployed"
            tone={totals.stale > 0 ? "warn" : "default"}
            icon={PackageX}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Inventory coverage</span>
            <span className="tabular-nums">
              {totals.coveragePct}% covered · {uncoveredPct}% unreviewed
            </span>
          </div>
          <Progress value={totals.coveragePct} className="h-2" />
        </div>

        {missing.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5">
            <button
              onClick={() => setShowMissing((v) => !v)}
              className="flex w-full items-center justify-between p-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="font-medium">
                  {missing.length} deployed function
                  {missing.length === 1 ? "" : "s"} missing from the registry
                </span>
                <Badge variant="destructive" className="text-[10px]">
                  presumed write
                </Badge>
              </span>
              {showMissing ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {showMissing && (
              <div className="border-t px-3 py-2">
                <p className="text-xs text-muted-foreground mb-2">
                  These functions exist under <code>supabase/functions/</code> but
                  have not been declared in <code>QUERY_READY_ENDPOINTS</code>.
                  Until reviewed they are treated as write/mixed by the
                  read/write boundary.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Function</TableHead>
                      <TableHead className="text-xs w-32">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {missing.map((name) => (
                      <TableRow key={name}>
                        <TableCell className="font-mono text-xs">{name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            unreviewed
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {stale.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5">
            <button
              onClick={() => setShowStale((v) => !v)}
              className="flex w-full items-center justify-between p-3 text-left"
            >
              <span className="flex items-center gap-2 text-sm">
                <PackageX className="h-4 w-4 text-amber-500" />
                <span className="font-medium">
                  {stale.length} stale registry entr
                  {stale.length === 1 ? "y" : "ies"}
                </span>
              </span>
              {showStale ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            {showStale && (
              <div className="border-t px-3 py-2">
                <p className="text-xs text-muted-foreground mb-2">
                  Declared in the readiness registry but no matching function
                  found under <code>supabase/functions/</code>. Remove the entry
                  or restore the function.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Function</TableHead>
                      <TableHead className="text-xs">Declared class</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stale.map((e) => (
                      <TableRow key={e.name}>
                        <TableCell className="font-mono text-xs">{e.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {e.intent === "read" && e.enforced
                              ? "enforced read"
                              : "reclassified write"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {missing.length === 0 && stale.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Every deployed edge function is inventoried, and no registry entry
            is stale. Full coverage of the read/write boundary.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
