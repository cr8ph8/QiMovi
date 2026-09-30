/**
 * WhatYouSeePreview — entrant-facing simulation of the public evidence view.
 *
 * Given an entry id (the entrant's own draft/submission), this panel shows a
 * field-by-field breakdown of what future readers will see vs. what stays
 * redacted, and *why* each field is redacted. The visibility/redaction
 * decision is derived from the entry's current disclosure status:
 *
 *   - `visibility`        — 'public' | 'default' | 'private'
 *   - `sharing_mode`      — 'private' | 'public' | 'link'
 *   - `embargo_until`     — timestamp
 *   - `ai_fields`         — AI disclosure block
 *
 * The panel is read-only and never exposes another user's data — it queries
 * `entries` directly, which RLS restricts to the owner (or ops staff).
 * Non-owners simply see an empty state.
 *
 * Kept entirely presentational: no writes, no receipts emitted. It is a
 * transparency tool for the entrant to verify what leaves their control.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Info,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  RULE_DEFS,
  validateRationaleLog,
  type DisclosureRuleId,
  type DisclosureStatus,
  type RationaleLog,
  type RationaleLogRow,
} from "@/lib/disclosure/rationaleRules";

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

type Status = DisclosureStatus;

interface FieldRow {
  label: string;
  status: Status;
  value: string | null;
  ruleId: DisclosureRuleId;
  inputs: Record<string, unknown>;
  valuePresent: boolean;
}

/** Pick a rule id and return the row shape used by the UI + rationale log. */
function row(
  label: string,
  value: string | null,
  ruleId: DisclosureRuleId,
  inputs: Record<string, unknown>,
): FieldRow {
  return {
    label,
    value,
    ruleId,
    inputs,
    status: RULE_DEFS[ruleId].status,
    valuePresent: value !== null && value !== "",
  };
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

function buildFields(entry: EntryRow): FieldRow[] {
  const isPublic = entry.visibility === "public";
  const disclosure = readDisclosure(entry.ai_fields);
  const embargoed =
    !!entry.embargo_until && new Date(entry.embargo_until) > new Date();

  const visibilityRule: DisclosureRuleId = isPublic
    ? "visibility_public"
    : "visibility_gated";
  const visibilityInputs = { visibility: entry.visibility };

  const lengthValue =
    [entry.length_category, entry.page_count && `${entry.page_count} pages`]
      .filter(Boolean)
      .join(" · ") || null;

  const aiDetailRule: DisclosureRuleId = disclosure.isAi
    ? visibilityRule
    : "ai_detail_requires_declaration";

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

  return [
    row("Title", entry.title, visibilityRule, visibilityInputs),
    row("Logline", entry.logline, visibilityRule, visibilityInputs),
    row("Genre", entry.genre, visibilityRule, visibilityInputs),
    row("Length / page count", lengthValue, visibilityRule, visibilityInputs),
    row("Writer name", entry.writer_name, "blind_review_identity", {}),
    row("Writer email", entry.writer_email, "blind_review_contact", {}),
    row("Co-author", entry.co_author, "blind_review_coauthor", {}),
    row(
      "AI disclosure — declared status",
      disclosure.isAi ? "AI-assisted (disclosed)" : "Human-written",
      "ai_disclosure_public_anchor",
      { is_ai_generated: disclosure.isAi },
    ),
    row(
      "AI disclosure — category / genre",
      [disclosure.category, disclosure.genre].filter(Boolean).join(" · ") || null,
      aiDetailRule,
      {
        is_ai_generated: disclosure.isAi,
        ai_category: disclosure.category,
        ai_genre: disclosure.genre,
        visibility: entry.visibility,
      },
    ),
    row(
      "AI prompt text / model config",
      disclosure.hasPrompt ? "(prompt on file)" : null,
      "ai_prompt_never_public",
      { has_prompt: disclosure.hasPrompt },
    ),
    row(
      "Full screenplay text",
      embargoed ? "(under embargo)" : "(script body)",
      scriptBodyRule,
      {
        sharing_mode: entry.sharing_mode,
        embargo_until: entry.embargo_until,
        embargoed,
      },
    ),
    row(
      "Evidence bundle hash",
      entry.evidence_bundle_hash
        ? `${entry.evidence_bundle_hash.slice(0, 10)}…`
        : null,
      hashRule,
      {
        has_hash: Boolean(entry.evidence_bundle_hash),
        visibility: entry.visibility,
      },
    ),
    row(
      "Reviewer identities / correlation ids",
      null,
      "internal_correlation_ids",
      {},
    ),
  ];
}

function buildRationaleLog(entry: EntryRow, fields: FieldRow[]): RationaleLog {
  const disclosure = readDisclosure(entry.ai_fields);
  const rows: RationaleLogRow[] = fields.map((f) => {
    const def = RULE_DEFS[f.ruleId];
    return {
      field: f.label,
      status: f.status,
      rule_id: f.ruleId,
      rule_summary: def.summary,
      rule_plain_language: def.plainLanguage,
      rule_policy: def.policy,
      rule_category: def.category,
      inputs: f.inputs,
      value_present: f.valuePresent,
    };
  });
  return {
    schema: "wys_rationale_log_v1",
    entry_id: entry.id,
    generated_at: new Date().toISOString(),
    visibility: entry.visibility,
    sharing_mode: entry.sharing_mode,
    embargo_until: entry.embargo_until,
    ai_declared: disclosure.isAi,
    counts: {
      visible: fields.filter((f) => f.status === "visible").length,
      conditional: fields.filter((f) => f.status === "conditional").length,
      redacted: fields.filter((f) => f.status === "redacted").length,
    },
    rows,
  };
}

function StatusPill({ status }: { status: Status }) {
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

interface Props {
  entryId: string;
  className?: string;
}

export function WhatYouSeePreview({ entryId, className }: Props) {
  const [entry, setEntry] = useState<EntryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (error) setError("preview_unavailable");
      setEntry((data as EntryRow) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const fields = useMemo(() => (entry ? buildFields(entry) : []), [entry]);
  const isPublic = entry?.visibility === "public";
  const summary = useMemo(() => {
    const v = fields.filter((f) => f.status === "visible").length;
    const c = fields.filter((f) => f.status === "conditional").length;
    const r = fields.filter((f) => f.status === "redacted").length;
    return { v, c, r };
  }, [fields]);
  const rationale = useMemo(
    () => (entry ? buildRationaleLog(entry, fields) : null),
    [entry, fields],
  );
  const validation = useMemo(
    () => (rationale ? validateRationaleLog(rationale) : null),
    [rationale],
  );
  const invalidRowIndices = useMemo(() => {
    const s = new Set<number>();
    validation?.issues.forEach((i) => s.add(i.row_index));
    return s;
  }, [validation]);
  const [logOpen, setLogOpen] = useState(false);

  const guardValidation = (): boolean => {
    if (!validation || validation.valid) return true;
    const unknown = validation.unknown_ids;
    const detail = unknown.length
      ? `Unknown rule id${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`
      : `${validation.issues.length} row(s) missing a rule id`;
    toast.error("Rationale log failed validation", { description: detail });
    return false;
  };

  const copyLog = async () => {
    if (!rationale) return;
    if (!guardValidation()) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(rationale, null, 2));
      toast.success("Rationale log copied");
    } catch {
      toast.error("Copy failed");
    }
  };
  const downloadLog = () => {
    if (!rationale) return;
    if (!guardValidation()) return;
    const blob = new Blob([JSON.stringify(rationale, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wys-rationale-${rationale.entry_id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div
      className={`rounded-xl border border-border/50 bg-card/60 p-4 ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            What you see — public preview
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Field-by-field simulation of your entry's public evidence page, based
            on your current disclosure and visibility settings.
          </p>
        </div>
        {entry && (
          <Badge
            variant="outline"
            className={
              isPublic
                ? "text-[9px] font-mono uppercase tracking-wider border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                : "text-[9px] font-mono uppercase tracking-wider border-amber-500/40 text-amber-300 bg-amber-500/5"
            }
          >
            {isPublic ? "Visibility: public" : `Visibility: ${entry.visibility ?? "default"}`}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : error || !entry ? (
        <p className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
          <Lock className="h-3 w-3" /> Preview unavailable. Only the entry owner
          (or an operator) can see this simulation.
        </p>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="flex flex-wrap items-center gap-3 mb-3 text-[10px] font-mono text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3 text-emerald-400" /> {summary.v} public
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="h-3 w-3 text-amber-400" /> {summary.c}{" "}
              conditional
            </span>
            <span className="inline-flex items-center gap-1">
              <EyeOff className="h-3 w-3" /> {summary.r} redacted
            </span>
          </div>

          <ul className="divide-y divide-border/40 rounded-md border border-border/40 overflow-hidden">
            {fields.map((f) => (
              <li
                key={f.label}
                className="flex items-start gap-3 px-3 py-2 text-xs"
              >
                <div className="min-w-[7rem] pt-0.5">
                  <StatusPill status={f.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground/90">
                      {f.label}
                    </span>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        className="text-muted-foreground/60 hover:text-foreground"
                        aria-label={`Why ${f.label} is ${f.status}`}
                      >
                        <Info className="h-3 w-3" />
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-xs text-[11px] leading-relaxed"
                      >
                        <div className="font-mono text-[10px] text-muted-foreground mb-1">
                          rule: {f.ruleId}
                        </div>
                        {RULE_DEFS[f.ruleId].summary}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div
                    className={`mt-0.5 truncate ${
                      f.status === "redacted"
                        ? "text-muted-foreground/50 italic"
                        : "text-muted-foreground"
                    }`}
                  >
                    {f.status === "redacted"
                      ? f.value
                        ? `[hidden — ${f.value}]`
                        : "[hidden]"
                      : (f.value ?? <span className="italic">(not set)</span>)}
                  </div>
                  <div className="mt-1 font-mono text-[9.5px] text-muted-foreground/70">
                    rule · {f.ruleId}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[10px] text-muted-foreground italic flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 shrink-0 mt-0.5 text-primary/70" />
            "Conditional" fields become public only when your entry's visibility
            is set to <code className="font-mono">public</code>. Redacted fields
            stay hidden even then — they are protected by design.
          </p>

          {rationale && (
            <div className="mt-3 rounded-md border border-border/40 bg-muted/10 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setLogOpen((v) => !v)}
                  aria-expanded={logOpen}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/90 hover:text-foreground"
                >
                  {logOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  Rationale log
                  <Badge
                    variant="outline"
                    className="ml-1 text-[9px] font-mono border-border/50 text-muted-foreground"
                  >
                    {rationale.schema}
                  </Badge>
                </button>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={copyLog}
                    aria-label="Copy rationale log JSON"
                  >
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={downloadLog}
                    aria-label="Download rationale log JSON"
                  >
                    <Download className="h-3 w-3 mr-1" /> JSON
                  </Button>
                </div>
              </div>
              {validation && !validation.valid && (
                <div
                  role="alert"
                  className="border-t border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[10.5px] text-destructive"
                >
                  <div className="flex items-start gap-1.5">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {validation.issues.length} row
                        {validation.issues.length === 1 ? "" : "s"} failed rule-id
                        validation — export is blocked until this is fixed.
                      </p>
                      {validation.unknown_ids.length > 0 && (
                        <p className="mt-0.5 font-mono text-[10px] break-all">
                          Unknown id{validation.unknown_ids.length > 1 ? "s" : ""}:{" "}
                          {validation.unknown_ids.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {logOpen && (
                <div className="border-t border-border/40 bg-background/40">
                  <table className="w-full text-[10.5px]">
                    <thead className="text-muted-foreground">
                      <tr className="text-left">
                        <th className="px-2 py-1 font-medium">Field</th>
                        <th className="px-2 py-1 font-medium">Status</th>
                        <th className="px-2 py-1 font-medium">Rule</th>
                        <th className="px-2 py-1 font-medium">Why (plain language)</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {rationale.rows.map((r, idx) => {
                        const bad = invalidRowIndices.has(idx);
                        return (
                          <tr
                            key={r.field}
                            className={`border-t border-border/30 align-top ${bad ? "bg-destructive/10" : ""}`}
                          >
                            <td className="px-2 py-1 text-foreground/80">{r.field}</td>
                            <td className="px-2 py-1 uppercase">
                              {r.status === "visible" ? "public" : r.status}
                            </td>
                            <td
                              className={`px-2 py-1 whitespace-nowrap ${bad ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                            >
                              {r.rule_id || "(missing)"}
                              {bad && (
                                <span className="ml-1 font-sans font-normal">
                                  ⚠ unknown
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-1 normal-case font-sans">
                              <p className="text-foreground/85 leading-snug">
                                {r.rule_plain_language}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground/80 italic leading-snug">
                                {r.rule_summary}
                              </p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </TooltipProvider>
      )}
    </div>
  );
}

export default WhatYouSeePreview;
