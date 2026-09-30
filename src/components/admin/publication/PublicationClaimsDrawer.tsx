import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, ShieldAlert, Loader2, Gavel, Plus, Pencil, Minus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ClaimVersionDiff from "./ClaimVersionDiff";
import type { PublicationSurface } from "@/lib/publication/claimExtraction";

interface Claim {
  id: string;
  claim_text: string;
  claim_kind: string;
  decision: "PENDING" | "COMMIT" | "DAMP" | "REJECT" | "ESCALATE" | "WAIVED";
  evidence_url: string | null;
  evidence_note: string | null;
}

type ChangedField = "text" | "kind" | "decision" | "evidence_url" | "evidence_note";

interface InlineDiff {
  /** For claims present in v(current). */
  status: Record<string, { kind: "added" | "changed" | "unchanged"; fields: ChangedField[] }>;
  removedCount: number;
  fromVersion: number;
  toVersion: number;
}

const FIELD_LABEL: Record<ChangedField, string> = {
  text: "text",
  kind: "kind",
  decision: "decision",
  evidence_url: "evidence",
  evidence_note: "note",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: PublicationSurface;
  recordId: string | null;
  recordLabel?: string;
  onAdmitted?: () => void;
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

const DECISION_COLORS: Record<string, string> = {
  PENDING: "bg-muted/50 text-muted-foreground border-border/50",
  COMMIT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  DAMP: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  REJECT: "bg-red-500/15 text-red-400 border-red-500/30",
  ESCALATE: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  WAIVED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

const READY = new Set(["COMMIT", "DAMP", "WAIVED"]);

export default function PublicationClaimsDrawer({
  open,
  onOpenChange,
  surface,
  recordId,
  recordLabel,
  onAdmitted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { url: string; note: string }>>({});
  const [inlineDiff, setInlineDiff] = useState<InlineDiff | null>(null);

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    setInlineDiff(null);
    try {
      const { data, error } = await supabase.functions.invoke("publication-gate", {
        body: { action: "extract", surface, record_id: recordId },
      });
      if (error) throw error;
      const payload = data as { version: number; claims: Claim[]; error?: string };
      if (payload?.error) throw new Error(payload.error);
      setVersion(payload.version);
      setClaims(payload.claims ?? []);
      setDrafts(
        Object.fromEntries(
          (payload.claims ?? []).map((c) => [
            c.id,
            { url: c.evidence_url ?? "", note: c.evidence_note ?? "" },
          ]),
        ),
      );

      // Fetch the diff against the previous version so the claims list can
      // show an inline "changed since v(N-1)" summary per row. Best-effort:
      // failures here just leave the inline decoration off.
      try {
        const versionsRes = await supabase.functions.invoke("publication-gate", {
          body: { action: "versions", surface, record_id: recordId },
        });
        const list = (versionsRes.data as { versions?: { version: number }[] } | null)?.versions ?? [];
        const prior = list.find((v) => v.version < payload.version)?.version;
        if (prior != null) {
          const diffRes = await supabase.functions.invoke("publication-gate", {
            body: {
              action: "diff",
              surface,
              record_id: recordId,
              from_version: prior,
              to_version: payload.version,
            },
          });
          const diffPayload = diffRes.data as {
            from_version: number;
            to_version: number;
            added?: { id: string }[];
            removed?: { id: string }[];
            changed?: { from: Claim; to: Claim }[];
            unchanged?: { id: string }[];
          } | null;
          if (diffPayload) {
            const status: InlineDiff["status"] = {};
            (diffPayload.added ?? []).forEach((c) => {
              status[c.id] = { kind: "added", fields: [] };
            });
            (diffPayload.changed ?? []).forEach(({ from, to }) => {
              const fields: ChangedField[] = [];
              if ((from.claim_text ?? "") !== (to.claim_text ?? "")) fields.push("text");
              if (from.claim_kind !== to.claim_kind) fields.push("kind");
              if (from.decision !== to.decision) fields.push("decision");
              if ((from.evidence_url ?? "") !== (to.evidence_url ?? "")) fields.push("evidence_url");
              if ((from.evidence_note ?? "") !== (to.evidence_note ?? "")) fields.push("evidence_note");
              status[to.id] = { kind: fields.length ? "changed" : "unchanged", fields };
            });
            (diffPayload.unchanged ?? []).forEach((c) => {
              status[c.id] = { kind: "unchanged", fields: [] };
            });
            setInlineDiff({
              status,
              removedCount: (diffPayload.removed ?? []).length,
              fromVersion: diffPayload.from_version,
              toVersion: diffPayload.to_version,
            });
          }
        }
      } catch {
        // Inline diff is a nice-to-have; drop silently.
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to extract claims");
    } finally {
      setLoading(false);
    }
  }, [recordId, surface]);

  useEffect(() => {
    if (open && recordId) load();
  }, [open, recordId, load]);

  const decide = async (claim: Claim, decision: Claim["decision"]) => {
    const draft = drafts[claim.id] ?? { url: "", note: "" };
    if (decision === "COMMIT" && !draft.url.trim()) {
      toast.error("COMMIT requires an evidence URL");
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("publication-gate", {
        body: {
          action: "decide",
          claim_id: claim.id,
          decision,
          evidence_url: draft.url.trim() || undefined,
          evidence_note: draft.note.trim() || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setClaims((prev) =>
        prev.map((c) => (c.id === claim.id ? { ...c, decision, evidence_url: draft.url, evidence_note: draft.note } : c)),
      );
      toast.success(`Claim ${decision}`);
    } catch (e: any) {
      toast.error(e?.message || "Decision failed");
    }
  };

  const admit = async () => {
    if (!recordId) return;
    setAdmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("publication-gate", {
        body: { action: "admit", surface, record_id: recordId },
      });
      if (error) throw error;
      const payload = data as { admitted?: boolean; error?: string; blockers?: Claim[] };
      if (payload?.error) {
        if (payload.blockers?.length) setClaims((prev) => prev.map((c) => ({ ...c })));
        throw new Error(payload.error);
      }
      toast.success("Admitted for publication");
      onOpenChange(false);
      onAdmitted?.();
    } catch (e: any) {
      toast.error(e?.message || "Admit failed");
    } finally {
      setAdmitting(false);
    }
  };

  const blockers = claims.filter((c) => !READY.has(c.decision));
  const ready = claims.length > 0 && blockers.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4" /> Claims Gate
            {version != null && (
              <Badge variant="outline" className="ml-2 font-mono text-[10px]">
                v{version}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {recordLabel ? <>Reviewing: {recordLabel}. </> : null}
            Every material claim must be COMMIT (evidence-bound), DAMP (softened), or WAIVED before publication.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="claims" className="mt-6">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="diff">Version diff</TabsTrigger>
          </TabsList>
          <TabsContent value="claims" className="space-y-4 mt-4">
            {inlineDiff && (
              <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">
                  Changes since v{inlineDiff.fromVersion} → v{inlineDiff.toVersion}:
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Plus className="h-3 w-3" />
                  {Object.values(inlineDiff.status).filter((s) => s.kind === "added").length} added
                </span>
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <Pencil className="h-3 w-3" />
                  {Object.values(inlineDiff.status).filter((s) => s.kind === "changed").length} changed
                </span>
                <span className="inline-flex items-center gap-1 text-red-400">
                  <Minus className="h-3 w-3" />
                  {inlineDiff.removedCount} removed
                </span>
              </div>
            )}
            {loading ? (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            ) : claims.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No material claims extracted from this record. Nothing to gate.
              </p>
            ) : (
              claims.map((claim) => {
                const draft = drafts[claim.id] ?? { url: "", note: "" };
                const diffStatus = inlineDiff?.status[claim.id];
                return (
                  <div
                    key={claim.id}
                    className={`rounded-lg border p-4 space-y-3 ${
                      diffStatus?.kind === "added"
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : diffStatus?.kind === "changed"
                          ? "border-amber-500/40 bg-amber-500/5"
                          : "border-border/50 bg-card/30"
                    }`}
                  >
                    {diffStatus && diffStatus.kind !== "unchanged" && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {diffStatus.kind === "added" ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 font-mono uppercase text-[9px]"
                          >
                            <Plus className="h-2.5 w-2.5 mr-1" />
                            new since v{inlineDiff!.fromVersion}
                          </Badge>
                        ) : (
                          <>
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 text-amber-400 bg-amber-500/10 font-mono uppercase text-[9px]"
                            >
                              <Pencil className="h-2.5 w-2.5 mr-1" />
                              changed since v{inlineDiff!.fromVersion}
                            </Badge>
                            {diffStatus.fields.map((f) => (
                              <Badge
                                key={f}
                                variant="outline"
                                className="border-amber-500/30 text-amber-300 bg-amber-500/5 font-mono text-[9px]"
                              >
                                {FIELD_LABEL[f]}
                              </Badge>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm leading-relaxed">{claim.claim_text}</p>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="outline" className={KIND_COLORS[claim.claim_kind]}>
                          {claim.claim_kind}
                        </Badge>
                        <Badge variant="outline" className={DECISION_COLORS[claim.decision]}>
                          {claim.decision}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Input
                        placeholder="Evidence URL (required for COMMIT)"
                        value={draft.url}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [claim.id]: { ...draft, url: e.target.value } }))
                        }
                      />
                      <Textarea
                        placeholder="Note (why DAMP/WAIVED/etc)"
                        rows={1}
                        value={draft.note}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [claim.id]: { ...draft, note: e.target.value } }))
                        }
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(["COMMIT", "DAMP", "WAIVED", "REJECT", "ESCALATE"] as const).map((d) => (
                        <Button
                          key={d}
                          size="sm"
                          variant={claim.decision === d ? "default" : "outline"}
                          onClick={() => decide(claim, d)}
                          className="text-xs h-7"
                        >
                          {d}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>
          <TabsContent value="diff" className="mt-4">
            {recordId ? (
              <ClaimVersionDiff
                surface={surface}
                recordId={recordId}
                currentVersion={version}
                onRestored={() => {
                  void load();
                }}
              />
            ) : null}
          </TabsContent>
        </Tabs>

        <div className="mt-6 sticky bottom-0 -mx-6 px-6 py-4 border-t border-border bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {ready ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ready to admit
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-400">
                  <ShieldAlert className="h-3.5 w-3.5" /> {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <Button onClick={admit} disabled={!ready || admitting}>
              {admitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Admit for publication
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
