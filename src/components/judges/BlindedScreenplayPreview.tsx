/**
 * BlindedScreenplayPreview — judge-facing, author-stripped read of an entry's
 * screenplay body.
 *
 * Reads `script_text` from `v_judge_entry_blind` (RLS: admins + assigned
 * competition judges only). The view already runs the body through
 * `public.redact_script_for_judge()` on the server — title-page block,
 * emails, phones, URLs, handles, WGA IDs, byline/copyright/draft-meta lines
 * are stripped before the row ever leaves the database. The client-side
 * `blindScreenplay()` pass here is defense-in-depth for any straggler token.
 *
 * The identity columns (`writer_name`, `author`, `co_author`) are not
 * projected by the view, so this component cannot see them even if a future
 * edit tries to select them.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  blindScreenplay,
  REDACTION_LABEL,
  type BlindResult,
} from "@/lib/blindScreenplay";
import { cn } from "@/lib/utils";

interface Props {
  entryId: string | null;
  className?: string;
}

export function BlindedScreenplayPreview({ entryId, className }: Props) {
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setScriptText(null);
    (async () => {
      const { data, error } = await supabase
        .from("v_judge_entry_blind")
        .select("script_text,page_count")
        .eq("id", entryId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else if (!data) {
        setError("Entry not found or not readable.");
      } else {
        setScriptText(typeof data.script_text === "string" ? data.script_text : "");
        setPageCount(data.page_count ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const blinded: BlindResult = useMemo(
    // No author-name hints — the view has already stripped identity server-side.
    () => blindScreenplay(scriptText, { authorNames: [] }),
    [scriptText],
  );


  return (
    <section
      aria-labelledby="blinded-preview-title"
      className={cn(
        "rounded-xl border border-border/50 bg-card/60 p-4 space-y-3",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3
            id="blinded-preview-title"
            className="flex items-center gap-1.5 font-display text-sm font-semibold"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Blinded screenplay preview
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Author metadata is stripped from this view. Use this preview to
            score without seeing writer identity — the raw PDF link in the
            header remains available for post-decision reference.
          </p>
        </div>
        {pageCount != null && (
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-border/50 text-muted-foreground"
          >
            {pageCount} pages
          </Badge>
        )}
      </header>

      {!entryId ? (
        <p className="text-[11px] text-muted-foreground italic">
          Select an entry to load its blinded preview.
        </p>
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground/90"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <div className="font-semibold">Preview unavailable</div>
            <div className="opacity-80">{error}</div>
          </div>
        </div>
      ) : !blinded.text.trim() ? (
        <p className="text-[11px] text-muted-foreground italic">
          This entry has no script body attached. Judges should score from the
          uploaded PDF referenced in the scorecard header.
        </p>
      ) : (
        <>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Redaction summary"
          >
            {blinded.totalRedactions === 0 ? (
              <Badge
                variant="outline"
                className="text-[10px] font-mono uppercase tracking-wider border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
              >
                <Eye className="h-2.5 w-2.5 mr-1" aria-hidden="true" />
                No identifying signals detected
              </Badge>
            ) : (
              <>
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono uppercase tracking-wider border-primary/40 text-primary bg-primary/5"
                >
                  <EyeOff className="h-2.5 w-2.5 mr-1" aria-hidden="true" />
                  {blinded.totalRedactions} redaction
                  {blinded.totalRedactions === 1 ? "" : "s"} applied
                </Badge>
                {blinded.redactions.map((r) => (
                  <Badge
                    key={r.kind}
                    variant="outline"
                    className="text-[10px] font-mono border-border/40 text-muted-foreground"
                    title={`${r.count} ${REDACTION_LABEL[r.kind]} stripped from preview`}
                  >
                    {r.count} × {REDACTION_LABEL[r.kind]}
                  </Badge>
                ))}
              </>
            )}
          </div>

          <pre
            aria-label="Blinded screenplay body"
            className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-foreground/90 max-h-[60vh] overflow-y-auto rounded-md border border-border/40 bg-background/60 p-3"
          >
            {blinded.text}
          </pre>

          <p className="text-[10px] text-muted-foreground italic flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 opacity-0" aria-hidden="true" />
            Redactions run client-side against the script body. Judges must
            still avoid searching for the writer identity in external systems.
          </p>
        </>
      )}
    </section>
  );
}

export default BlindedScreenplayPreview;
