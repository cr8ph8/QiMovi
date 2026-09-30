import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowLeftRight, Minus, Plus, Pencil, RotateCcw, Loader2 } from "lucide-react";
import type { PublicationSurface } from "@/lib/publication/claimExtraction";
import { computeWordDiff, type WordSegment } from "@/lib/diff";
import { hashCanonical } from "@/lib/query/canonical";
import { ReceiptTrail, type ReceiptEntry } from "@/components/evidence/ReceiptTrail";

function InlineWordDiff({
  from,
  to,
  mode,
  className,
}: {
  from: string;
  to: string;
  mode: "from" | "to";
  className?: string;
}) {
  const segs: WordSegment[] = computeWordDiff(from ?? "", to ?? "");
  return (
    <span className={className}>
      {segs.map((seg, i) => {
        if (seg.type === "equal") return <span key={i}>{seg.text}</span>;
        if (mode === "from" && seg.type === "remove") {
          return (
            <span key={i} className="bg-red-500/25 text-red-200 rounded-sm px-0.5 line-through decoration-red-400/60">
              {seg.text}
            </span>
          );
        }
        if (mode === "to" && seg.type === "add") {
          return (
            <span key={i} className="bg-emerald-500/25 text-emerald-200 rounded-sm px-0.5">
              {seg.text}
            </span>
          );
        }
        return null;
      })}
    </span>
  );
}

interface ClaimRow {
  id: string;
  record_version: number;
  claim_text: string;
  claim_kind: string;
  decision: string;
  evidence_url: string | null;
  evidence_note: string | null;
}

interface VersionMeta {
  version: number;
  claim_count: number;
  content_hash: string | null;
  decided_count: number;
  last_activity_at: string | null;
  admitted?: boolean;
  admitted_at?: string | null;
}

interface DiffPayload {
  from_version: number;
  to_version: number;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  added: ClaimRow[];
  removed: ClaimRow[];
  changed: Array<{ from: ClaimRow; to: ClaimRow }>;
  unchanged: ClaimRow[];
}

interface Props {
  surface: PublicationSurface;
  recordId: string;
  currentVersion: number | null;
  onRestored?: (newVersion: number) => void;
}

const KIND_COLORS: Record<string, string> = {
  factual: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  metric: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  offer: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  testimonial: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  authority: "bg-primary/15 text-primary border-primary/30",
  scarcity: "bg-red-500/15 text-red-400 border-red-500/30",
  copy: "bg-muted/50 text-muted-foreground border-border/50",
};

function ClaimBlock({
  claim,
  tone,
  highlightField,
  counterpart,
}: {
  claim: ClaimRow;
  tone: "added" | "removed" | "unchanged" | "changed-from" | "changed-to";
  highlightField?: { decision?: boolean; evidence_url?: boolean; evidence_note?: boolean; claim_kind?: boolean; claim_text?: boolean };
  counterpart?: ClaimRow;
}) {
  const toneClasses: Record<typeof tone, string> = {
    added: "border-emerald-500/40 bg-emerald-500/5",
    removed: "border-red-500/40 bg-red-500/5 opacity-90",
    unchanged: "border-border/40 bg-muted/10",
    "changed-from": "border-amber-500/30 bg-amber-500/5",
    "changed-to": "border-amber-500/50 bg-amber-500/10",
  };
  const hl = (on?: boolean) =>
    on ? "bg-amber-500/25 text-amber-100 px-1 rounded-sm" : "";

  // For paired changes, render inline word-level diffs so the exact edited
  // spans are visible inside the text and evidence fields — not just a chip.
  const diffMode: "from" | "to" | null =
    tone === "changed-from" ? "from" : tone === "changed-to" ? "to" : null;

  const renderText = (value: string, counter: string | undefined, changed: boolean | undefined, base: string) => {
    if (diffMode && changed && counter != null) {
      return (
        <InlineWordDiff
          from={diffMode === "from" ? value : counter}
          to={diffMode === "from" ? counter : value}
          mode={diffMode}
          className={base}
        />
      );
    }
    return <span className={`${base} ${hl(changed)}`}>{value}</span>;
  };

  const evidenceNoteVisible = claim.evidence_note && !claim.evidence_note.startsWith("content:");
  const counterEvidenceNoteVisible =
    counterpart?.evidence_note && !counterpart.evidence_note.startsWith("content:");

  return (
    <div className={`rounded-md border p-3 text-xs space-y-1.5 ${toneClasses[tone]}`}>
      <p className="text-sm leading-snug">
        {renderText(claim.claim_text, counterpart?.claim_text, highlightField?.claim_text, "")}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="outline" className={`${KIND_COLORS[claim.claim_kind]} ${hl(highlightField?.claim_kind)}`}>
          {claim.claim_kind}
        </Badge>
        <Badge variant="outline" className={`text-[10px] ${hl(highlightField?.decision)}`}>
          {claim.decision}
        </Badge>
      </div>
      {claim.evidence_url && (
        <p className="font-mono text-[10px] break-all text-muted-foreground">
          →{" "}
          {renderText(
            claim.evidence_url,
            counterpart?.evidence_url ?? "",
            highlightField?.evidence_url,
            "",
          )}
        </p>
      )}
      {evidenceNoteVisible && (
        <p className="text-[10px] text-muted-foreground italic">
          {renderText(
            claim.evidence_note ?? "",
            counterEvidenceNoteVisible ? counterpart!.evidence_note! : "",
            highlightField?.evidence_note,
            "",
          )}
        </p>
      )}
    </div>
  );
}


export default function ClaimVersionDiff({ surface, recordId, currentVersion, onRestored }: Props) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [latestAdmittedVersion, setLatestAdmittedVersion] = useState<number | null>(null);
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [toVersion, setToVersion] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffPayload | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<string>("");
  const [reasonNotes, setReasonNotes] = useState("");
  const [reviewedAck, setReviewedAck] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [search, setSearch] = useState("");
  const [overrideConflicts, setOverrideConflicts] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [restoreResult, setRestoreResult] = useState<{
    new_version: number;
    correlation_id: string | null;
    at: string;
    from_version: number;
    preview_hash: string | null;
  } | null>(null);
  const [relatedEvents, setRelatedEvents] = useState<
    Array<{ id: string; event_type: string; event_status: string; created_at: string; correlation_id: string | null }>
  >([]);
  const [relatedAudits, setRelatedAudits] = useState<
    Array<{ id: string; action: string; created_at: string; details: Record<string, unknown> | null }>
  >([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  interface RestoreHistoryRow {
    id: string;
    created_at: string;
    correlation_id: string | null;
    from_version: number | null;
    new_version: number | null;
    reason_code: string | null;
    reason_notes: string | null;
    reason: string | null;
    restored_by: string | null;
    conflict_override: boolean | null;
    conflict_override_reason: string | null;
  }
  const [restoreHistory, setRestoreHistory] = useState<RestoreHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [previewHash, setPreviewHash] = useState<string | null>(null);

  // Compute a deterministic checksum of the exact diff being previewed so the
  // reviewer can confirm the payload they acknowledged is the same one restored.
  useEffect(() => {
    let cancelled = false;
    if (!diff) {
      setPreviewHash(null);
      return () => {
        cancelled = true;
      };
    }
    const project = (c: ClaimRow) => ({
      id: c.id,
      v: c.record_version,
      t: c.claim_text,
      k: c.claim_kind,
      d: c.decision,
      u: c.evidence_url ?? null,
      n: c.evidence_note ?? null,
    });
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    const payload = {
      from: diff.from_version,
      to: diff.to_version,
      counts: diff.counts,
      added: [...diff.added].sort(byId).map(project),
      removed: [...diff.removed].sort(byId).map(project),
      changed: [...diff.changed]
        .sort((a, b) => a.from.id.localeCompare(b.from.id))
        .map(({ from, to }) => ({ from: project(from), to: project(to) })),
      unchanged: [...diff.unchanged].sort(byId).map(project),
    };
    hashCanonical(payload)
      .then((h) => {
        if (!cancelled) setPreviewHash(h);
      })
      .catch(() => {
        if (!cancelled) setPreviewHash(null);
      });
    return () => {
      cancelled = true;
    };
  }, [diff]);
  type ChangeFilter = "all" | "changed" | "added" | "removed" | "new_or_removed";
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");

  const matchesQuery = (c: ClaimRow | undefined, q: string): boolean => {
    if (!c) return false;
    const hay = [
      c.claim_text,
      c.claim_kind,
      c.decision,
      c.evidence_url ?? "",
      c.evidence_note ?? "",
    ]
      .join(" \u241f ")
      .toLowerCase();
    return hay.includes(q);
  };

  const filteredDiff = useMemo(() => {
    if (!diff) return null;
    const q = search.trim().toLowerCase();
    const bySearch = <T,>(arr: T[], pred: (t: T) => boolean) =>
      q ? arr.filter(pred) : arr;
    const showAdded = changeFilter === "all" || changeFilter === "added" || changeFilter === "new_or_removed";
    const showRemoved = changeFilter === "all" || changeFilter === "removed" || changeFilter === "new_or_removed";
    const showChanged = changeFilter === "all" || changeFilter === "changed";
    const showUnchanged = changeFilter === "all";
    return {
      ...diff,
      added: showAdded ? bySearch(diff.added, (c) => matchesQuery(c, q)) : [],
      removed: showRemoved ? bySearch(diff.removed, (c) => matchesQuery(c, q)) : [],
      changed: showChanged
        ? bySearch(diff.changed, ({ from, to }) => matchesQuery(from, q) || matchesQuery(to, q))
        : [],
      unchanged: showUnchanged ? bySearch(diff.unchanged, (c) => matchesQuery(c, q)) : [],
    };
  }, [diff, search, changeFilter]);


  const matchCount = filteredDiff
    ? filteredDiff.added.length +
      filteredDiff.removed.length +
      filteredDiff.changed.length +
      filteredDiff.unchanged.length
    : 0;

  // Validate the from-version snapshot: catch duplicates and internally
  // conflicting master fields (same claim_text with different kind / decision,
  // same evidence_url with different decisions) before we clone it forward.
  type Conflict = {
    kind: "duplicate_text" | "kind_mismatch" | "decision_mismatch" | "evidence_decision_mismatch";
    label: string;
    detail: string;
    sampleText: string;
  };

  const fromClaimsForValidation: ClaimRow[] = useMemo(() => {
    if (!diff) return [];
    return [
      ...diff.removed,
      ...diff.changed.map(({ from }) => from),
      ...diff.unchanged,
    ];
  }, [diff]);

  const validation = useMemo<{ conflicts: Conflict[]; hasBlocking: boolean }>(() => {
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const byText = new Map<string, ClaimRow[]>();
    const byEvidence = new Map<string, ClaimRow[]>();
    for (const c of fromClaimsForValidation) {
      const t = norm(c.claim_text);
      if (t) {
        const list = byText.get(t) ?? [];
        list.push(c);
        byText.set(t, list);
      }
      const ev = (c.evidence_url ?? "").trim().toLowerCase();
      if (ev) {
        const list = byEvidence.get(ev) ?? [];
        list.push(c);
        byEvidence.set(ev, list);
      }
    }
    const conflicts: Conflict[] = [];
    for (const [, rows] of byText) {
      if (rows.length < 2) continue;
      const kinds = new Set(rows.map((r) => r.claim_kind));
      const decisions = new Set(rows.map((r) => r.decision));
      const sample = rows[0].claim_text.slice(0, 120);
      if (kinds.size > 1) {
        conflicts.push({
          kind: "kind_mismatch",
          label: "Same claim, different kinds",
          detail: `Kinds: ${Array.from(kinds).join(", ")}`,
          sampleText: sample,
        });
      }
      if (decisions.size > 1) {
        conflicts.push({
          kind: "decision_mismatch",
          label: "Same claim, contradictory decisions",
          detail: `Decisions: ${Array.from(decisions).join(", ")}`,
          sampleText: sample,
        });
      }
      if (kinds.size === 1 && decisions.size === 1) {
        conflicts.push({
          kind: "duplicate_text",
          label: `Duplicate claim text (×${rows.length})`,
          detail: "Identical master fields — will produce redundant rows.",
          sampleText: sample,
        });
      }
    }
    for (const [ev, rows] of byEvidence) {
      const decisions = new Set(rows.map((r) => r.decision));
      if (decisions.size > 1) {
        conflicts.push({
          kind: "evidence_decision_mismatch",
          label: "Same evidence URL, contradictory decisions",
          detail: `${ev} → ${Array.from(decisions).join(", ")}`,
          sampleText: rows[0].claim_text.slice(0, 120),
        });
      }
    }
    // Blocking = any non-pure-duplicate conflict. Pure duplicates warn but
    // still block override-less confirm to force reviewer intent.
    const hasBlocking = conflicts.length > 0;
    return { conflicts, hasBlocking };
  }, [fromClaimsForValidation]);

  const overrideOk =
    !validation.hasBlocking || (overrideConflicts && overrideReason.trim().length >= 8);



  const REASON_TEMPLATES: Array<{ code: string; label: string; summary: string; requiresNotes?: boolean }> = [
    { code: "DAMP_UNSUPPORTED", label: "DAMP — unsupported claims", summary: "Restore prior version because current claims lack evidence and should be softened." },
    { code: "REJECT_FABRICATED", label: "REJECT — fabricated content", summary: "Restore prior version because current claims are fabricated or hallucinated." },
    { code: "REJECT_POLICY", label: "REJECT — policy violation", summary: "Restore prior version because current claims violate editorial or platform policy." },
    { code: "REJECT_LEGAL", label: "REJECT — legal / IP risk", summary: "Restore prior version because current claims raise legal, defamation, or IP concerns." },
    { code: "REVERT_ACCIDENTAL_COMMIT", label: "Revert — accidental commit", summary: "Restore prior version because the latest commit was accidental or premature." },
    { code: "OTHER", label: "Other (notes required)", summary: "", requiresNotes: true },
  ];
  const selectedTemplate = REASON_TEMPLATES.find((t) => t.code === reasonCode);
  const composedReason = selectedTemplate
    ? [selectedTemplate.label, reasonNotes.trim() ? `— ${reasonNotes.trim()}` : selectedTemplate.summary]
        .filter(Boolean)
        .join(" ")
    : "";
  const NOTES_MIN = 12;
  const NOTES_MAX = 500;
  const trimmedNotes = reasonNotes.trim();
  const notesLen = trimmedNotes.length;
  const notesRequired = !!selectedTemplate?.requiresNotes;
  const notesTooShort =
    (notesRequired && notesLen < NOTES_MIN) ||
    (!notesRequired && notesLen > 0 && notesLen < NOTES_MIN);
  const notesTooLong = notesLen > NOTES_MAX;
  const notesOk = !notesTooShort && !notesTooLong;
  const reasonOk = !!selectedTemplate && composedReason.length >= 4 && notesOk;

  const latestVersion = versions[0]?.version ?? null;
  const latestAdmittedMeta = versions.find((v) => v.version === latestAdmittedVersion) ?? null;
  const blockedByApproved =
    fromVersion != null &&
    latestAdmittedVersion != null &&
    latestAdmittedVersion > fromVersion;
  const canRestore =
    fromVersion != null &&
    latestVersion != null &&
    fromVersion < latestVersion &&
    !blockedByApproved;

  const runRestore = async () => {
    if (!canRestore || fromVersion == null) return;
    if (!reasonOk) {
      toast.error(
        `Pick a reason template and ensure notes are ${NOTES_MIN}–${NOTES_MAX} chars${notesRequired ? "" : " (or blank)"}.`,
      );
      return;
    }
    if (validation.hasBlocking && !overrideOk) {
      toast.error("Validation conflicts detected — check the override and provide a reason (≥ 8 chars).");
      return;
    }
    setRestoring(true);
    try {
      const { data, error } = await supabase.functions.invoke("publication-gate", {
        body: {
          action: "restore_version",
          surface,
          record_id: recordId,
          from_version: fromVersion,
          reason: composedReason,
          reason_code: reasonCode,
          reason_notes: reasonNotes.trim() || null,
          preview_hash: previewHash,
          conflict_override: validation.hasBlocking ? true : false,
          conflict_override_reason: validation.hasBlocking ? overrideReason.trim() : null,
          conflict_summary: validation.hasBlocking
            ? validation.conflicts.map((c) => `${c.kind}:${c.label}`)
            : null,
        },
      });
      if (error) throw error;
      const payload = data as { new_version?: number; correlation_id?: string; error?: string };
      if (payload?.error) throw new Error(payload.error);
      toast.success(`Restored v${fromVersion} → new v${payload.new_version}`);

      // Capture success context and keep the dialog open so the reviewer can
      // jump straight to the governance_events + audit_log rows this restore
      // produced.
      const at = new Date().toISOString();
      const result = {
        new_version: payload.new_version ?? -1,
        correlation_id: payload.correlation_id ?? null,
        at,
        from_version: fromVersion,
        preview_hash: previewHash,
      };
      setRestoreResult(result);
      void loadRelated(result);

      // Reset the form fields — reviewer can close manually or restore again.
      setReasonCode("");
      setReasonNotes("");
      setReviewedAck(false);
      setOverrideConflicts(false);
      setOverrideReason("");
      if (payload.new_version != null) onRestored?.(payload.new_version);
    } catch (e: any) {
      toast.error(e?.message || "Restore failed");
    } finally {
      setRestoring(false);
    }
  };

  const loadRelated = async (result: {
    new_version: number;
    correlation_id: string | null;
    at: string;
  }) => {
    setLoadingRelated(true);
    setRelatedEvents([]);
    setRelatedAudits([]);
    try {
      // Search a 5-minute window before the restore timestamp to catch the
      // trigger-driven governance / audit rows regardless of clock skew.
      const sinceIso = new Date(new Date(result.at).getTime() - 5 * 60_000).toISOString();

      const govQuery = supabase
        .from("governance_events")
        .select("id, event_type, event_status, created_at, correlation_id")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(10);
      if (result.correlation_id) govQuery.eq("correlation_id", result.correlation_id);
      else govQuery.ilike("event_type", "%publication%");

      const auditQuery = supabase
        .from("audit_log")
        .select("id, action, created_at, details")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(10)
        .or(
          `action.ilike.%publication%,action.ilike.%restore%,details->>record_id.eq.${recordId}`,
        );

      const [gov, aud] = await Promise.all([govQuery, auditQuery]);
      setRelatedEvents((gov.data ?? []) as typeof relatedEvents);
      setRelatedAudits((aud.data ?? []) as typeof relatedAudits);
    } finally {
      setLoadingRelated(false);
    }
  };



  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingVersions(true);
      try {
        const { data, error } = await supabase.functions.invoke("publication-gate", {
          body: { action: "versions", surface, record_id: recordId },
        });
        if (error) throw error;
        if (cancelled) return;
        const payload = data as { versions: VersionMeta[]; latest_admitted_version: number | null };
        const list = payload?.versions ?? [];
        setVersions(list);
        setLatestAdmittedVersion(payload?.latest_admitted_version ?? null);
        const top = currentVersion ?? list[0]?.version ?? null;
        const prev = list.find((v) => v.version < (top ?? Infinity))?.version ?? null;
        setToVersion(top);
        setFromVersion(prev);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load versions");
      } finally {
        if (!cancelled) setLoadingVersions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surface, recordId, currentVersion]);

  useEffect(() => {
    if (fromVersion == null || toVersion == null || fromVersion === toVersion) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingDiff(true);
      try {
        const { data, error } = await supabase.functions.invoke("publication-gate", {
          body: {
            action: "diff",
            surface,
            record_id: recordId,
            from_version: fromVersion,
            to_version: toVersion,
          },
        });
        if (error) throw error;
        if (!cancelled) setDiff(data as DiffPayload);
      } catch (e: any) {
        toast.error(e?.message || "Diff failed");
      } finally {
        if (!cancelled) setLoadingDiff(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [surface, recordId, fromVersion, toVersion]);

  const loadRestoreHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from("governance_events")
        .select("id, created_at, correlation_id, metadata_json")
        .eq("event_type", "publication_claims_restored")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? [])
        .filter((r: any) => {
          const m = r.metadata_json ?? {};
          return m.surface === surface && m.record_id === recordId;
        })
        .map((r: any): RestoreHistoryRow => {
          const m = r.metadata_json ?? {};
          return {
            id: r.id,
            created_at: r.created_at,
            correlation_id: r.correlation_id,
            from_version: m.from_version ?? null,
            new_version: m.new_version ?? null,
            reason_code: m.reason_code ?? null,
            reason_notes: m.reason_notes ?? null,
            reason: m.reason ?? null,
            restored_by: m.restored_by ?? null,
            conflict_override: m.conflict_override ?? null,
            conflict_override_reason: m.conflict_override_reason ?? null,
          };
        });
      setRestoreHistory(rows);
    } catch (e: any) {
      // Non-fatal — history is a transparency aid, not a blocker.
      console.warn("[ClaimVersionDiff] restore history load failed", e?.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void loadRestoreHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, recordId, restoreResult?.new_version]);


  const versionOptions = useMemo(
    () =>
      versions.map((v) => (
        <SelectItem key={v.version} value={String(v.version)}>
          v{v.version} · {v.claim_count} claim{v.claim_count === 1 ? "" : "s"}
          {v.content_hash ? ` · ${v.content_hash.slice(0, 8)}` : ""}
          {v.admitted ? " · ✓ approved" : ""}
        </SelectItem>
      )),
    [versions],
  );

  if (loadingVersions) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (versions.length < 2) {
    return (
      <p className="text-xs text-muted-foreground">
        Only one version exists so far. Edit the record and re-extract to compare against a prior version.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Compare</span>
        <Select
          value={fromVersion != null ? String(fromVersion) : ""}
          onValueChange={(v) => setFromVersion(Number(v))}
        >
          <SelectTrigger className="w-[190px] h-8 text-xs">
            <SelectValue placeholder="From" />
          </SelectTrigger>
          <SelectContent>{versionOptions}</SelectContent>
        </Select>
        <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
        <Select
          value={toVersion != null ? String(toVersion) : ""}
          onValueChange={(v) => setToVersion(Number(v))}
        >
          <SelectTrigger className="w-[190px] h-8 text-xs">
            <SelectValue placeholder="To" />
          </SelectTrigger>
          <SelectContent>{versionOptions}</SelectContent>
        </Select>
        {diff && (
          <div className="flex items-center gap-2 ml-auto text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-400">
              <Plus className="h-3 w-3" />
              {diff.counts.added}
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <Minus className="h-3 w-3" />
              {diff.counts.removed}
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <Pencil className="h-3 w-3" />
              {diff.counts.changed}
            </span>
            <span>· {diff.counts.unchanged} unchanged</span>
            {previewHash && (
              <span
                className="ml-1 rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/90"
                title={`Preview checksum (sha256) — verifies the exact diff you're reviewing.\nFull: ${previewHash}`}
              >
                sha256:{previewHash.slice(0, 12)}
              </span>
            )}
          </div>
        )}
      </div>

      {diff && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search claim text, kind, decision, evidence…"
              className="w-full h-8 rounded-md border border-border/40 bg-background/60 px-2.5 pr-8 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground hover:text-foreground px-1"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-border/40 bg-muted/20 p-0.5">
            {([
              { key: "all", label: "All", count: diff.counts.added + diff.counts.removed + diff.counts.changed + diff.counts.unchanged },
              { key: "changed", label: "Changed", count: diff.counts.changed },
              { key: "added", label: "New", count: diff.counts.added },
              { key: "removed", label: "Removed", count: diff.counts.removed },
              { key: "new_or_removed", label: "New / removed", count: diff.counts.added + diff.counts.removed },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setChangeFilter(opt.key)}
                className={`h-6 rounded px-2 text-[10px] font-mono transition-colors ${
                  changeFilter === opt.key
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
                <span className="ml-1 opacity-70">{opt.count}</span>
              </button>
            ))}
          </div>
          {(search.trim() || changeFilter !== "all") && (
            <span className="text-[11px] text-muted-foreground font-mono">
              {matchCount} shown · totals unchanged
            </span>
          )}
        </div>
      )}

      {latestAdmittedVersion != null && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-muted-foreground flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
            approved target
          </Badge>
          <span>
            Latest approved state:{" "}
            <button
              type="button"
              className="font-mono underline underline-offset-2 hover:text-foreground"
              onClick={() => setFromVersion(latestAdmittedVersion)}
              title="Set as From version"
            >
              v{latestAdmittedVersion}
            </button>
            {latestAdmittedMeta?.claim_count != null && (
              <> · {latestAdmittedMeta.claim_count} claim{latestAdmittedMeta.claim_count === 1 ? "" : "s"}</>
            )}
            {latestAdmittedMeta?.admitted_at && (
              <> · admitted {new Date(latestAdmittedMeta.admitted_at).toLocaleString()}</>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2">
        <div className="text-[11px] text-muted-foreground">
          {blockedByApproved ? (
            <span className="text-red-400">
              Blocked: v{latestAdmittedVersion} is already approved. Roll back v
              {latestAdmittedVersion} through the record's rollback action before restoring an
              older version.
            </span>
          ) : canRestore ? (
            <>
              Clone <span className="font-mono">v{fromVersion}</span> claims into a new
              version (v{(latestVersion ?? 0) + 1}). Requires a reason and is written to the
              governance ledger.
            </>
          ) : fromVersion != null && fromVersion === latestVersion ? (
            <>Cannot restore the latest version — pick an older "From" version.</>
          ) : (
            <>Select an older "From" version to enable rollback.</>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!canRestore || restoring}
          onClick={() => {
            setReasonCode("");
            setReasonNotes("");
            setReviewedAck(false);
            setOverrideConflicts(false);
            setOverrideReason("");
            setRestoreOpen(true);
          }}
          className="h-7 text-xs gap-1.5"
        >
          <RotateCcw className="h-3 w-3" />
          Restore v{fromVersion ?? "?"}
        </Button>
      </div>

      <ReceiptTrail
        title="Restore history"
        collapsible
        defaultOpen={historyOpen}
        loading={loadingHistory}
        emptyMessage="No rollback events recorded for this record yet."
        exportContext={{
          filename: "publication-restore-history",
          title: "Publication restore history",
          audience: "auditors & partners",
        }}
        entries={restoreHistory.map<ReceiptEntry>((h) => ({
          id: h.id,
          timestamp: h.created_at,
          title: `v${h.from_version ?? "?"} → v${h.new_version ?? "?"}`,
          badges: [
            ...(h.reason_code
              ? [{ label: h.reason_code, tone: "warn" as const }]
              : []),
            ...(h.conflict_override
              ? [{ label: "override", tone: "danger" as const }]
              : []),
          ],
          notes: (
            <>
              {h.reason && (
                <p>
                  <span className="text-foreground/80 font-medium">Reason:</span>{" "}
                  {h.reason}
                </p>
              )}
              {h.reason_notes && (
                <p className="italic whitespace-pre-wrap">“{h.reason_notes}”</p>
              )}
              {h.conflict_override_reason && (
                <p className="text-red-300/90 italic">
                  <span className="not-italic font-medium">Override note:</span>{" "}
                  {h.conflict_override_reason}
                </p>
              )}
            </>
          ),
          correlationId: h.correlation_id ?? undefined,
          actor: h.restored_by ?? undefined,
        }))}
      />





      <AlertDialog
        open={restoreOpen}
        onOpenChange={(v) => {
          setRestoreOpen(v);
          if (!v) setRestoreResult(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Restore claims from v{fromVersion}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new claims version{" "}
              <span className="font-mono">v{(latestVersion ?? 0) + 1}</span> by cloning every
              claim (text, kind, decision, evidence) from{" "}
              <span className="font-mono">v{fromVersion}</span>. The record itself is not
              modified. The action is appended to the governance ledger as{" "}
              <span className="font-mono">publication_claims_restored</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {restoreResult ? (
            <RestoreSuccessPanel
              result={restoreResult}
              loading={loadingRelated}
              events={relatedEvents}
              audits={relatedAudits}
              onReload={() => void loadRelated(restoreResult)}
              onClose={() => {
                setRestoreOpen(false);
                setRestoreResult(null);
              }}
            />
          ) : (
            <>
            <div className="space-y-2">
            <Label htmlFor="restore-reason-code" className="text-xs flex items-center justify-between">
              <span>Reason template (required)</span>
              {reviewedAck && (
                <span className="text-[10px] font-mono text-amber-400/90" title="Uncheck the review acknowledgment below to change the reason.">
                  locked to preview
                </span>
              )}
            </Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v)}
              disabled={restoring || reviewedAck}
            >
              <SelectTrigger id="restore-reason-code" className="h-9 text-xs">
                <SelectValue placeholder="Pick a rollback reason…" />
              </SelectTrigger>
              <SelectContent>
                {REASON_TEMPLATES.map((t) => (
                  <SelectItem key={t.code} value={t.code} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTemplate?.summary && (
              <p className="text-[11px] text-muted-foreground italic">
                {selectedTemplate.summary}
              </p>
            )}
            {reviewedAck && (
              <p className="text-[10px] text-muted-foreground">
                Reason & notes are locked because you acknowledged the current field-level
                preview. Uncheck the acknowledgment below to edit them.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="restore-notes" className="text-xs flex items-center justify-between">
              <span>
                Notes{" "}
                {notesRequired
                  ? `(required, ${NOTES_MIN}–${NOTES_MAX} chars)`
                  : `(optional, ${NOTES_MIN}–${NOTES_MAX} chars if provided)`}
              </span>
              <span
                className={`font-mono text-[10px] ${
                  notesTooLong || notesTooShort ? "text-red-400" : "text-muted-foreground"
                }`}
              >
                {notesLen}/{NOTES_MAX}
              </span>
            </Label>
            <Textarea
              id="restore-notes"
              placeholder="Add context that will be stored on the governance event…"
              value={reasonNotes}
              onChange={(e) => setReasonNotes(e.target.value)}
              rows={3}
              maxLength={NOTES_MAX}
              disabled={restoring || reviewedAck}
              aria-invalid={notesTooShort || notesTooLong}
            />
            {selectedTemplate && (notesTooShort || notesTooLong) && (
              <p className="text-[11px] text-red-400">
                {notesTooLong
                  ? `Notes must be ${NOTES_MAX} characters or fewer.`
                  : notesRequired
                    ? `This reason template requires at least ${NOTES_MIN} characters of notes.`
                    : `Notes must be at least ${NOTES_MIN} characters, or left blank.`}
              </p>
            )}
          </div>

          {validation.hasBlocking && (
            <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/5 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-300">
                <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
                v{fromVersion} has {validation.conflicts.length} publication conflict
                {validation.conflicts.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1 max-h-32 overflow-y-auto text-[11px] font-mono text-red-200/90">
                {validation.conflicts.slice(0, 8).map((c, i) => (
                  <li key={i} className="rounded bg-background/30 px-1.5 py-1">
                    <div className="text-red-300">{c.label}</div>
                    <div className="opacity-80">{c.detail}</div>
                    <div className="italic opacity-70 truncate">“{c.sampleText}”</div>
                  </li>
                ))}
                {validation.conflicts.length > 8 && (
                  <li className="italic opacity-70">
                    …and {validation.conflicts.length - 8} more.
                  </li>
                )}
              </ul>
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={overrideConflicts}
                  onCheckedChange={(v) => setOverrideConflicts(!!v)}
                  disabled={restoring}
                  className="mt-0.5"
                />
                <span className="text-[11px] text-red-200/90 leading-snug">
                  Override conflicts. I accept these duplicates / contradictions will be
                  cloned into v{(latestVersion ?? 0) + 1}.
                </span>
              </label>
              {overrideConflicts && (
                <div className="space-y-1">
                  <Label htmlFor="override-reason" className="text-[11px] text-red-200/90">
                    Override reason (required, ≥ 8 chars) — logged verbatim to the governance ledger
                  </Label>
                  <Textarea
                    id="override-reason"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    disabled={restoring}
                    placeholder="Why is it safe to clone these conflicting claims?"
                    className="text-xs"
                  />
                </div>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 cursor-pointer">
            <Checkbox
              id="restore-ack"
              checked={reviewedAck}
              onCheckedChange={(v) => setReviewedAck(!!v)}
              disabled={restoring}
              className="mt-0.5"
            />
            <span className="text-xs text-muted-foreground leading-snug">
              I reviewed the field-level changes between{" "}
              <span className="font-mono">v{fromVersion}</span> and{" "}
              <span className="font-mono">v{latestVersion}</span>
              {diff
                ? ` (${diff.counts.added} added · ${diff.counts.removed} removed · ${diff.counts.changed} changed)`
                : ""}{" "}
              and confirm this rollback is intentional.
              {previewHash && (
                <span className="mt-1 block font-mono text-[10px] text-muted-foreground/80 break-all">
                  preview sha256 · {previewHash}
                </span>
              )}
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring || !reasonOk || !reviewedAck || !overrideOk}
              onClick={(e) => {
                e.preventDefault();
                void runRestore();
              }}
            >
              {restoring ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Restoring…
                </>
              ) : (
                <>Restore to new version</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {loadingDiff ? (
        <Skeleton className="h-40 w-full" />
      ) : !diff || !filteredDiff ? (
        <p className="text-xs text-muted-foreground">Pick two different versions to see the diff.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2">
              <span>v{diff.from_version} (before)</span>
              {(search.trim() || changeFilter !== "all") && (
                <span className="text-[10px] font-mono text-muted-foreground/70">
                  {filteredDiff.removed.length + filteredDiff.changed.length + filteredDiff.unchanged.length}
                  {" / "}
                  {diff.removed.length + diff.changed.length + diff.unchanged.length}
                </span>
              )}
            </div>
            {filteredDiff.removed.map((c) => (
              <ClaimBlock key={`r-${c.id}`} claim={c} tone="removed" />
            ))}
            {filteredDiff.changed.map(({ from, to }) => (
              <ClaimBlock
                key={`cf-${from.id}`}
                claim={from}
                tone="changed-from"
                counterpart={to}
                highlightField={{
                  claim_text: from.claim_text !== to.claim_text,
                  decision: from.decision !== to.decision,
                  evidence_url: (from.evidence_url ?? "") !== (to.evidence_url ?? ""),
                  evidence_note: (from.evidence_note ?? "") !== (to.evidence_note ?? ""),
                  claim_kind: from.claim_kind !== to.claim_kind,
                }}
              />
            ))}
            {filteredDiff.unchanged.map((c) => (
              <ClaimBlock key={`uf-${c.id}`} claim={c} tone="unchanged" />
            ))}
            {filteredDiff.removed.length + filteredDiff.changed.length + filteredDiff.unchanged.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                {(search.trim() || changeFilter !== "all") ? "No claims match the current filter on the before side." : "No claims in this version."}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-2">
              <span>v{diff.to_version} (after)</span>
              {(search.trim() || changeFilter !== "all") && (
                <span className="text-[10px] font-mono text-muted-foreground/70">
                  {filteredDiff.added.length + filteredDiff.changed.length + filteredDiff.unchanged.length}
                  {" / "}
                  {diff.added.length + diff.changed.length + diff.unchanged.length}
                </span>
              )}
            </div>
            {filteredDiff.added.map((c) => (
              <ClaimBlock key={`a-${c.id}`} claim={c} tone="added" />
            ))}
            {filteredDiff.changed.map(({ from, to }) => (
              <ClaimBlock
                key={`ct-${to.id}`}
                claim={to}
                tone="changed-to"
                counterpart={from}
                highlightField={{
                  claim_text: from.claim_text !== to.claim_text,
                  decision: from.decision !== to.decision,
                  evidence_url: (from.evidence_url ?? "") !== (to.evidence_url ?? ""),
                  evidence_note: (from.evidence_note ?? "") !== (to.evidence_note ?? ""),
                  claim_kind: from.claim_kind !== to.claim_kind,
                }}
              />
            ))}
            {filteredDiff.unchanged.map((c) => (
              <ClaimBlock key={`ut-${c.id}`} claim={c} tone="unchanged" />
            ))}
            {filteredDiff.added.length + filteredDiff.changed.length + filteredDiff.unchanged.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                {(search.trim() || changeFilter !== "all") ? "No claims match the current filter on the after side." : "No claims in this version."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RestoreSuccessPanel({
  result,
  loading,
  events,
  audits,
  onReload,
  onClose,
}: {
  result: { new_version: number; correlation_id: string | null; at: string; from_version: number; preview_hash: string | null };
  loading: boolean;
  events: Array<{ id: string; event_type: string; event_status: string; created_at: string; correlation_id: string | null }>;
  audits: Array<{ id: string; action: string; created_at: string; details: Record<string, unknown> | null }>;
  onReload: () => void;
  onClose: () => void;
}) {
  const govDeepLink = result.correlation_id
    ? `/admin?tab=governance#correlation=${result.correlation_id}`
    : `/admin?tab=governance`;
  const auditDeepLink = `/admin?tab=audit`;
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          Restored v{result.from_version} → new v{result.new_version}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Cloned at {new Date(result.at).toLocaleString()}. The governance ledger and audit log
          entries below were written by this action.
        </p>
        {result.correlation_id && (
          <p className="text-[10px] font-mono text-muted-foreground/80 truncate">
            correlation_id · {result.correlation_id}
          </p>
        )}
        {result.preview_hash && (
          <p
            className="text-[10px] font-mono text-muted-foreground/80 break-all"
            title="sha256 of the diff payload you acknowledged before restoring."
          >
            preview sha256 · {result.preview_hash}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5">
          <a href={govDeepLink} target="_blank" rel="noreferrer">
            Open governance events ↗
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5">
          <a href={auditDeepLink} target="_blank" rel="noreferrer">
            Open audit trail ↗
          </a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1.5"
          onClick={onReload}
          disabled={loading}
        >
          <Loader2 className={`h-3 w-3 ${loading ? "animate-spin" : "hidden"}`} />
          Reload
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          governance_events{" "}
          <span className="text-muted-foreground/60">
            ({loading ? "…" : events.length})
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : events.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">
            No governance_events matched yet — the trigger may still be flushing. Try Reload.
          </p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {events.map((e) => (
              <li
                key={e.id}
                className="rounded border border-border/40 bg-muted/20 px-2 py-1 text-[11px] font-mono flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {e.event_type} · <span className="text-muted-foreground">{e.event_status}</span>
                </span>
                <span className="text-muted-foreground shrink-0">
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          audit_log{" "}
          <span className="text-muted-foreground/60">
            ({loading ? "…" : audits.length})
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : audits.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">
            No audit_log rows matched yet. Try Reload.
          </p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {audits.map((a) => (
              <li
                key={a.id}
                className="rounded border border-border/40 bg-muted/20 px-2 py-1 text-[11px] font-mono flex items-center justify-between gap-2"
              >
                <span className="truncate">{a.action}</span>
                <span className="text-muted-foreground shrink-0">
                  {new Date(a.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={onClose} className="h-7 text-xs">
          Close
        </Button>
      </div>
    </div>
  );
}

