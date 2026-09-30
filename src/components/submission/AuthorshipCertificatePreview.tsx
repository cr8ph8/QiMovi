import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, Pencil, Check, X, FileSignature, Bot, User as UserIcon } from "lucide-react";
import { ATTESTATION_TEXT } from "./SubmissionAttestationDialog";
import type { JudgingTier } from "@/lib/submission/eligibility";

export interface CertificatePreviewValues {
  isAiGenerated: boolean;
  aiPrompt: string;
  aiCategory: string;
  aiGenre: string;
}

interface Props {
  title: string;
  author: string | null;
  logline: string;
  genre: string;
  categoryLabel: string;
  pageCount: number | null;
  tier: JudgingTier;
  acknowledgedImprint: boolean;
  values: CertificatePreviewValues;
  onChange: (patch: Partial<CertificatePreviewValues>) => void;
  onEditDetails?: () => void;
}

const AI_CATEGORIES = ["vertical", "micro", "short", "pilot_30", "pilot_60", "feature"] as const;
const AI_GENRES = ["Drama", "Comedy", "Thriller", "Horror", "Sci-Fi", "Action", "Romance", "Mystery", "Other"] as const;

/**
 * Read-once "what will be attested" panel shown on the Confirm step of the
 * Submission Portal. Surfaces every field that is about to be recorded to the
 * evidence bundle (title/author/logline/genre/category), the AI disclosure
 * capture (editable inline), the imprint acknowledgement, and the full
 * attestation clause the entrant will sign in the tier dialog.
 *
 * This is intentionally non-mutating for the attestation text itself — the
 * clause is the source of truth for the authorship certificate and only the
 * disclosure fields can be edited inline before the final sign-off.
 */
export default function AuthorshipCertificatePreview({
  title,
  author,
  logline,
  genre,
  categoryLabel,
  pageCount,
  tier,
  acknowledgedImprint,
  values,
  onChange,
  onEditDetails,
}: Props) {
  const [editingAi, setEditingAi] = useState(false);

  const tierLabel = useMemo(() => {
    if (tier === "finalist") return "Finalist tier";
    if (tier === "festival") return "Festival tier";
    return "Standard tier";
  }, [tier]);

  const disclosureFilled = values.isAiGenerated
    ? values.aiPrompt.trim().length >= 20 && !!values.aiCategory && !!values.aiGenre
    : true;

  return (
    <section
      aria-labelledby="authorship-cert-heading"
      className="rounded-xl border border-primary/30 bg-card/80 p-5 space-y-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <FileSignature className="h-5 w-5 text-primary mt-0.5" aria-hidden="true" />
          <div>
            <h4
              id="authorship-cert-heading"
              className="font-display text-sm font-semibold uppercase tracking-wider"
            >
              Authorship Certificate · Preview
            </h4>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Everything below will be recorded to your evidence bundle and, for
              festival/finalist tiers, signed via the attestation dialog.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            tier === "standard"
              ? "border-muted-foreground/30 text-muted-foreground text-[10px] font-mono"
              : "border-primary/40 text-primary text-[10px] font-mono"
          }
        >
          {tierLabel}
        </Badge>
      </header>

      {/* Metadata block */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs border border-border/30 rounded-lg p-3 bg-muted/20">
        <div className="flex justify-between gap-2 min-w-0">
          <dt className="text-muted-foreground">Title</dt>
          <dd className="font-semibold truncate">{title || <span className="text-destructive">—</span>}</dd>
        </div>
        <div className="flex justify-between gap-2 min-w-0">
          <dt className="text-muted-foreground">Author</dt>
          <dd className="font-semibold truncate">{author || <span className="text-destructive">—</span>}</dd>
        </div>
        <div className="flex justify-between gap-2 min-w-0">
          <dt className="text-muted-foreground">Genre</dt>
          <dd className="font-semibold truncate">{genre || "—"}</dd>
        </div>
        <div className="flex justify-between gap-2 min-w-0">
          <dt className="text-muted-foreground">Category</dt>
          <dd className="font-semibold truncate">{categoryLabel || "—"}</dd>
        </div>
        <div className="flex justify-between gap-2 min-w-0">
          <dt className="text-muted-foreground">Pages</dt>
          <dd className="font-mono">{pageCount ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2 min-w-0">
          <dt className="text-muted-foreground">Imprint ack.</dt>
          <dd className="font-mono">
            {acknowledgedImprint ? (
              <span className="text-primary">recorded</span>
            ) : (
              <span className="text-muted-foreground">not yet</span>
            )}
          </dd>
        </div>
        {logline && (
          <div className="sm:col-span-2 pt-1 border-t border-border/30">
            <dt className="text-muted-foreground text-[11px]">Logline</dt>
            <dd className="italic text-foreground/80 mt-0.5">{logline}</dd>
          </div>
        )}
      </dl>

      {/* AI disclosure */}
      <div className="rounded-lg border border-border/40 p-3 bg-muted/10 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {values.isAiGenerated ? (
              <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
            ) : (
              <UserIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            )}
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI disclosure
            </span>
            <Badge
              variant="outline"
              className={
                disclosureFilled
                  ? "text-[10px] font-mono border-primary/30 text-primary"
                  : "text-[10px] font-mono border-destructive/40 text-destructive"
              }
            >
              {disclosureFilled ? "complete" : "incomplete"}
            </Badge>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setEditingAi((v) => !v)}
            aria-expanded={editingAi}
          >
            {editingAi ? (
              <><Check className="h-3.5 w-3.5" /> Done</>
            ) : (
              <><Pencil className="h-3.5 w-3.5" /> Edit</>
            )}
          </Button>
        </div>

        {!editingAi ? (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground text-[11px]">AI generated</dt>
              <dd className="font-mono">{values.isAiGenerated ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[11px]">AI category</dt>
              <dd className="font-mono">{values.isAiGenerated ? values.aiCategory || "—" : "n/a"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[11px]">AI genre</dt>
              <dd className="font-mono">{values.isAiGenerated ? values.aiGenre || "—" : "n/a"}</dd>
            </div>
            {values.isAiGenerated && (
              <div className="sm:col-span-3">
                <dt className="text-muted-foreground text-[11px]">Prompt on record</dt>
                <dd className="mt-1 rounded border border-border/40 bg-background/60 p-2 text-[11px] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {values.aiPrompt || <span className="text-destructive">— missing —</span>}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium">This work is AI-generated</span>
              <Switch
                checked={values.isAiGenerated}
                onCheckedChange={(v) => onChange({ isAiGenerated: !!v })}
                aria-label="Toggle AI-generated disclosure"
              />
            </label>
            {values.isAiGenerated && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-[11px]">AI category</Label>
                  <Select value={values.aiCategory} onValueChange={(v) => onChange({ aiCategory: v })}>
                    <SelectTrigger className="mt-1 h-8 text-xs bg-muted border-border">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">AI genre</Label>
                  <Select value={values.aiGenre} onValueChange={(v) => onChange({ aiGenre: v })}>
                    <SelectTrigger className="mt-1 h-8 text-xs bg-muted border-border">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {AI_GENRES.map((g) => (
                        <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-[11px]">Prompt used (min 20 chars)</Label>
                  <Textarea
                    value={values.aiPrompt}
                    onChange={(e) => onChange({ aiPrompt: e.target.value.slice(0, 4000) })}
                    placeholder="Describe the exact prompt / instructions given to the AI…"
                    className="mt-1 bg-muted border-border min-h-[80px] text-xs"
                  />
                  <div className="mt-1 text-[10px] text-muted-foreground text-right font-mono">
                    {values.aiPrompt.trim().length}/4000
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Attestation clause */}
      <div className="rounded-lg border border-border/40 p-3 bg-muted/10">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Attestation clause
          </span>
          {tier === "standard" ? (
            <Badge variant="outline" className="text-[10px] font-mono border-muted-foreground/30 text-muted-foreground">
              informational
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] font-mono border-primary/40 text-primary">
              signature required
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{ATTESTATION_TEXT}</p>
        {tier !== "standard" && (
          <ul className="mt-2 text-[11px] text-muted-foreground list-disc pl-5 space-y-0.5">
            <li>Sole author or written co-author authorization</li>
            <li>Hold or have licensed all rights required to submit</li>
            <li>Accept the competition terms and platform content policies</li>
          </ul>
        )}
      </div>

      {onEditDetails && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={onEditDetails}
          >
            <X className="h-3.5 w-3.5" /> Fix in Details step
          </Button>
        </div>
      )}
    </section>
  );
}
