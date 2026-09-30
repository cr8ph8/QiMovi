import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";

/**
 * Admin widget: `submit_blocked` events.
 *
 * Reads `auth_audit_log` rows written by the `log-access-denial` edge
 * function on behalf of `src/lib/logSubmitBlocked.ts`. RLS restricts
 * this table to `has_role(admin)`, so the panel is safe to render
 * anywhere inside the admin surface.
 *
 * Surfaces the three fields most useful for triaging a blocked-submit
 * spike (reason, competition_id, length_category, timestamp), plus
 * click-to-inspect for the full `details` blob. Reason is a filterable
 * dropdown that stays in sync with `SubmitBlockedReason`.
 */

// Kept in sync with SubmitBlockedReason in src/lib/logSubmitBlocked.ts.
// A new reason on the client should be mirrored here so the filter
// dropdown surfaces it — but the panel still renders unknown reasons
// verbatim so we never drop rows.
const KNOWN_REASONS = [
  "submissions_closed",
  "payments_closed",
  "signups_closed",
  "category_deadline_passed",
  "ineligible_page_count",
  "insufficient_tokens",
  "unauthenticated",
] as const;

type Reason = (typeof KNOWN_REASONS)[number] | (string & {});

interface SubmitBlockedRow {
  id: string;
  created_at: string;
  reason: string | null;
  details: Record<string, unknown> | null;
  user_id: string | null;
}

interface DetailShape {
  competition_id?: string | null;
  competition_label?: string | null;
  length_category?: string | null;
  path?: string | null;
  required_tokens?: number | null;
  current_balance?: number | null;
  shortfall?: number | null;
  gate?: string | null;
}

const PAGE_SIZE = 50;

function formatReason(reason: string | null): string {
  if (!reason) return "unknown";
  return reason.replace(/_/g, " ");
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SubmitBlockedPanel() {
  const [rows, setRows] = useState<SubmitBlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<Reason | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from("auth_audit_log")
      .select("id, created_at, reason, details, user_id")
      .eq("event_type", "submit_blocked")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (reasonFilter !== "all") {
      query = query.eq("reason", reasonFilter);
    }

    const { data, error: err } = await query;
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      setRows((data ?? []) as SubmitBlockedRow[]);
    }
    setLoading(false);
  }, [reasonFilter]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Reason options = the union of KNOWN_REASONS ∪ reasons observed in the
  // loaded rows. Ensures the dropdown surfaces any newly-added reason
  // even before this file is updated to mirror it.
  const reasonOptions = useMemo(() => {
    const set = new Set<string>(KNOWN_REASONS);
    for (const r of rows) if (r.reason) set.add(r.reason);
    return Array.from(set).sort();
  }, [rows]);

  const totalsByReason = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = r.reason ?? "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              Blocked Submit Attempts
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Latest {PAGE_SIZE} <code className="font-mono">submit_blocked</code> events from{" "}
              <code className="font-mono">auth_audit_log</code>. Use the reason filter to isolate a spike.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={reasonFilter}
              onValueChange={(v) => setReasonFilter(v as Reason | "all")}
            >
              <SelectTrigger className="h-8 w-52 text-xs" aria-label="Filter by reason">
                <SelectValue placeholder="All reasons" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reasons</SelectItem>
                {reasonOptions.map((r) => (
                  <SelectItem key={r} value={r} className="font-mono text-xs">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => void fetchRows()}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Reason breakdown chips — one glance summary of the current window. */}
        {!loading && rows.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from(totalsByReason.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <Badge
                  key={reason}
                  variant={reason === reasonFilter ? "default" : "secondary"}
                  className="cursor-pointer font-mono text-[10px]"
                  onClick={() => setReasonFilter(reason as Reason)}
                >
                  {reason}: {count}
                </Badge>
              ))}
          </div>
        )}
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-3 flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded border border-dashed border-muted p-6 text-center text-xs text-muted-foreground">
            No blocked submit attempts
            {reasonFilter !== "all" ? (
              <>
                {" "}
                for reason <code className="font-mono">{reasonFilter}</code>
              </>
            ) : null}{" "}
            in the recent window.
          </div>
        ) : (
          <ScrollArea className="max-h-[520px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">When</TableHead>
                  <TableHead className="w-[180px]">Reason</TableHead>
                  <TableHead>Competition</TableHead>
                  <TableHead className="w-[140px]">Category</TableHead>
                  <TableHead className="w-[80px] text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const d = (r.details ?? {}) as DetailShape;
                  const isOpen = expandedId === r.id;
                  return (
                    <>
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                          {formatTimestamp(r.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {formatReason(r.reason)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.competition_id ? (
                            <div className="flex flex-col">
                              <span>{d.competition_id}</span>
                              {d.competition_label && (
                                <span className="text-[10px] text-muted-foreground">
                                  {d.competition_label}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.length_category ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setExpandedId(isOpen ? null : r.id)}
                            aria-expanded={isOpen}
                            aria-controls={`submit-blocked-details-${r.id}`}
                          >
                            {isOpen ? "Hide" : "Show"}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow
                          key={`${r.id}-details`}
                          id={`submit-blocked-details-${r.id}`}
                        >
                          <TableCell colSpan={5} className="bg-muted/30">
                            <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
                              {JSON.stringify(
                                { user_id: r.user_id, ...r.details },
                                null,
                                2,
                              )}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
