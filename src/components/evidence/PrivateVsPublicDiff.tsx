/**
 * PrivateVsPublicDiff — side-by-side comparison of what an entry looks like
 * inside the entrant's private submission vs. what a public reader will
 * actually see on the evidence page.
 *
 * Sibling to `WhatYouSeePreview`:
 *   - `WhatYouSeePreview` shows the per-field status + rationale rule.
 *   - This view answers the different question "for each field, what will
 *     change when it crosses the visibility boundary?" — the entrant can
 *     see private→public deltas in one glance before they submit.
 *
 * Read-only. Queries `entries` directly (owner/ops via RLS). Non-owners get
 * an empty state, same policy as `WhatYouSeePreview`.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Copy, Eye, EyeOff, Info, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  RULE_DEFS,
  type DisclosureRuleId,
  type DisclosureStatus,
} from "@/lib/disclosure/rationaleRules";
import {
  EVIDENCE_ROLE_LABEL,
  EVIDENCE_ROLE_DESCRIPTION,
  type EvidenceViewerRole,
} from "./useEvidenceViewerRole";

interface EntryRow {
  id: string;
  title: string | null;
  logline: string | null;
  genre: string | null;
  length_category: string | null;
  page_count: number | null;
  visibility: string | null;
  sharing_mode: string | null;
  embargo_until: string | null;
  writer_name: string | null;
  writer_email: string | null;
  co_author: string | null;
  ai_fields: Record<string, unknown> | null;
  evidence_bundle_hash: string | null;
}

interface DiffRow {
  label: string;
  privateValue: string | null;
  publicValue: string | null;
  status: DisclosureStatus;
  ruleId: DisclosureRuleId;
  changed: boolean;
}

function readDisclosure(ai: Record<string, unknown> | null | undefined) {
  if (!ai) return { isAi: false, category: null, genre: null, hasPrompt: false };
  const disc = (ai.ai_disclosure as Record<string, unknown> | undefined) ?? ai;
  return {
    isAi: Boolean(disc?.is_ai_generated),
    category: (disc?.ai_category as string | null | undefined) ?? null,
    genre: (disc?.ai_genre as string | null | undefined) ?? null,
    hasPrompt: Boolean(disc?.ai_prompt || (ai as any).prompt),
  };
}

/** Render the value the target audience would see for `status`. */
function projectValueForStatus(
  status: DisclosureStatus,
  privateValue: string | null,
): string | null {
  if (status === "visible") return privateValue;
  return null; // conditional (withheld) or redacted → nothing rendered
}

/**
 * Given the canonical `DisclosureRuleId` and the audience we're projecting
 * for, return the effective status. The public-reader projection uses the
 * rule's own `status` (that's what `RULE_DEFS` was designed to answer);
 * other roles override it because they see more than a public reader would.
 *
 *   - operator: full access — every field visible.
 *   - judge:    everything visible except blind-review identity fields and
 *               internal correlation ids (blind-review protection) and raw
 *               AI prompts / model config (kept in the hashed audit trail).
 *   - entrant:  sees their own submission fully; only true internal-only
 *               fields (correlation ids) stay redacted.
 *   - reader:   canonical public projection.
 */
function statusForRole(
  ruleId: DisclosureRuleId,
  role: EvidenceViewerRole,
): DisclosureStatus {
  const publicStatus = RULE_DEFS[ruleId].status;
  if (role === "reader") return publicStatus;
  if (role === "operator") return "visible";
  if (role === "judge") {
    if (
      ruleId === "blind_review_identity" ||
      ruleId === "blind_review_contact" ||
      ruleId === "blind_review_coauthor" ||
      ruleId === "ai_prompt_never_public" ||
      ruleId === "internal_correlation_ids"
    ) {
      return "redacted";
    }
    return "visible";
  }
  // entrant
  if (ruleId === "internal_correlation_ids") return "redacted";
  return "visible";
}

function buildDiff(entry: EntryRow, role: EvidenceViewerRole): DiffRow[] {
  const isPublic = entry.visibility === "public";
  const disclosure = readDisclosure(entry.ai_fields);
  const embargoed =
    !!entry.embargo_until && new Date(entry.embargo_until) > new Date();

  const visibilityRule: DisclosureRuleId = isPublic
    ? "visibility_public"
    : "visibility_gated";

  const scriptBodyRule: DisclosureRuleId = embargoed
    ? "script_body_embargoed"
    : entry.sharing_mode === "public" || entry.sharing_mode === "link"
      ? "script_body_sharing_on"
      : "script_body_sharing_off";

  const hashRule: DisclosureRuleId = entry.evidence_bundle_hash
    ? isPublic
      ? "evidence_hash_available"
      : "visibility_gated"
    : "evidence_hash_pending";

  const rows: Array<Omit<DiffRow, "publicValue" | "changed" | "status">> = [
    { label: "Title", privateValue: entry.title, ruleId: visibilityRule },
    { label: "Logline", privateValue: entry.logline, ruleId: visibilityRule },
    { label: "Genre", privateValue: entry.genre, ruleId: visibilityRule },
    {
      label: "Length / page count",
      privateValue:
        [entry.length_category, entry.page_count && `${entry.page_count} pages`]
          .filter(Boolean)
          .join(" · ") || null,
      ruleId: visibilityRule,
    },
    { label: "Writer name", privateValue: entry.writer_name, ruleId: "blind_review_identity" },
    { label: "Writer email", privateValue: entry.writer_email, ruleId: "blind_review_contact" },
    { label: "Co-author", privateValue: entry.co_author, ruleId: "blind_review_coauthor" },
    {
      label: "AI disclosure — declared status",
      privateValue: disclosure.isAi ? "AI-assisted (disclosed)" : "Human-written",
      ruleId: "ai_disclosure_public_anchor",
    },
    {
      label: "AI disclosure — category / genre",
      privateValue:
        [disclosure.category, disclosure.genre].filter(Boolean).join(" · ") || null,
      ruleId: disclosure.isAi ? visibilityRule : "ai_detail_requires_declaration",
    },
    {
      label: "AI prompt text / model config",
      privateValue: disclosure.hasPrompt ? "(prompt on file)" : null,
      ruleId: "ai_prompt_never_public",
    },
    {
      label: "Full screenplay text",
      privateValue: embargoed ? "(under embargo)" : "(script body)",
      ruleId: scriptBodyRule,
    },
    {
      label: "Evidence bundle hash",
      privateValue: entry.evidence_bundle_hash
        ? `${entry.evidence_bundle_hash.slice(0, 10)}…`
        : null,
      ruleId: hashRule,
    },
    {
      label: "Reviewer identities / correlation ids",
      privateValue: "(internal)",
      ruleId: "internal_correlation_ids",
    },
  ];

  return rows.map((r) => {
    const status = statusForRole(r.ruleId, role);
    const publicValue = projectValueForStatus(status, r.privateValue);
    return {
      ...r,
      status,
      publicValue,
      changed: r.privateValue !== publicValue,
    };
  });
}

function StatusChip({ status }: { status: DisclosureStatus }) {
  if (status === "visible") {
    return (
      <Badge
        variant="outline"
        className="text-[9px] font-mono uppercase tracking-wider border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
      >
        <Eye className="h-2.5 w-2.5 mr-1" /> Public
      </Badge>
    );
  }
  if (status === "conditional") {
    return (
      <Badge
        variant="outline"
        className="text-[9px] font-mono uppercase tracking-wider border-amber-500/40 text-amber-300 bg-amber-500/5"
      >
        <ShieldAlert className="h-2.5 w-2.5 mr-1" /> Conditional
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-[9px] font-mono uppercase tracking-wider border-border/60 text-muted-foreground"
    >
      <EyeOff className="h-2.5 w-2.5 mr-1" /> Redacted
    </Badge>
  );
}

const STATUS_CATEGORY_LABEL: Record<DisclosureStatus, string> = {
  visible: "Public",
  conditional: "Conditional (public only when visibility=public)",
  redacted: "Redacted (never surfaced to readers)",
};

function WhyChanged({
  ruleId,
  status,
}: {
  ruleId: DisclosureRuleId;
  status: DisclosureStatus;
}) {
  const def = RULE_DEFS[ruleId];
  const toneClass =
    status === "visible"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : status === "conditional"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-border/40 bg-muted/10";
  return (
    <div
      className={cn(
        "mt-2 rounded-md border px-2 py-1.5 text-[10.5px] leading-snug",
        toneClass,
      )}
    >
      <div className="flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-0.5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
            Why this changed
          </div>
          <p className="text-foreground/85">{def.plainLanguage}</p>
          <p className="text-[10px] text-muted-foreground/80 italic">
            {def.summary}
          </p>
          <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[9px] font-mono text-muted-foreground">
            <span>Rule</span>
            <code className="rounded bg-muted/40 px-1 py-0.5 text-foreground/80">
              {ruleId}
            </code>
            <span>·</span>
            <span>{STATUS_CATEGORY_LABEL[status]}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffCell({
  value,
  redacted,
  emptyLabel = "(not set)",
}: {
  value: string | null;
  redacted: boolean;
  emptyLabel?: string;
}) {
  if (redacted) {
    return (
      <span className="italic text-muted-foreground/60">[hidden]</span>
    );
  }
  if (value === null || value === "") {
    return <span className="italic text-muted-foreground/60">{emptyLabel}</span>;
  }
  return <span className="text-foreground/90 break-words">{value}</span>;
}

interface Props {
  entryId: string;
  className?: string;
  /** Optional header title override. */
  title?: string;
  /** When false, hide unchanged rows so deltas stand out. */
  showUnchanged?: boolean;
  /** Initial audience for the right-hand column. Defaults to public reader. */
  initialRole?: EvidenceViewerRole;
}

export function PrivateVsPublicDiff({
  entryId,
  className,
  title = "Private vs. public — side-by-side",
  showUnchanged = true,
  initialRole = "reader",
}: Props) {
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(!showUnchanged);
  const [viewerRole, setViewerRole] = useState<EvidenceViewerRole>(initialRole);
  // Scope highlight: when a Δ row is picked, dim rows that do NOT share its
  // rule so the entrant can see the exact set of evidence fields that flip
  // together. Cleared on role change (below) — scope only makes sense in the
  // context of the projection that produced it.
  const [scopeRuleId, setScopeRuleId] = useState<DisclosureRuleId | null>(null);
  useEffect(() => setScopeRuleId(null), [viewerRole, entryId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error } = await (supabase as any)
        .from("entries")
        .select(
          "id,title,logline,genre,length_category,page_count,visibility,sharing_mode,embargo_until,writer_name,writer_email,co_author,ai_fields,evidence_bundle_hash",
        )
        .eq("id", entryId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError("diff_unavailable");
      setEntry((data as EntryRow) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const rows = useMemo(
    () => (entry ? buildDiff(entry, viewerRole) : []),
    [entry, viewerRole],
  );
  const displayedRows = useMemo(
    () => (onlyChanged ? rows.filter((r) => r.changed) : rows),
    [rows, onlyChanged],
  );
  const changedCount = rows.filter((r) => r.changed).length;
  // Every field governed by the currently-scoped rule (whether changed or not).
  // Used to render the "impacted labels" chip in the scope banner.
  const scopedLabels = useMemo(
    () =>
      scopeRuleId ? rows.filter((r) => r.ruleId === scopeRuleId).map((r) => r.label) : [],
    [rows, scopeRuleId],
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card/60 p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Left column: what you see privately. Right column: what a{" "}
            <span className="font-medium text-foreground/90">
              {EVIDENCE_ROLE_LABEL[viewerRole]}
            </span>{" "}
            actually sees.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {entry && (
            <Badge
              variant="outline"
              className="text-[9px] font-mono uppercase tracking-wider border-border/50 text-muted-foreground"
            >
              {changedCount} of {rows.length} change
              {changedCount === 1 ? "" : "s"}
            </Badge>
          )}
          {entry && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={async () => {
                if (typeof window === "undefined") return;
                const url = new URL(
                  `${window.location.origin}/evidence/${entry.id}/diff`,
                );
                if (entry.evidence_bundle_hash) {
                  url.searchParams.set("hash", entry.evidence_bundle_hash);
                }
                try {
                  await navigator.clipboard.writeText(url.toString());
                  toast.success("Diff permalink copied", {
                    description: entry.evidence_bundle_hash
                      ? "Pinned to this submission's current evidence hash."
                      : "No evidence hash yet — the link opens the live diff.",
                  });
                } catch {
                  toast.error("Copy failed");
                }
              }}
              aria-label="Copy shareable diff permalink"
              title="Copy a link that opens this diff pinned to the current evidence hash"
            >
              <Copy className="h-3 w-3 mr-1" />
              Permalink
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      ) : error || !entry ? (
        <p className="text-[11px] text-muted-foreground italic">
          Diff unavailable. Only the entry owner (or an operator) can see this
          comparison.
        </p>
      ) : (
        <>
          <div
            role="radiogroup"
            aria-label="View diff as viewer role"
            className="mb-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border/40 bg-muted/10 px-2 py-1.5"
          >
            <span
              id="diff-view-as-label"
              className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mr-1"
            >
              View as
            </span>
            {(() => {
              const roles = ["entrant", "judge", "operator", "reader"] as const;
              const activeIndex = roles.indexOf(viewerRole);
              return roles.map((r, i) => {
                const active = viewerRole === r;
                const label = EVIDENCE_ROLE_LABEL[r];
                const description = EVIDENCE_ROLE_DESCRIPTION[r];
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${label} view — ${description}`}
                    tabIndex={active || (activeIndex === -1 && i === 0) ? 0 : -1}
                    onClick={() => setViewerRole(r)}
                    onKeyDown={(e) => {
                      const key = e.key;
                      let next = -1;
                      if (key === "ArrowRight" || key === "ArrowDown") {
                        next = (i + 1) % roles.length;
                      } else if (key === "ArrowLeft" || key === "ArrowUp") {
                        next = (i - 1 + roles.length) % roles.length;
                      } else if (key === "Home") {
                        next = 0;
                      } else if (key === "End") {
                        next = roles.length - 1;
                      }
                      if (next >= 0) {
                        e.preventDefault();
                        setViewerRole(roles[next]);
                        const group = e.currentTarget.parentElement;
                        const btns = group?.querySelectorAll<HTMLButtonElement>(
                          'button[role="radio"]',
                        );
                        btns?.[next]?.focus();
                      }
                    }}
                    title={description}
                    className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border",
                    )}
                  >
                    {label}
                  </button>
                );
              });
            })()}
          </div>


          <div className="flex items-center justify-between gap-2 mb-2 text-[10px] font-mono text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-foreground/40" />
                Private
              </span>
              <ArrowRight className="h-3 w-3" />
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-primary/70" />
                {EVIDENCE_ROLE_LABEL[viewerRole]} view
              </span>
            </div>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyChanged}
                onChange={(e) => setOnlyChanged(e.target.checked)}
                className="h-3 w-3 accent-primary"
              />
              <span>Show only changes</span>
            </label>
          </div>

          {/* Scope banner — appears when a Δ row is selected. Names the rule
              in scope, lists every impacted evidence label, and offers a
              single click to clear the highlight. */}
          {scopeRuleId && (
            <div
              role="status"
              className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 flex items-start gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 mb-0.5">
                  Scope · {scopeRuleId}
                </div>
                <div className="text-[11px] text-foreground/90">
                  {scopedLabels.length} evidence field
                  {scopedLabels.length === 1 ? "" : "s"} governed by this rule:{" "}
                  <span className="text-muted-foreground">
                    {scopedLabels.join(", ")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScopeRuleId(null)}
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border/40 rounded px-2 py-0.5"
                aria-label="Clear scope highlight"
              >
                Clear
              </button>
            </div>
          )}

          <div className="rounded-md border border-border/40 overflow-hidden">
            <div className="grid grid-cols-[7rem_1fr_1fr] bg-muted/20 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <span>Status</span>
              <span>Private (you)</span>
              <span>{EVIDENCE_ROLE_LABEL[viewerRole]} view</span>
            </div>
            <ul className="divide-y divide-border/40">
              {displayedRows.length === 0 ? (
                <li className="px-3 py-4 text-[11px] text-muted-foreground italic text-center">
                  No changes to show — every field renders identically for a{" "}
                  {EVIDENCE_ROLE_LABEL[viewerRole]}.
                </li>
              ) : (
                displayedRows.map((r) => {
                  const inScope = scopeRuleId === r.ruleId;
                  const dimmed = scopeRuleId !== null && !inScope;
                  return (
                    <li
                      key={r.label}
                      className={cn(
                        "grid grid-cols-[7rem_1fr_1fr] gap-3 px-3 py-2 text-xs transition-colors",
                        r.changed && "bg-amber-500/[0.03]",
                        inScope && "bg-amber-500/[0.09] ring-1 ring-inset ring-amber-500/50",
                        dimmed && "opacity-40",
                      )}
                      aria-current={inScope ? "true" : undefined}
                    >
                    <div className="min-w-0 pt-0.5">
                      <StatusChip status={r.status} />
                      <div className="mt-1 font-mono text-[9px] text-muted-foreground/70">
                        {r.ruleId}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
                        {r.label}
                      </div>
                      <DiffCell value={r.privateValue} redacted={false} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5 inline-flex items-center gap-1">
                        {EVIDENCE_ROLE_LABEL[viewerRole]} view
                        {r.changed && (
                          <button
                            type="button"
                            onClick={() =>
                              setScopeRuleId((prev) => (prev === r.ruleId ? null : r.ruleId))
                            }
                            aria-pressed={inScope}
                            aria-label={
                              inScope
                                ? `Clear scope for ${r.ruleId}`
                                : `Highlight every evidence field impacted by ${r.ruleId}`
                            }
                            title={
                              inScope
                                ? "Clear scope highlight"
                                : "Highlight every evidence field impacted by this rule"
                            }
                            className={cn(
                              "text-[8.5px] font-mono uppercase tracking-wider border rounded px-1.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              inScope
                                ? "border-amber-500/70 bg-amber-500/20 text-amber-100"
                                : "border-amber-500/40 text-amber-300 bg-amber-500/5 hover:bg-amber-500/10",
                            )}
                          >
                            Δ {inScope ? "scoped" : "scope"}
                          </button>
                        )}
                      </div>
                      <DiffCell
                        value={r.publicValue}
                        redacted={r.status === "redacted"}
                        emptyLabel={
                          r.status === "conditional"
                            ? viewerRole === "reader"
                              ? "(withheld until public)"
                              : "(withheld)"
                            : "(not shown)"
                        }
                      />
                      {r.changed && (
                        <WhyChanged ruleId={r.ruleId} status={r.status} />
                      )}
                    </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default PrivateVsPublicDiff;
