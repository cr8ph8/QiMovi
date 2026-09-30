// Provenance Receipt Viewer
// ----------------------------------------------------------------------------
// Standalone UI for tracing every artifact on an `entries` row back to the
// universe root (if the entry is a member of any project universe) and for
// verifying that the caller holds the exact provenance bundle the platform
// captured.
//
// The bundle SHA-256 is computed from the CANONICAL JSON of the sorted
// (nodes, edges) tuple + the entry root + the universe root. This is the same
// deterministic shape written into evidence receipts — pasting a hash from a
// downloaded receipt into the "verify" box should always match live data.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  ShieldAlert,
  Copy,
  Download,
  GitBranch,
  Layers,
  ArrowUp,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Node {
  id: string;
  label: string;
  node_type: string;
  created_at: string;
  related_event_id: string | null;
  related_version_id: string | null;
  metadata_json: unknown;
}
interface Edge {
  from_node_id: string;
  to_node_id: string;
  edge_type: string;
  metadata_json: unknown;
}

interface UniverseRoot {
  universe_id: string;
  name: string | null;
}

interface Manifest {
  version: "provenance_bundle_v1";
  entry_id: string;
  universe_root: UniverseRoot | null;
  nodes: Node[];
  edges: Edge[];
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Canonical stringify with sorted keys — produces the same bytes across runs. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

function nodeGlyph(t: string): string {
  if (t.includes("universe")) return "◈";
  if (t.includes("entry")) return "◆";
  if (t.includes("draft") || t.includes("version")) return "◇";
  if (t.includes("event") || t.includes("rewrite")) return "→";
  if (t.includes("score") || t.includes("judge")) return "★";
  if (t.includes("receipt") || t.includes("evidence")) return "▣";
  return "•";
}

export function buildAncestors(startId: string | null, edges: Edge[]): Set<string> {
  // Walks upward via any edge FROM startId (assume child→parent orientation).
  const chain = new Set<string>();
  if (!startId) return chain;
  const queue: string[] = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (chain.has(id)) continue;
    chain.add(id);
    for (const e of edges) {
      if (e.from_node_id === id && !chain.has(e.to_node_id)) queue.push(e.to_node_id);
      // Also walk any reverse relationships so we don't miss universe-parented graphs.
      if (e.to_node_id === id && !chain.has(e.from_node_id)) queue.push(e.from_node_id);
    }
  }
  return chain;
}

/**
 * Rich trace diagnostics on top of `buildAncestors`.
 *
 * Surfaces the three failure modes the viewer must render distinctly:
 *   - `isOrphan`      : the selected node has no edges at all → dangling artifact
 *   - `hasCycle`      : traversal re-entered a visited node → lineage loop
 *   - `missingNodeIds`: edges reference node ids that were never persisted
 *                       (broken pointer — the walk stops there but we still tell
 *                       the user *which* id disappeared so they can chase it in
 *                       the DB / audit log)
 *
 * `nextBest` is a short list of candidate ids the UI can offer as jump-to
 * suggestions when the current trace is incomplete: sibling nodes of the same
 * `node_type`, ordered newest-first, excluding what's already in the chain.
 */
export interface TraceDiagnostics {
  chain: Set<string>;
  isOrphan: boolean;
  hasCycle: boolean;
  missingNodeIds: string[];
  nextBest: string[];
}

export function traceLineage(
  startId: string | null,
  nodes: Node[],
  edges: Edge[],
): TraceDiagnostics {
  const empty: TraceDiagnostics = {
    chain: new Set(),
    isOrphan: false,
    hasCycle: false,
    missingNodeIds: [],
    nextBest: [],
  };
  if (!startId) return empty;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const touchesStart = edges.some(
    (e) => e.from_node_id === startId || e.to_node_id === startId,
  );

  const chain = new Set<string>();
  const missing = new Set<string>();
  const queue: string[] = [startId];

  // Undirected walk fills `chain` — provenance can be emitted in either
  // orientation and we don't want to lose either half of the graph.
  while (queue.length) {
    const id = queue.shift()!;
    if (chain.has(id)) continue;
    chain.add(id);
    if (id !== startId && !nodeIds.has(id)) missing.add(id);
    for (const e of edges) {
      if (e.from_node_id === id && !chain.has(e.to_node_id)) queue.push(e.to_node_id);
      if (e.to_node_id === id && !chain.has(e.from_node_id)) queue.push(e.from_node_id);
    }
  }

  // Directed cycle detection restricted to the chain. Walk from→to only; if
  // DFS re-enters a node already on the recursion stack, we have a true
  // provenance loop (as opposed to a diamond / fan-out, which is a valid DAG).
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!chain.has(e.from_node_id) || !chain.has(e.to_node_id)) continue;
    const list = adj.get(e.from_node_id) ?? [];
    list.push(e.to_node_id);
    adj.set(e.from_node_id, list);
  }
  const GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  let hasCycle = false;
  const dfs = (u: string): void => {
    if (hasCycle) return;
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) { hasCycle = true; return; }
      if (c === undefined) dfs(v);
    }
    color.set(u, BLACK);
  };
  for (const id of chain) {
    if (!color.has(id)) dfs(id);
    if (hasCycle) break;
  }

  const seed = nodes.find((n) => n.id === startId);
  const nextBest = seed
    ? nodes
        .filter((n) => n.node_type === seed.node_type && !chain.has(n.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 3)
        .map((n) => n.id)
    : [];

  return {
    chain,
    isOrphan: !touchesStart,
    hasCycle,
    missingNodeIds: [...missing].sort(),
    nextBest,
  };
}

export default function ProvenanceReceiptViewer() {
  const params = useParams<{ entryId?: string }>();
  const { toast } = useToast();
  const [entryId, setEntryId] = useState(params.entryId ?? "");
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [universeRoot, setUniverseRoot] = useState<UniverseRoot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundleHash, setBundleHash] = useState<string>("");
  const [verifyInput, setVerifyInput] = useState<string>("");

  async function load(idArg?: string) {
    const id = (idArg ?? entryId).trim();
    if (!id) return;
    setLoading(true);
    setSelectedId(null);
    try {
      const [nodesRes, edgesRes, univRes] = await Promise.all([
        supabase
          .from("provenance_nodes")
          .select("id,label,node_type,created_at,related_event_id,related_version_id,metadata_json")
          .eq("entry_id", id)
          .order("created_at"),
        supabase
          .from("provenance_edges")
          .select("from_node_id,to_node_id,edge_type,metadata_json")
          .eq("entry_id", id),
        supabase
          .from("universe_entries")
          .select("universe_id, project_universes!inner(name)")
          .eq("entry_id", id)
          .maybeSingle(),
      ]);

      const ns = ((nodesRes.data ?? []) as unknown) as Node[];
      const es = ((edgesRes.data ?? []) as unknown) as Edge[];
      const root: UniverseRoot | null = univRes.data
        ? {
            universe_id: (univRes.data as any).universe_id as string,
            name:
              ((univRes.data as any).project_universes?.name as string | undefined) ?? null,
          }
        : null;

      setNodes(ns);
      setEdges(es);
      setUniverseRoot(root);

      const manifest: Manifest = {
        version: "provenance_bundle_v1",
        entry_id: id,
        universe_root: root,
        nodes: [...ns].sort((a, b) => a.id.localeCompare(b.id)),
        edges: [...es].sort((a, b) =>
          `${a.from_node_id}|${a.to_node_id}|${a.edge_type}`.localeCompare(
            `${b.from_node_id}|${b.to_node_id}|${b.edge_type}`,
          ),
        ),
      };
      const hash = await sha256Hex(canonicalize(manifest));
      setBundleHash(hash);
    } catch (e: any) {
      toast({
        title: "Failed to load provenance",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
      setNodes([]);
      setEdges([]);
      setUniverseRoot(null);
      setBundleHash("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (params.entryId) {
      setEntryId(params.entryId);
      load(params.entryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.entryId]);

  const trace = useMemo(
    () => traceLineage(selectedId, nodes, edges),
    [selectedId, nodes, edges],
  );
  const ancestorPath = trace.chain;

  const orderedPath = useMemo(() => {
    // Order ancestor chain oldest→newest for a readable "root → artifact" view.
    return [...ancestorPath]
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is Node => !!n)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [ancestorPath, nodes]);

  const nextBestNodes = useMemo(
    () =>
      trace.nextBest
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is Node => !!n),
    [trace.nextBest, nodes],
  );

  const verifyState: "idle" | "match" | "mismatch" = useMemo(() => {
    if (!verifyInput.trim()) return "idle";
    return verifyInput.trim().toLowerCase() === bundleHash.toLowerCase() ? "match" : "mismatch";
  }, [verifyInput, bundleHash]);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Copied", description: `${label} copied to clipboard.` }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  }

  function download() {
    const manifest: Manifest & { bundle_sha256: string } = {
      version: "provenance_bundle_v1",
      entry_id: entryId,
      universe_root: universeRoot,
      nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges].sort((a, b) =>
        `${a.from_node_id}|${a.to_node_id}|${a.edge_type}`.localeCompare(
          `${b.from_node_id}|${b.to_node_id}|${b.edge_type}`,
        ),
      ),
      bundle_sha256: bundleHash,
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `provenance-${entryId.slice(0, 8)}-${bundleHash.slice(0, 12)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="min-h-screen pt-20 pb-16">
      <div className="container max-w-5xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="font-display text-2xl">Provenance Receipt Viewer</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Load any entry's provenance graph, trace an artifact back to the
            universe root, and verify that a SHA-256 bundle manifest matches
            the live evidence exactly.
          </p>
        </header>

        {/* Loader */}
        <div className="rounded-xl border border-border/40 bg-card/60 p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label htmlFor="entry-id" className="text-xs font-medium text-muted-foreground">
              Entry ID
            </label>
            <Input
              id="entry-id"
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
              placeholder="uuid of an entries row"
              className="mt-1 font-mono text-xs"
            />
          </div>
          <Button onClick={() => load()} disabled={loading || !entryId.trim()} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            Load provenance
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : nodes.length === 0 && !bundleHash ? (
          <div className="rounded-xl border border-dashed border-border/40 p-8 text-center text-sm text-muted-foreground">
            Load an entry to see its provenance graph and bundle hash.
          </div>
        ) : (
          <>
            {/* Bundle manifest + verifier */}
            <div className="rounded-xl border border-primary/30 bg-card/80 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-display text-sm font-semibold uppercase tracking-wider flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" aria-hidden="true" /> Bundle manifest
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Canonical SHA-256 over {nodes.length} nodes · {edges.length} edges ·{" "}
                    universe root {universeRoot ? "attached" : "none"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => copy(bundleHash, "Bundle SHA-256")} className="gap-1.5">
                    <Copy className="h-3.5 w-3.5" /> Copy hash
                  </Button>
                  <Button size="sm" variant="outline" onClick={download} className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download JSON
                  </Button>
                </div>
              </div>
              <code className="block text-[11px] font-mono break-all rounded bg-muted/40 border border-border/40 p-2">
                {bundleHash || "—"}
              </code>
              <div>
                <label htmlFor="verify" className="text-xs font-medium text-muted-foreground">
                  Verify a claimed hash
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    id="verify"
                    value={verifyInput}
                    onChange={(e) => setVerifyInput(e.target.value)}
                    placeholder="Paste a SHA-256 hex string from a receipt"
                    className="font-mono text-xs"
                  />
                  {verifyState === "match" && (
                    <Badge className="gap-1 bg-primary/15 text-primary border border-primary/40">
                      <CheckCircle2 className="h-3.5 w-3.5" /> match
                    </Badge>
                  )}
                  {verifyState === "mismatch" && (
                    <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                      <XCircle className="h-3.5 w-3.5" /> mismatch
                    </Badge>
                  )}
                  {verifyState === "idle" && (
                    <Badge variant="outline" className="gap-1 border-muted-foreground/30 text-muted-foreground">
                      <ShieldAlert className="h-3.5 w-3.5" /> awaiting input
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Roots */}
            <div className="rounded-xl border border-border/40 bg-card/60 p-4 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Universe root
                </div>
                {universeRoot ? (
                  <a
                    href={`/universe/${universeRoot.universe_id}`}
                    className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                  >
                    ◈ {universeRoot.name || universeRoot.universe_id.slice(0, 8)}
                  </a>
                ) : (
                  <div className="mt-1 text-sm text-muted-foreground">
                    This entry is not attached to a universe.
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Entry
                </div>
                <div className="mt-1 font-mono text-xs break-all">{entryId}</div>
              </div>
            </div>

            {/* Artifacts + trace */}
            <div className="grid gap-4 lg:grid-cols-[2fr,3fr]">
              {/* Node list */}
              <div className="rounded-xl border border-border/40 bg-card/60 p-4">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider mb-3">
                  Artifacts ({nodes.length})
                </h3>
                <ul className="space-y-1 max-h-[420px] overflow-y-auto pr-1" role="listbox">
                  {nodes.map((n) => {
                    const selected = selectedId === n.id;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => setSelectedId(n.id)}
                          className={`w-full text-left px-2 py-1.5 rounded border text-xs flex items-center gap-2 transition-colors ${
                            selected
                              ? "border-primary/60 bg-primary/10"
                              : "border-border/30 hover:bg-muted/40"
                          }`}
                        >
                          <span className="text-base leading-none" aria-hidden="true">
                            {nodeGlyph(n.node_type)}
                          </span>
                          <span className="flex-1 truncate">{n.label}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {n.node_type}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {nodes.length === 0 && (
                    <li className="text-xs text-muted-foreground italic">
                      No provenance nodes recorded for this entry.
                    </li>
                  )}
                </ul>
              </div>

              {/* Ancestor trace */}
              <div className="rounded-xl border border-border/40 bg-card/60 p-4">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
                  <ArrowUp className="h-4 w-4 text-primary" aria-hidden="true" /> Trace to root
                </h3>
                {!selectedId ? (
                  <div
                    className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-4 text-center"
                    role="status"
                  >
                    <ArrowUp className="h-5 w-5 mx-auto mb-2 text-muted-foreground/60" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground">
                      Select an artifact on the left to trace its ancestors up to
                      the entry / universe root.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Diagnostic banners: orphan / cycle / missing pointers.
                        Rendered ABOVE the chain so a broken trace is never
                        silently presented as a clean one. */}
                    {trace.isOrphan && (
                      <div
                        role="alert"
                        className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
                      >
                        <div className="font-semibold flex items-center gap-1.5">
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          Orphan artifact
                        </div>
                        <p className="mt-1 text-amber-100/80">
                          This node has no recorded provenance edges. It exists
                          in the graph but nothing links it to a parent or
                          child. Ancestry cannot be verified.
                        </p>
                      </div>
                    )}
                    {trace.hasCycle && (
                      <div
                        role="alert"
                        className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground"
                      >
                        <div className="font-semibold flex items-center gap-1.5">
                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Cyclic lineage detected
                        </div>
                        <p className="mt-1 opacity-90">
                          Traversal re-entered a node it had already visited.
                          The chain below is truncated at the first repeat —
                          audit the edges for this entry.
                        </p>
                      </div>
                    )}
                    {trace.missingNodeIds.length > 0 && (
                      <div
                        role="alert"
                        className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
                      >
                        <div className="font-semibold flex items-center gap-1.5">
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          Broken pointer{trace.missingNodeIds.length > 1 ? "s" : ""}
                        </div>
                        <p className="mt-1 text-amber-100/80">
                          {trace.missingNodeIds.length} edge target
                          {trace.missingNodeIds.length > 1 ? "s" : ""} reference
                          {trace.missingNodeIds.length > 1 ? "" : "s"} nodes that
                          were never persisted:
                        </p>
                        <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] break-all">
                          {trace.missingNodeIds.slice(0, 5).map((id) => (
                            <li key={id}>· {id}</li>
                          ))}
                          {trace.missingNodeIds.length > 5 && (
                            <li>· …and {trace.missingNodeIds.length - 5} more</li>
                          )}
                        </ul>
                      </div>
                    )}

                    {orderedPath.length === 0 ? (
                      <div
                        className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-4 text-center"
                        role="status"
                      >
                        <p className="text-xs text-muted-foreground">
                          {trace.isOrphan
                            ? "No lineage to render — this artifact stands alone."
                            : "No ancestors found — this artifact is a root node."}
                        </p>
                      </div>
                    ) : (
                      <ol className="space-y-2">
                        {orderedPath.map((n, i) => (
                          <li key={n.id} className="flex items-start gap-2">
                            <span className="mt-0.5 font-mono text-[10px] text-muted-foreground w-5 text-right">
                              {i + 1}.
                            </span>
                            <span className="text-base leading-none mt-0.5" aria-hidden="true">
                              {nodeGlyph(n.node_type)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{n.label}</div>
                              <div className="text-[10px] font-mono text-muted-foreground">
                                {n.node_type} · {new Date(n.created_at).toLocaleString()}
                              </div>
                            </div>
                          </li>
                        ))}
                        {universeRoot ? (
                          <li className="flex items-start gap-2 pt-2 border-t border-border/30">
                            <span className="mt-0.5 font-mono text-[10px] text-muted-foreground w-5 text-right">
                              ⇧
                            </span>
                            <span className="text-base leading-none mt-0.5 text-primary" aria-hidden="true">
                              ◈
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-primary">
                                {universeRoot.name || "Universe root"}
                              </div>
                              <div className="text-[10px] font-mono text-muted-foreground break-all">
                                {universeRoot.universe_id}
                              </div>
                            </div>
                          </li>
                        ) : (
                          <li className="flex items-start gap-2 pt-2 border-t border-border/30">
                            <span
                              className="mt-0.5 font-mono text-[10px] text-muted-foreground w-5 text-right"
                              aria-hidden="true"
                            >
                              ⇧
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs italic text-muted-foreground">
                                No universe root — this entry is not attached to
                                a project universe.
                              </div>
                            </div>
                          </li>
                        )}
                      </ol>
                    )}

                    {/* Next-best suggestions: peer nodes of the same type the
                        user can jump to when the current trace is empty or
                        broken. Rendered as buttons so keyboard nav works. */}
                    {nextBestNodes.length > 0 &&
                      (trace.isOrphan ||
                        trace.hasCycle ||
                        trace.missingNodeIds.length > 0 ||
                        orderedPath.length <= 1) && (
                        <div className="mt-3 rounded-lg border border-border/40 bg-muted/10 p-3">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                            Next-best nodes to inspect
                          </div>
                          <ul className="space-y-1">
                            {nextBestNodes.map((n) => (
                              <li key={n.id}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedId(n.id)}
                                  className="w-full text-left px-2 py-1 rounded border border-border/30 hover:bg-muted/40 text-xs flex items-center gap-2 transition-colors"
                                >
                                  <span className="text-sm leading-none" aria-hidden="true">
                                    {nodeGlyph(n.node_type)}
                                  </span>
                                  <span className="flex-1 truncate">{n.label}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {n.node_type}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
