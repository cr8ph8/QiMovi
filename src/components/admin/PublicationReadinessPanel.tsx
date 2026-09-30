import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Gavel, Rss, LayoutTemplate, RotateCcw, Loader2, Layers } from "lucide-react";
import { toast } from "sonner";

interface UnadmittedRow {
  surface: string;
  record_id: string;
  label: string;
  pending: number;
  reject: number;
  escalate: number;
  damp: number;
  is_published: boolean;
}

interface LedgerEvent {
  id: string;
  event_type: string;
  created_at: string;
  metadata_json: Record<string, any>;
}

type BulkFilter = "none" | "damp" | "reject";

interface BulkProgress {
  key: string;
  label: string;
  status: "pending" | "ok" | "error";
  message?: string;
}

export default function PublicationReadinessPanel() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UnadmittedRow[]>([]);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [recordLabels, setRecordLabels] = useState<Record<string, string>>({});
  const [approverProfiles, setApproverProfiles] = useState<Record<string, string>>({});
  const [feedType, setFeedType] = useState<"all" | "publication_rolled_back" | "publication_admitted" | "publication_claim_decision">("all");
  const [feedSort, setFeedSort] = useState<"newest" | "approver" | "target">("newest");
  const [rollbackTarget, setRollbackTarget] = useState<UnadmittedRow | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollingBack, setRollingBack] = useState(false);

  // Bulk state
  const [bulkFilter, setBulkFilter] = useState<BulkFilter>("none");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: claims }, { data: news }, { data: cl }, { data: ev }] = await Promise.all([
      supabase
        .from("publication_claims" as any)
        .select("surface, record_id, decision")
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase.from("news_articles" as any).select("id, title, status"),
      supabase.from("changelog_releases" as any).select("id, title, version, is_published"),
      supabase
        .from("governance_events" as any)
        .select("id, event_type, created_at, metadata_json")
        .in("event_type", [
          "publication_admitted",
          "publication_claim_decision",
          "publication_rolled_back",
        ])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const byKey = new Map<string, UnadmittedRow>();
    const meta = (surface: string, id: string) => {
      if (surface === "news_article") {
        const n = (news as any[])?.find((a) => a.id === id);
        return {
          label: n ? `${n.title} [${n.status}]` : id,
          is_published: n?.status === "published",
        };
      }
      if (surface === "changelog_release") {
        const c = (cl as any[])?.find((r) => r.id === id);
        return {
          label: c ? `${c.version} — ${c.title}` : id,
          is_published: !!c?.is_published,
        };
      }
      return { label: `landing_page: ${id}`, is_published: false };
    };
    for (const c of (claims as any[]) ?? []) {
      const key = `${c.surface}:${c.record_id}`;
      const m = meta(c.surface, c.record_id);
      const row = byKey.get(key) ?? {
        surface: c.surface,
        record_id: c.record_id,
        label: m.label,
        pending: 0,
        reject: 0,
        escalate: 0,
        damp: 0,
        is_published: m.is_published,
      };
      if (c.decision === "PENDING") row.pending += 1;
      if (c.decision === "REJECT") row.reject += 1;
      if (c.decision === "ESCALATE") row.escalate += 1;
      if (c.decision === "DAMP") row.damp += 1;
      byKey.set(key, row);
    }
    setRows(
      [...byKey.values()].filter(
        (r) => r.pending + r.reject + r.escalate + r.damp > 0,
      ),
    );
    const evList = ((ev as any[]) ?? []) as LedgerEvent[];
    setEvents(evList);

    // Build a label map covering every record referenced by an event so the
    // feed can sort by human-readable target instead of a raw UUID.
    const labels: Record<string, string> = {};
    for (const [key, row] of byKey.entries()) labels[key] = row.label;
    for (const n of ((news as any[]) ?? [])) {
      labels[`news_article:${n.id}`] = `${n.title} [${n.status}]`;
    }
    for (const c of ((cl as any[]) ?? [])) {
      labels[`changelog_release:${c.id}`] = `${c.version} — ${c.title}`;
    }
    setRecordLabels(labels);

    // Resolve approver user_ids to display names in one round-trip.
    const approverIds = Array.from(
      new Set(
        evList
          .map((e) =>
            e.metadata_json?.rolled_back_by ??
            e.metadata_json?.restored_by ??
            e.metadata_json?.admitted_by ??
            e.metadata_json?.decided_by ??
            null,
          )
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );
    if (approverIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles" as any)
        .select("id, display_name")
        .in("id", approverIds);
      const map: Record<string, string> = {};
      for (const p of ((profs as any[]) ?? [])) {
        map[p.id] = p.display_name || p.id.slice(0, 8);
      }
      setApproverProfiles(map);
    } else {
      setApproverProfiles({});
    }

    setLoading(false);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canRollback = (r: UnadmittedRow) =>
    r.surface !== "landing_page" && r.is_published && (r.damp > 0 || r.reject > 0);

  const rowMatchesFilter = (r: UnadmittedRow) => {
    if (!canRollback(r)) return false;
    if (bulkFilter === "damp") return r.damp > 0;
    if (bulkFilter === "reject") return r.reject > 0;
    return false;
  };

  const bulkEligibleRows = useMemo(
    () => rows.filter(rowMatchesFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, bulkFilter],
  );

  const toggleSelected = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllEligible = () => {
    setSelected(new Set(bulkEligibleRows.map((r) => `${r.surface}:${r.record_id}`)));
  };
  const clearSelection = () => setSelected(new Set());

  const runRollback = async () => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      const { data, error } = await supabase.functions.invoke("publication-gate", {
        body: {
          action: "rollback",
          surface: rollbackTarget.surface,
          record_id: rollbackTarget.record_id,
          reason: rollbackReason.trim() || `Auto-rollback: ${rollbackTarget.reject > 0 ? "REJECT" : "DAMP"} decision`,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Rolled back ${rollbackTarget.label}`);
      setRollbackTarget(null);
      setRollbackReason("");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  };

  const runBulkRollback = async () => {
    const targets = bulkEligibleRows.filter((r) =>
      selected.has(`${r.surface}:${r.record_id}`),
    );
    if (targets.length === 0) return;
    const reason =
      bulkReason.trim() ||
      `Bulk ${bulkFilter.toUpperCase()} rollback (${targets.length} record${targets.length === 1 ? "" : "s"})`;

    setBulkRunning(true);
    setBulkProgress(
      targets.map((r) => ({
        key: `${r.surface}:${r.record_id}`,
        label: r.label,
        status: "pending",
      })),
    );

    let ok = 0;
    let failed = 0;
    // Sequential to keep the ledger ordered and avoid rate-limit spikes.
    for (const t of targets) {
      const key = `${t.surface}:${t.record_id}`;
      try {
        const { data, error } = await supabase.functions.invoke("publication-gate", {
          body: {
            action: "rollback",
            surface: t.surface,
            record_id: t.record_id,
            reason,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        ok += 1;
        setBulkProgress((prev) =>
          prev.map((p) => (p.key === key ? { ...p, status: "ok" } : p)),
        );
      } catch (e: any) {
        failed += 1;
        setBulkProgress((prev) =>
          prev.map((p) =>
            p.key === key
              ? { ...p, status: "error", message: e?.message || "failed" }
              : p,
          ),
        );
      }
    }

    setBulkRunning(false);
    if (failed === 0) {
      toast.success(`Rolled back ${ok} record${ok === 1 ? "" : "s"}`);
      setBulkOpen(false);
      setBulkReason("");
      setBulkAck(false);
      setBulkProgress([]);
      await load();
    } else {
      toast.error(`${ok} rolled back, ${failed} failed — see progress list`);
      await load();
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const iconFor = (surface: string) =>
    surface === "news_article" ? Rss : surface === "landing_page" ? LayoutTemplate : Gavel;

  const dampCandidates = rows.filter((r) => canRollback(r) && r.damp > 0).length;
  const rejectCandidates = rows.filter((r) => canRollback(r) && r.reject > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Unadmitted publications ({rows.length})
          </h3>
          <div className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground mr-1">Bulk:</span>
            <Button
              size="sm"
              variant={bulkFilter === "none" ? "secondary" : "outline"}
              className="h-6 text-[10px] px-2"
              onClick={() => {
                setBulkFilter("none");
                clearSelection();
              }}
            >
              Off
            </Button>
            <Button
              size="sm"
              variant={bulkFilter === "damp" ? "secondary" : "outline"}
              className="h-6 text-[10px] px-2 text-amber-400"
              onClick={() => {
                setBulkFilter("damp");
                clearSelection();
              }}
              disabled={dampCandidates === 0}
            >
              DAMP · {dampCandidates}
            </Button>
            <Button
              size="sm"
              variant={bulkFilter === "reject" ? "secondary" : "outline"}
              className="h-6 text-[10px] px-2 text-red-400"
              onClick={() => {
                setBulkFilter("reject");
                clearSelection();
              }}
              disabled={rejectCandidates === 0}
            >
              REJECT · {rejectCandidates}
            </Button>
          </div>
        </div>

        {bulkFilter !== "none" && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-[11px]">
            <span className="text-muted-foreground">
              Selecting {bulkFilter.toUpperCase()} rollback candidates. {selected.size} of{" "}
              {bulkEligibleRows.length} selected.
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={selectAllEligible}
                disabled={bulkEligibleRows.length === 0}
              >
                Select all
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={clearSelection}
                disabled={selected.size === 0}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-6 text-[10px]"
                disabled={selected.size === 0}
                onClick={() => {
                  setBulkReason("");
                  setBulkAck(false);
                  setBulkProgress([]);
                  setBulkOpen(true);
                }}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Rollback selected ({selected.size})
              </Button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            All extracted claims across news, changelog, and landing surfaces are resolved.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const Icon = iconFor(r.surface);
              const rollbackable = canRollback(r);
              const key = `${r.surface}:${r.record_id}`;
              const eligible = rowMatchesFilter(r);
              const showCheckbox = bulkFilter !== "none" && eligible;
              return (
                <Card key={key} className="p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {showCheckbox && (
                        <Checkbox
                          checked={selected.has(key)}
                          onCheckedChange={() => toggleSelected(key)}
                          className="shrink-0"
                        />
                      )}
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm truncate">{r.label}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">
                          {r.surface}
                          {r.is_published && " • live"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {r.pending > 0 && (
                        <Badge variant="outline" className="text-[10px]">{r.pending} pending</Badge>
                      )}
                      {r.damp > 0 && (
                        <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">
                          {r.damp} damp
                        </Badge>
                      )}
                      {r.reject > 0 && (
                        <Badge variant="outline" className="text-[10px] text-red-400 border-red-500/30">
                          {r.reject} reject
                        </Badge>
                      )}
                      {r.escalate > 0 && (
                        <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-500/30">
                          {r.escalate} escalate
                        </Badge>
                      )}
                      {rollbackable && bulkFilter === "none" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => {
                            setRollbackTarget(r);
                            setRollbackReason("");
                          }}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Rollback
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Governance feed
          </h3>
          <div className="flex flex-wrap items-center gap-1">
            {([
              ["all", "All", null],
              ["publication_rolled_back", "Rolled back", "text-red-400"],
              ["publication_admitted", "Admitted", "text-emerald-400"],
              ["publication_claim_decision", "Decisions", "text-amber-400"],
            ] as const).map(([val, label, tone]) => (
              <Button
                key={val}
                size="sm"
                variant={feedType === val ? "secondary" : "outline"}
                className={`h-6 text-[10px] px-2 ${tone ?? ""}`}
                onClick={() => setFeedType(val)}
              >
                {label}
              </Button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-2 mr-1">Sort:</span>
            {([
              ["newest", "Newest"],
              ["approver", "Approver"],
              ["target", "Target"],
            ] as const).map(([val, label]) => (
              <Button
                key={val}
                size="sm"
                variant={feedSort === val ? "secondary" : "outline"}
                className="h-6 text-[10px] px-2"
                onClick={() => setFeedSort(val)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {(() => {
          const filtered = events
            .filter((e) => feedType === "all" || e.event_type === feedType)
            .map((e) => {
              const approverId =
                e.metadata_json?.rolled_back_by ??
                e.metadata_json?.restored_by ??
                e.metadata_json?.admitted_by ??
                e.metadata_json?.decided_by ??
                null;
              const approver = approverId
                ? approverProfiles[approverId] ?? approverId.slice(0, 8)
                : "—";
              const surface = e.metadata_json?.surface ?? "—";
              const recordId = e.metadata_json?.record_id ?? "—";
              const targetKey = `${surface}:${recordId}`;
              const targetLabel = recordLabels[targetKey] ?? recordId;
              return { e, approver, approverId, surface, recordId, targetLabel };
            });

          const sorted = [...filtered].sort((a, b) => {
            if (feedSort === "approver") {
              const cmp = a.approver.localeCompare(b.approver);
              if (cmp !== 0) return cmp;
            } else if (feedSort === "target") {
              const cmp = a.targetLabel.localeCompare(b.targetLabel);
              if (cmp !== 0) return cmp;
            }
            return b.e.created_at.localeCompare(a.e.created_at);
          });

          if (sorted.length === 0) {
            return (
              <p className="text-xs text-muted-foreground">
                No events match the current filter.
              </p>
            );
          }

          return (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground">
                {sorted.length} event{sorted.length === 1 ? "" : "s"}
                {feedType !== "all" ? ` · ${feedType}` : ""} · sorted by {feedSort}
              </p>
              {sorted.map(({ e, approver, targetLabel, surface, recordId }) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-border/40 bg-card/20"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-mono flex items-center gap-1.5 flex-wrap">
                      {e.event_type}
                      {e.event_type === "publication_rolled_back" && (
                        <Badge variant="destructive" className="text-[9px]">rollback</Badge>
                      )}
                      {e.event_type === "publication_admitted" && (
                        <Badge
                          variant="outline"
                          className="text-[9px] text-emerald-400 border-emerald-500/30"
                        >
                          admit
                        </Badge>
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      <span className="font-mono">{surface}</span> · {targetLabel}
                      {recordId !== "—" && recordId !== targetLabel && (
                        <span className="font-mono text-muted-foreground/60">
                          {" "}
                          ({String(recordId).slice(0, 8)})
                        </span>
                      )}
                      {e.metadata_json?.reason ? ` · ${e.metadata_json.reason}` : ""}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      approver:{" "}
                      <span className="font-mono text-foreground/80">{approver}</span>
                      {e.metadata_json?.reason_code && (
                        <>
                          {" "}
                          · code:{" "}
                          <span className="font-mono">{e.metadata_json.reason_code}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>


      <AlertDialog
        open={!!rollbackTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRollbackTarget(null);
            setRollbackReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Rollback publication
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Revert{" "}
                  <span className="font-mono text-foreground">{rollbackTarget?.label}</span> to
                  draft. This appends a{" "}
                  <span className="font-mono">publication_rolled_back</span> event to the
                  governance ledger.
                </p>
                {rollbackTarget && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {rollbackTarget.reject > 0 && (
                      <Badge variant="outline" className="text-red-400 border-red-500/30">
                        {rollbackTarget.reject} REJECT
                      </Badge>
                    )}
                    {rollbackTarget.damp > 0 && (
                      <Badge variant="outline" className="text-amber-400 border-amber-500/30">
                        {rollbackTarget.damp} DAMP
                      </Badge>
                    )}
                  </div>
                )}
                <Textarea
                  placeholder="Reason (optional — recorded on the ledger event)"
                  value={rollbackReason}
                  onChange={(e) => setRollbackReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runRollback();
              }}
              disabled={rollingBack}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {rollingBack ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Rolling back…
                </>
              ) : (
                "Confirm rollback"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk rollback dialog */}
      <AlertDialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open && !bulkRunning) {
            setBulkOpen(false);
            setBulkReason("");
            setBulkAck(false);
            setBulkProgress([]);
          }
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Bulk rollback ({selected.size} {bulkFilter.toUpperCase()})
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each record is reverted to draft with the same reason. One{" "}
              <span className="font-mono">publication_rolled_back</span> event is appended per
              record. Executed sequentially.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="max-h-48 overflow-auto rounded border border-border/40 bg-muted/10 p-2 space-y-1">
              {bulkEligibleRows
                .filter((r) => selected.has(`${r.surface}:${r.record_id}`))
                .map((r) => {
                  const key = `${r.surface}:${r.record_id}`;
                  const p = bulkProgress.find((x) => x.key === key);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="truncate">
                        <span className="font-mono text-muted-foreground">{r.surface}</span>{" "}
                        · {r.label}
                      </span>
                      {p ? (
                        p.status === "pending" ? (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        ) : p.status === "ok" ? (
                          <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-500/30">
                            done
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[9px] text-red-400 border-red-500/30"
                            title={p.message}
                          >
                            failed
                          </Badge>
                        )
                      ) : (
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${
                            bulkFilter === "damp"
                              ? "text-amber-400 border-amber-500/30"
                              : "text-red-400 border-red-500/30"
                          }`}
                        >
                          {bulkFilter === "damp" ? `${r.damp} DAMP` : `${r.reject} REJECT`}
                        </Badge>
                      )}
                    </div>
                  );
                })}
            </div>

            <Textarea
              placeholder={`Reason recorded on every event (optional — defaults to "Bulk ${bulkFilter.toUpperCase()} rollback")`}
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={bulkRunning}
            />

            <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 cursor-pointer">
              <Checkbox
                checked={bulkAck}
                onCheckedChange={(v) => setBulkAck(!!v)}
                disabled={bulkRunning}
                className="mt-0.5"
              />
              <span className="text-xs text-muted-foreground leading-snug">
                I reviewed the {selected.size} record{selected.size === 1 ? "" : "s"} above and
                confirm they all share the {bulkFilter.toUpperCase()} decision that justifies
                rollback.
              </span>
            </label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runBulkRollback();
              }}
              disabled={bulkRunning || !bulkAck || selected.size === 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkRunning ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Rolling back{" "}
                  {bulkProgress.filter((p) => p.status !== "pending").length}/
                  {bulkProgress.length}…
                </>
              ) : (
                `Roll back ${selected.size} record${selected.size === 1 ? "" : "s"}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
