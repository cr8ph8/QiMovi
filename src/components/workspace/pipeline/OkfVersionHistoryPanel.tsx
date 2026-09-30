import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAdmitConcept } from "@/hooks/useAdmitConcept";

interface Props { projectId: string | null }

type Row = {
  id: string;
  version: number;
  is_current: boolean;
  updated_at: string;
  created_at: string;
  created_by: string | null;
  payload_json: any;
};

type Concept = {
  type: string; title: string; status: string; risk: string;
  tags: string[]; source: string | null; body: string;
};

const conceptOf = (r: Row): Concept => {
  const c = r.payload_json?.concept ?? {};
  return {
    type: c.type ?? "Unknown",
    title: c.title ?? "(untitled)",
    status: c.status ?? "draft",
    risk: c.risk ?? "low",
    tags: Array.isArray(c.tags) ? c.tags : [],
    source: c.source ?? null,
    body: typeof c.body === "string" ? c.body : "",
  };
};

const slotKey = (c: Concept) => `${c.type.trim().toLowerCase()}::${c.title.trim().toLowerCase()}`;

// Minimal LCS-based line diff
type DiffLine = { kind: "eq" | "add" | "del"; text: string; a?: number; b?: number };
function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ kind: "eq", text: A[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: A[i], a: i + 1 }); i++; }
    else { out.push({ kind: "add", text: B[j], b: j + 1 }); j++; }
  }
  while (i < n) { out.push({ kind: "del", text: A[i], a: i + 1 }); i++; }
  while (j < m) { out.push({ kind: "add", text: B[j], b: j + 1 }); j++; }
  return out;
}

function metaSummary(c: Concept): string {
  return [
    `type: ${c.type}`,
    `title: ${c.title}`,
    `status: ${c.status}`,
    `risk: ${c.risk}`,
    `tags: ${c.tags.join(", ") || "—"}`,
    `source: ${c.source ?? "—"}`,
  ].join("\n");
}

type ChangeSummary = ReturnType<typeof computeChangeSummary>;
function computeChangeSummary(left: Row, right: Row) {
  const cL = conceptOf(left), cR = conceptOf(right);
  const metaChanges: { field: string; from: string; to: string }[] = [];
  const fields: (keyof Concept)[] = ["type", "title", "status", "risk", "source"];
  for (const f of fields) {
    const a = (cL[f] ?? "—") as string;
    const b = (cR[f] ?? "—") as string;
    if (String(a) !== String(b)) metaChanges.push({ field: f, from: String(a || "—"), to: String(b || "—") });
  }
  const tagsL = new Set(cL.tags), tagsR = new Set(cR.tags);
  const tagsAdded = [...tagsR].filter((t) => !tagsL.has(t));
  const tagsRemoved = [...tagsL].filter((t) => !tagsR.has(t));
  const wordsL = cL.body.trim().split(/\s+/).filter(Boolean).length;
  const wordsR = cR.body.trim().split(/\s+/).filter(Boolean).length;
  const wordDelta = wordsR - wordsL;
  const bodyIdentical = cL.body === cR.body;
  const nothingChanged =
    metaChanges.length === 0 && tagsAdded.length === 0 && tagsRemoved.length === 0 && bodyIdentical;
  return {
    metaChanges, tagsAdded, tagsRemoved, wordDelta, bodyChanged: !bodyIdentical, nothingChanged,
    leftV: left.version, rightV: right.version,
  };
}

export default function OkfVersionHistoryPanel({ projectId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("");
  const [reverting, setReverting] = useState(false);
  const [diffTarget, setDiffTarget] = useState<"body" | "meta">("body");
  // Bulk/single reverts flow through the canonical hook. Toast is
  // suppressed because this panel already renders per-slot bulk
  // results + its own success/warning messages.
  const { admit } = useAdmitConcept({ toast: false, successVerb: "Reverted to" });

  // Bulk selection state — keyed by slot key.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTargets, setBulkTargets] = useState<Record<string, string>>({}); // slotKey → target row.id
  const [bulkCompareOpen, setBulkCompareOpen] = useState(false);
  const [bulkReverting, setBulkReverting] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ label: string; ok: boolean; message: string }[]>([]);

  const load = async () => {
    if (!projectId) { setRows([]); return; }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("project_artifacts")
      .select("id, version, is_current, updated_at, created_at, created_by, payload_json")
      .eq("project_id", projectId)
      .eq("artifact_type", "okf_concept")
      .order("updated_at", { ascending: false });
    if (error) toast.error("Failed to load OKF versions");
    setRows(((data ?? []) as Row[]));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  const slots = useMemo(() => {
    const map = new Map<string, { label: string; concept: Concept; versions: Row[] }>();
    for (const r of rows) {
      const c = conceptOf(r);
      const key = slotKey(c);
      const entry = map.get(key) ?? { label: `${c.type} · ${c.title}`, concept: c, versions: [] };
      entry.versions.push(r);
      map.set(key, entry);
    }
    for (const [, v] of map) v.versions.sort((a, b) => b.version - a.version);
    return Array.from(map.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [rows]);

  useEffect(() => {
    if (!slot && slots.length) setSlot(slots[0][0]);
  }, [slots, slot]);

  const active = slots.find(([k]) => k === slot)?.[1];

  useEffect(() => {
    if (!active) { setLeftId(""); setRightId(""); return; }
    const vs = active.versions;
    setRightId(vs[0]?.id ?? "");
    setLeftId((vs[1] ?? vs[0])?.id ?? "");
  }, [active?.versions.map(v => v.id).join(",")]); // eslint-disable-line

  const left = active?.versions.find(v => v.id === leftId);
  const right = active?.versions.find(v => v.id === rightId);

  const diff = useMemo(() => {
    if (!left || !right) return [] as DiffLine[];
    const cL = conceptOf(left), cR = conceptOf(right);
    return diffTarget === "body"
      ? diffLines(cL.body, cR.body)
      : diffLines(metaSummary(cL), metaSummary(cR));
  }, [left, right, diffTarget]);

  const stats = useMemo(() => {
    let add = 0, del = 0;
    for (const d of diff) { if (d.kind === "add") add++; else if (d.kind === "del") del++; }
    return { add, del };
  }, [diff]);

  const summary = useMemo(() => {
    if (!left || !right) return null;
    const cL = conceptOf(left), cR = conceptOf(right);
    const metaChanges: { field: string; from: string; to: string }[] = [];
    const fields: (keyof Concept)[] = ["type", "title", "status", "risk", "source"];
    for (const f of fields) {
      const a = (cL[f] ?? "—") as string;
      const b = (cR[f] ?? "—") as string;
      if (String(a) !== String(b)) metaChanges.push({ field: f, from: String(a || "—"), to: String(b || "—") });
    }
    const tagsL = new Set(cL.tags), tagsR = new Set(cR.tags);
    const tagsAdded = [...tagsR].filter((t) => !tagsL.has(t));
    const tagsRemoved = [...tagsL].filter((t) => !tagsR.has(t));

    // Body deltas
    const bodyLinesL = cL.body ? cL.body.split("\n").length : 0;
    const bodyLinesR = cR.body ? cR.body.split("\n").length : 0;
    const wordsL = cL.body.trim().split(/\s+/).filter(Boolean).length;
    const wordsR = cR.body.trim().split(/\s+/).filter(Boolean).length;
    const wordDelta = wordsR - wordsL;
    const bodyIdentical = cL.body === cR.body;

    // First few changed body sections (headings / first non-empty changed line)
    const bodyDiff = diffLines(cL.body, cR.body);
    const changedSnippets: string[] = [];
    let lastHeading = "";
    for (const d of bodyDiff) {
      const trimmed = d.text.trim();
      if (d.kind === "eq") {
        if (/^#{1,6}\s+/.test(trimmed) || /^[A-Z][A-Z0-9 \-]{2,}$/.test(trimmed)) lastHeading = trimmed;
        continue;
      }
      if (!trimmed) continue;
      const label = lastHeading || "(top of body)";
      if (!changedSnippets.includes(label)) changedSnippets.push(label);
      if (changedSnippets.length >= 4) break;
    }

    const contentChanged = !bodyIdentical;
    const nothingChanged =
      metaChanges.length === 0 && tagsAdded.length === 0 && tagsRemoved.length === 0 && !contentChanged;

    return {
      metaChanges,
      tagsAdded,
      tagsRemoved,
      contentChanged,
      bodyLinesL,
      bodyLinesR,
      wordsL,
      wordsR,
      wordDelta,
      changedSnippets,
      nothingChanged,
      leftV: left.version,
      rightV: right.version,
    };
  }, [left, right]);


  async function revertRow(row: Row): Promise<{ ok: boolean; message: string }> {
    if (!projectId) return { ok: false, message: "no project" };
    const c = conceptOf(row);
    const result = await admit({
      project_id: projectId,
      concept: {
        type: c.type, title: c.title, status: c.status, risk: c.risk as "low" | "medium" | "critical",
        tags: c.tags, source: c.source ?? undefined,
        body: `<!-- reverted from v${row.version} @ ${new Date(row.updated_at).toISOString()} -->\n${c.body}`,
      },
    });
    if (result.verdict === "commit") return { ok: true, message: `committed as v${result.version}` };
    if (result.verdict === "escalate") return { ok: false, message: "escalated for admin review" };
    if (result.verdict === "reject") {
      return { ok: false, message: `rejected at ${result.stage}: ${result.message}` };
    }
    return { ok: false, message: result.message };
  }

  async function revertTo(row: Row) {
    setReverting(true);
    const res = await revertRow(row);
    if (res.ok) { toast.success(`Reverted to v${row.version} — ${res.message}`); await load(); }
    else if (res.message.startsWith("escalated")) toast.warning(res.message);
    else toast.error(res.message);
    setReverting(false);
  }

  // Bulk helpers
  const toggleSlot = (k: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  const clearBulk = () => { setSelected(new Set()); setBulkTargets({}); setBulkResults([]); };
  const selectAll = () => setSelected(new Set(slots.map(([k]) => k)));

  // Default target for a slot = the previous version (index 1), else current.
  const targetRowFor = (k: string): Row | undefined => {
    const entry = slots.find(([sk]) => sk === k)?.[1];
    if (!entry) return;
    const id = bulkTargets[k] ?? entry.versions[1]?.id ?? entry.versions[0]?.id;
    return entry.versions.find((v) => v.id === id);
  };
  const currentRowFor = (k: string): Row | undefined =>
    slots.find(([sk]) => sk === k)?.[1].versions.find((v) => v.is_current)
    ?? slots.find(([sk]) => sk === k)?.[1].versions[0];

  async function runBulkRevert() {
    setBulkReverting(true);
    setBulkResults([]);
    const out: { label: string; ok: boolean; message: string }[] = [];
    for (const k of selected) {
      const entry = slots.find(([sk]) => sk === k)?.[1];
      const target = targetRowFor(k);
      if (!entry || !target) { out.push({ label: k, ok: false, message: "no target version" }); continue; }
      if (target.is_current) { out.push({ label: entry.label, ok: false, message: `v${target.version} is already current` }); continue; }
      const res = await revertRow(target);
      out.push({ label: `${entry.label} → v${target.version}`, ok: res.ok, message: res.message });
    }
    setBulkResults(out);
    setBulkReverting(false);
    await load();
    const okCount = out.filter((r) => r.ok).length;
    if (okCount === out.length) toast.success(`Reverted ${okCount}/${out.length} concept${out.length === 1 ? "" : "s"}`);
    else if (okCount === 0) toast.error(`All ${out.length} reverts failed — see per-concept results`);
    else toast.warning(`Reverted ${okCount}/${out.length} — see per-concept results`);
  }


  // Consume `#okf-version=<artifactId>` hash → focus that slot + version.
  // Written by GateDecisionModal (and any other panel) when jumping to a
  // sibling snapshot referenced by a Φ/Ψ predicate.
  const [focusedRowId, setFocusedRowId] = useState<string>("");
  useEffect(() => {
    const applyHash = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(raw);
      const target = params.get("okf-version");
      if (!target) return;
      const row = rows.find((r) => r.id === target);
      if (!row) return;
      const c = conceptOf(row);
      const key = slotKey(c);
      setSlot(key);
      // Show the target as the "right" (newer) side; pick a left neighbor.
      setRightId(row.id);
      const siblings = rows.filter((r) => slotKey(conceptOf(r)) === key).sort((a, b) => b.version - a.version);
      const idx = siblings.findIndex((r) => r.id === row.id);
      const leftNeighbor = siblings[idx + 1] ?? siblings[idx - 1] ?? row;
      setLeftId(leftNeighbor.id);
      setFocusedRowId(row.id);
      // Auto-clear the highlight after a moment so it doesn't stick around.
      setTimeout(() => setFocusedRowId((prev) => (prev === row.id ? "" : prev)), 3500);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [rows]);

  if (!projectId) {
    return (
      <Card id="okf-version-history">
        <CardHeader><CardTitle className="font-display text-lg">OKF Version History</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Project not linked yet.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card id="okf-version-history">
      <CardHeader>
        <CardTitle className="font-display text-lg">OKF Version History</CardTitle>
        <p className="text-xs text-muted-foreground">
          Every admitted concept keeps its full lineage. Pick a concept, compare any two versions, or revert —
          reverts go through the same admission gate as any other change.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bulk actions */}
        {slots.length > 0 && (
          <div className="border border-border/40 rounded">
            <div className="px-3 py-2 border-b border-border/40 bg-muted/20 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">Bulk actions</span>
              <span className="text-[10px] text-muted-foreground">
                {selected.size} of {slots.length} concept{slots.length === 1 ? "" : "s"} selected
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={selectAll}>Select all</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={clearBulk} disabled={selected.size === 0}>Clear</Button>
                <Button
                  size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                  disabled={selected.size < 1}
                  onClick={() => setBulkCompareOpen((o) => !o)}
                >
                  {bulkCompareOpen ? "Hide compare" : "Compare selected"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="default" className="h-6 px-2 text-[10px]"
                      disabled={selected.size === 0 || bulkReverting}>
                      {bulkReverting ? "Reverting…" : `Revert ${selected.size || ""}`.trim()}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revert {selected.size} concept{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Each selected concept is re-admitted through the OKF gate at its chosen target version and
                        committed as a new current version. Any concept whose target is already current is skipped.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction disabled={bulkReverting} onClick={runBulkRevert}>
                        {bulkReverting ? "Reverting…" : "Revert all"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <ScrollArea className="max-h-[220px]">
              <ul className="divide-y divide-border/30">
                {slots.map(([k, v]) => {
                  const checked = selected.has(k);
                  const targetId = bulkTargets[k] ?? (v.versions[1]?.id ?? v.versions[0]?.id);
                  const target = v.versions.find((r) => r.id === targetId);
                  const current = v.versions.find((r) => r.is_current) ?? v.versions[0];
                  return (
                    <li key={k} className="px-3 py-2 flex items-center gap-2 flex-wrap text-xs">
                      <Checkbox checked={checked} onCheckedChange={() => toggleSlot(k)} aria-label={`Select ${v.label}`} />
                      <span className="font-medium truncate max-w-[240px]" title={v.label}>{v.label}</span>
                      <Badge variant="outline" className="text-[10px]">current v{current?.version}</Badge>
                      <span className="text-[10px] text-muted-foreground">→ target</span>
                      <Select
                        value={targetId ?? ""}
                        onValueChange={(val) => setBulkTargets((prev) => ({ ...prev, [k]: val }))}
                        disabled={!checked}
                      >
                        <SelectTrigger className="h-6 w-[140px] text-[11px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {v.versions.map((r) => (
                            <SelectItem key={r.id} value={r.id} className="text-[11px]">
                              v{r.version}{r.is_current ? " (current)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {checked && target && !target.is_current && current && target.id !== current.id && (() => {
                        const s = computeChangeSummary(current, target);
                        return (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {s.nothingChanged ? "identical" : (
                              <>
                                {s.metaChanges.length > 0 && <>meta ×{s.metaChanges.length} · </>}
                                {(s.tagsAdded.length + s.tagsRemoved.length) > 0 && <>tags +{s.tagsAdded.length}/−{s.tagsRemoved.length} · </>}
                                {s.bodyChanged && <>words {s.wordDelta >= 0 ? "+" : ""}{s.wordDelta}</>}
                              </>
                            )}
                          </span>
                        );
                      })()}
                      {checked && target?.is_current && (
                        <span className="text-[10px] text-muted-foreground ml-auto">already current · will be skipped</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
            {bulkCompareOpen && selected.size > 0 && (
              <div className="border-t border-border/40 p-3 space-y-2">
                <div className="text-xs font-medium">Compare summary · current → target</div>
                <ul className="space-y-2">
                  {[...selected].map((k) => {
                    const entry = slots.find(([sk]) => sk === k)?.[1];
                    if (!entry) return null;
                    const cur = currentRowFor(k);
                    const tgt = targetRowFor(k);
                    if (!cur || !tgt) return null;
                    const s = computeChangeSummary(cur, tgt);
                    return (
                      <li key={k} className="rounded border border-border/30 p-2 text-[11px] space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{entry.label}</span>
                          <span className="font-mono text-muted-foreground">v{s.leftV} → v{s.rightV}</span>
                          {s.nothingChanged && <Badge variant="outline" className="text-[10px]">identical</Badge>}
                        </div>
                        {!s.nothingChanged && (
                          <>
                            {s.metaChanges.length > 0 && (
                              <div>
                                <span className="text-muted-foreground">Metadata:</span>{" "}
                                {s.metaChanges.map((m, i) => (
                                  <span key={m.field} className="font-mono">
                                    {i > 0 && <span className="text-muted-foreground"> · </span>}
                                    {m.field}{" "}
                                    <span className="text-destructive">{m.from}</span>
                                    <span className="text-muted-foreground"> → </span>
                                    <span className="text-emerald-500">{m.to}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            {(s.tagsAdded.length > 0 || s.tagsRemoved.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1">
                                <span className="text-muted-foreground">Tags:</span>
                                {s.tagsAdded.map((t) => (
                                  <Badge key={`a-${t}`} variant="outline"
                                    className="text-[10px] border-emerald-500/40 text-emerald-500">+{t}</Badge>
                                ))}
                                {s.tagsRemoved.map((t) => (
                                  <Badge key={`r-${t}`} variant="outline"
                                    className="text-[10px] border-destructive/40 text-destructive line-through">{t}</Badge>
                                ))}
                              </div>
                            )}
                            {s.bodyChanged && (
                              <div>
                                <span className="text-muted-foreground">Body:</span>{" "}
                                <span className="font-mono">
                                  words{" "}
                                  <span className={s.wordDelta >= 0 ? "text-emerald-500" : "text-destructive"}>
                                    ({s.wordDelta >= 0 ? "+" : ""}{s.wordDelta})
                                  </span>
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {bulkResults.length > 0 && (
              <div className="border-t border-border/40 p-3 space-y-1">
                <div className="text-xs font-medium">Last bulk revert results</div>
                <ul className="text-[11px] space-y-0.5">
                  {bulkResults.map((r, i) => (
                    <li key={i} className={r.ok ? "text-emerald-500" : "text-destructive"}>
                      {r.ok ? "✓" : "✗"} {r.label} — {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-xs text-muted-foreground">loading versions…</p>
        ) : slots.length === 0 ? (
          <p className="text-xs text-muted-foreground">No OKF concepts yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3">
                <label className="text-xs text-muted-foreground mb-1 block">Concept</label>
                <Select value={slot} onValueChange={setSlot}>
                  <SelectTrigger><SelectValue placeholder="Pick a concept" /></SelectTrigger>
                  <SelectContent>
                    {slots.map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label} <span className="text-muted-foreground">· {v.versions.length} version{v.versions.length === 1 ? "" : "s"}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {active && (
              <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                {/* Version list */}
                <div className="border border-border/40 rounded">
                  <div className="px-3 py-2 text-xs font-medium border-b border-border/40 bg-muted/30">
                    {active.versions.length} versions
                  </div>
                  <ScrollArea className="h-[420px]">
                    <ul className="divide-y divide-border/40">
                      {active.versions.map((r) => {
                        const c = conceptOf(r);
                        const isL = r.id === leftId, isR = r.id === rightId;
                        return (
                          <li
                            key={r.id}
                            id={`okf-row-${r.id}`}
                            className={`p-2 space-y-1 transition-colors ${
                              focusedRowId === r.id ? "bg-primary/10 ring-2 ring-primary/50 rounded" : ""
                            }`}
                            ref={(el) => {
                              if (focusedRowId === r.id && el) {
                                el.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs tabular-nums">v{r.version}</span>
                              {r.is_current && <Badge variant="default" className="text-[10px]">current</Badge>}
                              <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
                              {c.risk !== "low" && <Badge variant="destructive" className="text-[10px]">{c.risk}</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {new Date(r.updated_at).toLocaleString()}
                            </div>
                            <div className="flex items-center gap-1 pt-1">
                              <Button
                                size="sm" variant={isL ? "default" : "outline"}
                                className="h-6 px-2 text-[10px]"
                                onClick={() => setLeftId(r.id)}
                              >Left</Button>
                              <Button
                                size="sm" variant={isR ? "default" : "outline"}
                                className="h-6 px-2 text-[10px]"
                                onClick={() => setRightId(r.id)}
                              >Right</Button>
                              {!r.is_current && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] ml-auto">Revert</Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Revert to v{r.version}?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This re-admits v{r.version} through the OKF gate and commits it as a new
                                        current version. The intermediate versions stay in history.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction disabled={reverting} onClick={() => revertTo(r)}>
                                        {reverting ? "Reverting…" : "Revert"}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                </div>

                {/* Diff */}
                <div className="border border-border/40 rounded flex flex-col">
                  <div className="px-3 py-2 border-b border-border/40 bg-muted/30 flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs">
                      Compare <span className="font-mono">v{left?.version ?? "?"}</span>
                      {" → "}
                      <span className="font-mono">v{right?.version ?? "?"}</span>
                      <span className="ml-3 text-emerald-500">+{stats.add}</span>
                      <span className="ml-2 text-destructive">−{stats.del}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant={diffTarget === "body" ? "default" : "outline"}
                        className="h-6 px-2 text-[10px]" onClick={() => setDiffTarget("body")}>Body</Button>
                      <Button size="sm" variant={diffTarget === "meta" ? "default" : "outline"}
                        className="h-6 px-2 text-[10px]" onClick={() => setDiffTarget("meta")}>Metadata</Button>
                    </div>
                  </div>
                  {summary && (
                    <div className="px-3 py-2 border-b border-border/40 bg-muted/10 text-[11px] space-y-1.5">
                      <div className="font-medium text-xs">
                        Change summary
                        <span className="text-muted-foreground font-normal">
                          {" "}· v{summary.leftV} → v{summary.rightV}
                        </span>
                      </div>
                      {summary.nothingChanged ? (
                        <div className="text-muted-foreground">No content or metadata changed between these versions.</div>
                      ) : (
                        <>
                          {summary.metaChanges.length > 0 && (
                            <div>
                              <span className="text-muted-foreground">Metadata:</span>{" "}
                              {summary.metaChanges.map((m, i) => (
                                <span key={m.field} className="font-mono">
                                  {i > 0 && <span className="text-muted-foreground"> · </span>}
                                  {m.field}{" "}
                                  <span className="text-destructive">{m.from}</span>
                                  <span className="text-muted-foreground"> → </span>
                                  <span className="text-emerald-500">{m.to}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          {(summary.tagsAdded.length > 0 || summary.tagsRemoved.length > 0) && (
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-muted-foreground">Tags:</span>
                              {summary.tagsAdded.map((t) => (
                                <Badge key={`a-${t}`} variant="outline"
                                  className="text-[10px] border-emerald-500/40 text-emerald-500">+{t}</Badge>
                              ))}
                              {summary.tagsRemoved.map((t) => (
                                <Badge key={`r-${t}`} variant="outline"
                                  className="text-[10px] border-destructive/40 text-destructive line-through">{t}</Badge>
                              ))}
                            </div>
                          )}
                          {summary.contentChanged ? (
                            <div>
                              <span className="text-muted-foreground">Body:</span>{" "}
                              <span className="font-mono">
                                {summary.bodyLinesL}→{summary.bodyLinesR} lines
                              </span>
                              <span className="text-muted-foreground"> · </span>
                              <span className="font-mono">
                                {summary.wordsL}→{summary.wordsR} words{" "}
                                <span className={summary.wordDelta >= 0 ? "text-emerald-500" : "text-destructive"}>
                                  ({summary.wordDelta >= 0 ? "+" : ""}{summary.wordDelta})
                                </span>
                              </span>
                              {summary.changedSnippets.length > 0 && (
                                <div className="mt-0.5 text-muted-foreground">
                                  changes near:{" "}
                                  {summary.changedSnippets.map((s, i) => (
                                    <span key={i} className="font-mono text-foreground">
                                      {i > 0 && <span className="text-muted-foreground">, </span>}
                                      {s.length > 60 ? s.slice(0, 60) + "…" : s}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-muted-foreground">Body unchanged.</div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <ScrollArea className="h-[420px]">

                    <pre className="text-[11px] font-mono leading-relaxed p-3">
                      {diff.length === 0 ? (
                        <span className="text-muted-foreground">No differences.</span>
                      ) : diff.map((d, i) => {
                        const bg = d.kind === "add" ? "bg-emerald-500/10 text-emerald-200"
                                 : d.kind === "del" ? "bg-destructive/10 text-red-200"
                                 : "";
                        const sig = d.kind === "add" ? "+" : d.kind === "del" ? "−" : " ";
                        return (
                          <div key={i} className={`px-2 ${bg}`}>
                            <span className="opacity-50 select-none pr-2">{sig}</span>
                            {d.text || " "}
                          </div>
                        );
                      })}
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
