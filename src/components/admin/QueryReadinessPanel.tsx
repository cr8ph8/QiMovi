import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  QUERY_READY_ENDPOINTS,
  NEVER_QUERY_OPERATIONS,
  type ContractBadge,
  type EndpointEntry,
} from "@/lib/queryReadiness";
import { CheckCircle2, AlertTriangle, ShieldOff, Copy } from "lucide-react";
import { toast } from "sonner";

interface EvidenceRow {
  id: string;
  created_at: string;
  function_name: string;
  principal_id: string | null;
  query_hash: string;
  state_hash: string | null;
  evidence_hash: string;
  committed: boolean;
  media_type: string | null;
}

interface ViolationRow {
  id: string;
  created_at: string;
  metadata_json: Record<string, unknown> | null;
}

const BADGE_LABEL: Record<ContractBadge, string> = {
  read_only_wrapper: "Read-only wrapper",
  evidence_log: "Evidence log",
  state_pin: "State-pin",
  cache_no_store: "Cache: no-store",
  context_binding: "Context-bound",
};

function intentColor(entry: EndpointEntry) {
  if (entry.intent === "read" && entry.enforced) return "default" as const;
  if (entry.intent === "read") return "secondary" as const;
  if (entry.intent === "mixed") return "outline" as const;
  return "destructive" as const;
}

function intentLabel(entry: EndpointEntry) {
  if (entry.intent === "read" && entry.enforced) return "Read · enforced";
  if (entry.intent === "read") return "Read · declared, not enforced";
  if (entry.intent === "mixed") return "Mixed";
  return "Write";
}

export default function QueryReadinessPanel() {
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [violations, setViolations] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const evidencePromise = (supabase as any)
        .from("query_evidence_log")
        .select("id, created_at, function_name, principal_id, query_hash, state_hash, evidence_hash, committed, media_type")
        .order("created_at", { ascending: false })
        .limit(25);
      const violationsPromise = supabase
        .from("governance_events")
        .select("id, created_at, metadata_json")
        .eq("event_type", "query_contract_violation")
        .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(25);
      const [ev, vi] = await Promise.all([evidencePromise, violationsPromise]);
      if (cancelled) return;
      setEvidence((ev.data ?? []) as EvidenceRow[]);
      setViolations((vi.data ?? []) as ViolationRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = useMemo(() => {
    const total = QUERY_READY_ENDPOINTS.length;
    const enforced = QUERY_READY_ENDPOINTS.filter((e) => e.enforced).length;
    return { total, enforced };
  }, []);

  const copy = (value: string) => {
    navigator.clipboard.writeText(value).then(() => toast.success("Copied"));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>QUERY Readiness</span>
            <span className="text-sm font-normal text-muted-foreground">
              {summary.enforced}/{summary.total} endpoints enforced
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Retrieved ≠ Admitted. Evaluated ≠ Committed. Read-shaped endpoints listed here
            promise no governed state change. Amber rows are declared read-only but not yet
            wrapped by the QUERY contract.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Intent</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Purpose</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {QUERY_READY_ENDPOINTS.map((entry) => (
                <TableRow key={entry.name}>
                  <TableCell className="font-mono text-xs">{entry.name}</TableCell>
                  <TableCell>
                    <Badge variant={intentColor(entry)}>{intentLabel(entry)}</Badge>
                  </TableCell>
                  <TableCell className="space-x-1">
                    {entry.badges.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      entry.badges.map((b) => (
                        <Badge key={b} variant="secondary" className="text-xs">
                          {BADGE_LABEL[b]}
                        </Badge>
                      ))
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{entry.purpose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Contract violations (7d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {violations.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              No `query_contract_violation` events in the last 7 days.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {violations.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-xs">{new Date(v.created_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {JSON.stringify(v.metadata_json)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence tuple stream</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No evidence rows yet. Rows appear after a wrapped read endpoint is called.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>Query hash</TableHead>
                  <TableHead>Evidence hash</TableHead>
                  <TableHead>Committed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evidence.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{new Date(row.created_at).toLocaleTimeString()}</TableCell>
                    <TableCell className="font-mono text-xs">{row.function_name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <button
                        onClick={() => copy(row.query_hash)}
                        className="hover:underline flex items-center gap-1"
                        title={row.query_hash}
                      >
                        {row.query_hash.slice(0, 12)}…<Copy className="h-3 w-3" />
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <button
                        onClick={() => copy(row.evidence_hash)}
                        className="hover:underline flex items-center gap-1"
                        title={row.evidence_hash}
                      >
                        {row.evidence_hash.slice(0, 12)}…<Copy className="h-3 w-3" />
                      </button>
                    </TableCell>
                    <TableCell>
                      {row.committed ? (
                        <Badge variant="destructive">true</Badge>
                      ) : (
                        <Badge variant="secondary">false</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldOff className="h-4 w-4" />
            Never expose under QUERY
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-1">
            {NEVER_QUERY_OPERATIONS.map((op) => (
              <li key={op} className="flex items-center gap-2">
                <ShieldOff className="h-3 w-3 text-destructive" />
                <span className="capitalize">{op}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            These operations request state changes and violate QUERY semantics. Any endpoint in
            the readiness table that starts performing one of these must be reclassified.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
