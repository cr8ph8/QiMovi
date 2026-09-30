/**
 * RouteEnforcementPanel
 * ─────────────────────
 * Governance view that separates the QUERY-readiness registry into two
 * unambiguous columns:
 *
 *   • Enforced (read-only)   — routes actually wrapped by `readOnlyHandler`,
 *                              writes fail at the DB, evidence tuples are
 *                              logged. Each row links to its slice of
 *                              `query_evidence_log`.
 *   • Reclassified as write  — routes that used to be read-shaped but were
 *                              split into a write endpoint + a separate read
 *                              counterpart. We surface the split so no reader
 *                              of this dashboard confuses the two.
 *
 * Distinct from `QueryReadinessPanel`, which shows the full inventory plus
 * violation stream. This one is the "boundary map" — who's on which side, and
 * where the evidence lives.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { QUERY_READY_ENDPOINTS, type EndpointEntry } from "@/lib/queryReadiness";
import { validateAgainstLog, stripHashPrefix, type ValidationStatus } from "@/lib/query/validateEvidence";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ShieldCheck,
  Split,
  FileSearch,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Search,
  Link2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import RouteClassificationAlertsCard from "./RouteClassificationAlertsCard";
import EnforcementCoverageCard from "./EnforcementCoverageCard";
import BoundaryMapExportMenu from "./BoundaryMapExportMenu";

interface EvidenceRow {
  id: string;
  created_at: string;
  function_name: string;
  query_hash: string;
  evidence_hash: string;
  state_hash: string | null;
  committed: boolean;
  context_kind: string | null;
  context_id: string | null;
}

interface ReplayFlagRow {
  id: string;
  created_at: string;
  function_name: string;
  context_kind: string | null;
  context_id: string | null;
  query_hash: string;
  expected_evidence_hash: string;
  observed_evidence_hash: string;
  kind: "divergence" | "substitution";
}

interface EvidenceStat {
  total: number;
  last?: string;
}

/**
 * Extract a "split out to <fn-name>" reference from a registry `purpose`
 * string so we can link a reclassified-write row to its enforced read pair.
 * Format the entries use today: "…Read path split out to read-<name>."
 */
function findSplitReadCounterpart(purpose: string): string | null {
  const m = purpose.match(/split out to ([a-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function short(hash: string): string {
  const stripped = hash.replace(/^sha256:/, "");
  return `${stripped.slice(0, 10)}…${stripped.slice(-4)}`;
}

function copy(value: string) {
  navigator.clipboard.writeText(value).then(() => toast.success("Copied"));
}

/**
 * Render an endpoint name with the current search query highlighted. Falls
 * back to the plain name when no query is active or no match exists.
 */
function HighlightedName({ name, query }: { name: string; query: string }) {
  if (!query) return <>{name}</>;
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return <>{name}</>;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-amber-500/30 text-foreground rounded-sm px-0.5">
        {name.slice(idx, idx + query.length)}
      </mark>
      {name.slice(idx + query.length)}
    </>
  );
}

type ClassFilter = "all" | "enforced" | "reclassified";

export default function RouteEnforcementPanel() {
  const enforced = useMemo(
    () => QUERY_READY_ENDPOINTS.filter((e) => e.intent === "read" && e.enforced),
    [],
  );
  const reclassified = useMemo(
    () => QUERY_READY_ENDPOINTS.filter((e) => e.intent !== "read" || !e.enforced),
    [],
  );

  // ── Search + class filter (client-side; the registry is small).
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");

  const query = search.trim().toLowerCase();
  const matches = (entry: EndpointEntry): boolean => {
    if (!query) return true;
    if (entry.name.toLowerCase().includes(query)) return true;
    if (entry.purpose.toLowerCase().includes(query)) return true;
    if (entry.badges.some((b) => b.toLowerCase().includes(query))) return true;
    return false;
  };

  const filteredEnforced = useMemo(
    () => (classFilter === "reclassified" ? [] : enforced.filter(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enforced, classFilter, query],
  );
  const filteredReclassified = useMemo(
    () => (classFilter === "enforced" ? [] : reclassified.filter(matches)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reclassified, classFilter, query],
  );
  const totalMatches = filteredEnforced.length + filteredReclassified.length;

  const [stats, setStats] = useState<Record<string, EvidenceStat>>({});
  const [rowsByFn, setRowsByFn] = useState<Record<string, EvidenceRow[]>>({});
  const [openFn, setOpenFn] = useState<string | null>(null);
  const [loadingFn, setLoadingFn] = useState<string | null>(null);
  const [validationByRow, setValidationByRow] = useState<Record<string, ValidationStatus | "loading">>({});
  const [replayFlags, setReplayFlags] = useState<ReplayFlagRow[]>([]);
  const [loadingFlags, setLoadingFlags] = useState(true);

  /**
   * Copy an anchor-style deep link (`…#route=<name>`) so operators can share a
   * URL that opens the panel pre-filtered to and expanded on this endpoint.
   */
  function copyRouteLink(name: string) {
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#route=${encodeURIComponent(name)}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success(`Link to ${name} copied`),
      () => toast.error("Clipboard blocked"),
    );
  }

  // Honor `#route=<name>` on mount: pre-fill the search box and auto-expand
  // that row so a shared link lands the operator on exactly the endpoint they
  // were sent to.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/route=([^&]+)/);
    if (!m) return;
    const name = decodeURIComponent(m[1]);
    setSearch(name);
    setOpenFn(name);
  }, []);

  // Load per-function evidence counts (24h) for enforced routes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const results = await Promise.all(
        enforced.map(async (entry) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q = (supabase as any)
            .from("query_evidence_log")
            .select("created_at", { count: "exact", head: false })
            .eq("function_name", entry.name)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(1);
          const { data, count, error } = await q;
          if (error) return [entry.name, { total: 0 }] as const;
          return [
            entry.name,
            {
              total: count ?? 0,
              last: (data?.[0] as { created_at?: string } | undefined)?.created_at,
            },
          ] as const;
        }),
      );
      if (cancelled) return;
      setStats(Object.fromEntries(results));
    })();
    return () => {
      cancelled = true;
    };
  }, [enforced]);

  // Load replay-flag stream (7d).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingFlags(true);
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("evidence_replay_flags")
        .select("id, created_at, function_name, context_kind, context_id, query_hash, expected_evidence_hash, observed_evidence_hash, kind")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      setLoadingFlags(false);
      if (error) return;
      setReplayFlags((data ?? []) as ReplayFlagRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleFn(name: string) {
    if (openFn === name) {
      setOpenFn(null);
      return;
    }
    setOpenFn(name);
    if (rowsByFn[name]) return;
    setLoadingFn(name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("query_evidence_log")
      .select("id, created_at, function_name, query_hash, evidence_hash, state_hash, committed, context_kind, context_id")
      .eq("function_name", name)
      .order("created_at", { ascending: false })
      .limit(20);
    setLoadingFn(null);
    if (error) {
      toast.error(`Failed to load evidence for ${name}`);
      return;
    }
    setRowsByFn((prev) => ({ ...prev, [name]: (data ?? []) as EvidenceRow[] }));
  }

  /**
   * Validate a logged tuple by re-checking it against the current log. If the
   * hash the panel already loaded still matches what the log reports for that
   * ⟨function, context, query_hash⟩, it PASSes. A mismatch means the log has
   * moved on (the response would have been different if re-issued now), so
   * the historical view we're showing DIVERGED from the current source of
   * truth — which is also useful signal.
   */
  async function validateRow(row: EvidenceRow) {
    setValidationByRow((prev) => ({ ...prev, [row.id]: "loading" }));
    const result = await validateAgainstLog({
      functionName: row.function_name,
      contextKind: row.context_kind ?? "none",
      contextId: row.context_id,
      queryHash: row.query_hash,
      evidenceHash: row.evidence_hash,
    });
    setValidationByRow((prev) => ({ ...prev, [row.id]: result.status }));
    if (result.status === "diverged") {
      toast.error(
        `Evidence diverged for ${row.function_name}: expected ${stripHashPrefix(result.expectedEvidenceHash ?? "").slice(0, 10)}…, saw ${stripHashPrefix(result.observedEvidenceHash).slice(0, 10)}…`,
      );
    } else if (result.status === "pass") {
      toast.success(`Evidence validated for ${row.function_name}`);
    } else {
      toast.message(`No matching log row for this ⟨function, context, query⟩`);
    }
  }


  return (
    <div className="space-y-4">
      <EnforcementCoverageCard />
      <RouteClassificationAlertsCard />


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Split className="h-4 w-4" />
              Route enforcement map
            </span>
            <span className="flex items-center gap-3">
              <span className="text-sm font-normal text-muted-foreground">
                {enforced.length} enforced · {reclassified.length} reclassified as write
              </span>
              <BoundaryMapExportMenu />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Enforced routes are wrapped by the <code className="text-xs">readOnlyHandler</code>{" "}
          contract: any accidental insert/update/delete throws at call-site, and each response
          appends a tuple to <code className="text-xs">query_evidence_log</code>. Reclassified
          routes were once considered read-shaped but perform governed writes; their read
          counterpart has been split out so the QUERY boundary stays honest.
        </CardContent>
      </Card>

      {/* Filter toolbar. Search matches endpoint name, purpose text, and
          badge tokens; the class tabs collapse the panel to one side of the
          boundary. */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search endpoint, purpose, or badge…"
                className="h-8 pl-7 pr-8 text-xs"
                aria-label="Search routes"
              />
              {search && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            <Tabs
              value={classFilter}
              onValueChange={(v) => setClassFilter(v as ClassFilter)}
            >
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs h-6">
                  All ({enforced.length + reclassified.length})
                </TabsTrigger>
                <TabsTrigger value="enforced" className="text-xs h-6">
                  Enforced ({enforced.length})
                </TabsTrigger>
                <TabsTrigger value="reclassified" className="text-xs h-6">
                  Reclassified ({reclassified.length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              {totalMatches} match{totalMatches === 1 ? "" : "es"}
              {(search || classFilter !== "all") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 ml-2 text-[10px]"
                  onClick={() => {
                    setSearch("");
                    setClassFilter("all");
                  }}
                >
                  Reset
                </Button>
              )}
            </span>
          </div>
        </CardContent>
      </Card>

      {classFilter !== "reclassified" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-500" />
              Enforced (read-only)
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {filteredEnforced.length}
              {filteredEnforced.length !== enforced.length && ` / ${enforced.length}`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Endpoint</TableHead>
                <TableHead>Reads / 24h</TableHead>
                <TableHead>Most recent</TableHead>
                <TableHead>Evidence log</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEnforced.map((entry) => {
                const s = stats[entry.name];
                const isOpen = openFn === entry.name;
                return (
                  <Fragment key={entry.name}>
                    <TableRow>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => toggleFn(entry.name)}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <HighlightedName name={entry.name} query={query} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={s && s.total > 0 ? "default" : "secondary"}>
                          {s ? s.total : "…"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s?.last ? new Date(s.last).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleFn(entry.name)}
                            className="h-7 gap-1 text-xs"
                          >
                            <FileSearch className="h-3 w-3" />
                            {isOpen ? "Hide" : "View"}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Copy deep link to this endpoint"
                            onClick={() => copyRouteLink(entry.name)}
                          >
                            <Link2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${entry.name}-evidence`}>
                        <TableCell colSpan={5} className="bg-muted/30 p-3">
                          <EvidenceSlice
                            functionName={entry.name}
                            loading={loadingFn === entry.name}
                            rows={rowsByFn[entry.name] ?? []}
                            validationByRow={validationByRow}
                            onValidate={validateRow}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {filteredEnforced.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    {enforced.length === 0
                      ? "No enforced read routes registered yet."
                      : "No enforced routes match the current filter."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      <ReplayFlagsCard loading={loadingFlags} rows={replayFlags} />

      {classFilter !== "enforced" && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Split className="h-4 w-4 text-amber-500" />
              Reclassified as write
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {filteredReclassified.length}
              {filteredReclassified.length !== reclassified.length &&
                ` / ${reclassified.length}`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Read counterpart</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReclassified.map((entry) => {
                const pair = findSplitReadCounterpart(entry.purpose);
                return (
                  <TableRow key={entry.name}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <HighlightedName name={entry.name} query={query} />
                        <Badge variant="destructive" className="text-[10px]">
                          write
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          title="Copy deep link to this endpoint"
                          onClick={() => copyRouteLink(entry.name)}
                        >
                          <Link2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md">
                      {entry.purpose}
                    </TableCell>
                    <TableCell>
                      {pair ? (
                        <Badge variant="secondary" className="font-mono text-xs gap-1">
                          <ExternalLink className="h-3 w-3" />
                          {pair}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredReclassified.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-sm text-muted-foreground">
                    {reclassified.length === 0
                      ? "No routes have been reclassified."
                      : "No reclassified routes match the current filter."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

function ValidationBadge({ status }: { status: ValidationStatus | "loading" | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  if (status === "loading")
    return (
      <Badge variant="secondary" className="text-[10px]">
        checking…
      </Badge>
    );
  if (status === "pass")
    return (
      <Badge variant="default" className="text-[10px] gap-1">
        <CheckCircle2 className="h-3 w-3" /> PASS
      </Badge>
    );
  if (status === "diverged")
    return (
      <Badge variant="destructive" className="text-[10px] gap-1">
        <AlertTriangle className="h-3 w-3" /> DIVERGED
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] gap-1">
      <CircleAlert className="h-3 w-3" /> NOT LOGGED
    </Badge>
  );
}

function ContextChip({ kind, id }: { kind: string | null; id: string | null }) {
  if (!kind || kind === "none")
    return <span className="text-xs text-muted-foreground">global</span>;
  if (!id)
    return (
      <Badge variant="secondary" className="text-[10px]">
        {kind}
      </Badge>
    );
  return (
    <button
      onClick={() => copy(id)}
      className="font-mono text-[10px] hover:underline flex items-center gap-1"
      title={`${kind}:${id}`}
    >
      <Badge variant="secondary" className="text-[10px]">
        {kind}
      </Badge>
      {id.slice(0, 8)}…
      <Copy className="h-3 w-3" />
    </button>
  );
}

function EvidenceSlice({
  functionName,
  loading,
  rows,
  validationByRow,
  onValidate,
}: {
  functionName: string;
  loading: boolean;
  rows: EvidenceRow[];
  validationByRow: Record<string, ValidationStatus | "loading">;
  onValidate: (row: EvidenceRow) => void | Promise<void>;
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading evidence for {functionName}…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No evidence rows yet for <code>{functionName}</code>. A tuple is appended on the next
        successful call.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        Last {rows.length} evidence tuples for <code>{functionName}</code>. Validate a row to
        re-check that the response we recorded still matches what the log reports for that
        ⟨function, context, query⟩ tuple.
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">When</TableHead>
            <TableHead className="text-xs">Context</TableHead>
            <TableHead className="text-xs">Query hash</TableHead>
            <TableHead className="text-xs">Evidence hash</TableHead>
            <TableHead className="text-xs">Validation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs">
                {new Date(r.created_at).toLocaleString()}
              </TableCell>
              <TableCell>
                <ContextChip kind={r.context_kind} id={r.context_id} />
              </TableCell>
              <TableCell>
                <button
                  onClick={() => copy(r.query_hash)}
                  className="font-mono text-xs hover:underline flex items-center gap-1"
                  title={r.query_hash}
                >
                  {short(r.query_hash)}
                  <Copy className="h-3 w-3" />
                </button>
              </TableCell>
              <TableCell>
                <button
                  onClick={() => copy(r.evidence_hash)}
                  className="font-mono text-xs hover:underline flex items-center gap-1"
                  title={r.evidence_hash}
                >
                  {short(r.evidence_hash)}
                  <Copy className="h-3 w-3" />
                </button>
              </TableCell>
              <TableCell className="flex items-center gap-2">
                <ValidationBadge status={validationByRow[r.id]} />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px]"
                  onClick={() => onValidate(r)}
                  disabled={validationByRow[r.id] === "loading"}
                >
                  Validate
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReplayFlagsCard({
  loading,
  rows,
}: {
  loading: boolean;
  rows: ReplayFlagRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Replay flags (7d)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading replay flags…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            No replay divergence detected in the last 7 days.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">When</TableHead>
                <TableHead className="text-xs">Function</TableHead>
                <TableHead className="text-xs">Context</TableHead>
                <TableHead className="text-xs">Kind</TableHead>
                <TableHead className="text-xs">Expected</TableHead>
                <TableHead className="text-xs">Observed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.function_name}</TableCell>
                  <TableCell>
                    <ContextChip kind={r.context_kind} id={r.context_id} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={r.kind === "divergence" ? "destructive" : "outline"}
                      className="text-[10px]"
                    >
                      {r.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {short(r.expected_evidence_hash)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {short(r.observed_evidence_hash)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

