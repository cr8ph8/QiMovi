import { useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useStructuredParse, type StructuredFields } from "@/hooks/useStructuredParse";

interface Props {
  entryId: string;
  pageCount?: number | null;
  /** Existing structured payload from entries.parsed_metadata.structured */
  initial?: StructuredFields | null;
  /** Disable the action (e.g. read-only public view). */
  readOnly?: boolean;
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  protagonist: "default",
  antagonist: "secondary",
  supporting: "outline",
  ensemble: "outline",
  minor: "outline",
};

/**
 * Self-contained panel that lets the owner parse a screenplay into structured
 * fields (logline / genre / synopsis / themes / characters) without touching
 * the raw script_text. Shows cached output from parsed_metadata.structured
 * when present; otherwise prompts the user to run extraction.
 */
export function StructuredFieldsPanel({ entryId, pageCount, initial, readOnly }: Props) {
  const { run, loading, error, result } = useStructuredParse();
  const [cached, setCached] = useState<StructuredFields | null>(initial ?? null);

  useEffect(() => {
    if (result) setCached(result);
  }, [result]);

  const data = result ?? cached;

  const handleRun = async () => {
    const out = await run({ entryId, pageCount: pageCount ?? undefined, persist: true });
    if (out) toast.success("Structured fields extracted");
  };

  const parsedAt = useMemo(() => {
    if (!data?.parsed_at) return null;
    try { return new Date(data.parsed_at).toLocaleString(); } catch { return null; }
  }, [data?.parsed_at]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-5 w-5 text-primary" />
            Structured Fields
          </CardTitle>
          <CardDescription>
            AI-extracted logline, genre, synopsis, themes, and characters. Raw screenplay text is preserved.
          </CardDescription>
        </div>
        {!readOnly && (
          <Button onClick={handleRun} disabled={loading} size="sm" variant={data ? "outline" : "default"}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : data ? "Re-parse" : "Extract"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!data && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            No structured fields yet. {readOnly ? "" : "Click Extract to generate them."}
          </p>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> {data.confidence}% confidence
              </Badge>
              {data.model_id && <span>· {data.model_id}</span>}
              {parsedAt && <span>· {parsedAt}</span>}
            </div>

            <Field label="Logline">{data.logline}</Field>
            <Field label="Genre">{data.genre}</Field>
            <Field label="Synopsis">{data.synopsis}</Field>

            {data.themes?.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Themes</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.themes.map((t) => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            {data.characters?.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                  Characters ({data.characters.length})
                </div>
                <ul className="space-y-2">
                  {data.characters.map((c) => (
                    <li key={c.name} className="rounded-md border border-border/60 bg-card/50 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-medium">{c.name}</span>
                        <Badge variant={ROLE_VARIANT[c.role] ?? "outline"} className="capitalize text-[10px]">
                          {c.role}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{c.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <p className="text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  );
}
