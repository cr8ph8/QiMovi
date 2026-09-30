import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, FileText, Sparkles } from "lucide-react";

interface EntryDisclosure {
  declared_influences?: string[] | null;
  ai_fields?: Record<string, unknown> | null;
  ai_tools_used?: string[] | null;
  ai_influence_score?: number | null;
  disclosure_type?: string | null;
  ai_influence_trace?: string | null;
}

interface Props {
  disclosure: EntryDisclosure | null | undefined;
  /** Mapping of rubric dimension key → human label, for AI-influenced dims. */
  influencedDimensions?: Array<{ key: string; label: string; sources?: string[] }>;
}

export function AIDisclosureCallout({ disclosure, influencedDimensions = [] }: Props) {
  if (!disclosure) {
    return (
      <Card className="p-3 border-border/40 bg-background/40">
        <div className="flex items-start gap-2">
          <Bot className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground/90">AI Evaluation Notice</span>
            <p className="mt-0.5">
              This entry was evaluated using an AI-assisted judging pipeline. The writer did not
              submit an AI authorship disclosure.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const tools = disclosure.ai_tools_used ?? [];
  const influences = disclosure.declared_influences ?? [];
  const influenceScore = disclosure.ai_influence_score;
  const disclosureType = disclosure.disclosure_type;

  const hasContent = tools.length > 0 || influences.length > 0 || influenceScore != null || disclosureType;

  if (!hasContent) {
    return (
      <Card className="p-3 border-border/40 bg-background/40">
        <div className="flex items-start gap-2">
          <Bot className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground/90">AI Evaluation Notice</span>
            <p className="mt-0.5">
              This entry was evaluated using an AI-assisted judging pipeline. No AI use was declared
              by the writer.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3 border-border/40 bg-background/40 space-y-2">
      <div className="flex items-start gap-2">
        <Bot className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed">
          <span className="font-semibold text-foreground/90">AI Evaluation & Disclosure</span>
          <p className="mt-0.5 text-muted-foreground">
            This scorecard was produced by an AI-assisted judging pipeline. The writer provided the
            following AI authorship disclosure at time of submission.
          </p>
        </div>
      </div>

      <div className="space-y-1.5 pl-6">
        {disclosureType && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <FileText className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Disclosure type:</span>
            <Badge variant="outline" className="text-[10px] font-mono uppercase">
              {disclosureType}
            </Badge>
          </div>
        )}

        {influenceScore != null && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <Sparkles className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Evaluated AI influence:</span>
            <span className="font-mono text-foreground/90">{Number(influenceScore).toFixed(0)}%</span>
          </div>
        )}

        {tools.length > 0 && (
          <div className="text-[11px]">
            <span className="text-muted-foreground">Tools declared:</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {tools.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px] font-mono">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {influences.length > 0 && (
          <div className="text-[11px]">
            <span className="text-muted-foreground">Influenced areas:</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {influences.map((i) => (
                <Badge key={i} variant="secondary" className="text-[10px] font-mono">
                  {i}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {influencedDimensions.length > 0 && (
          <div className="text-[11px] border-t border-border/30 pt-1.5 mt-1">
            <span className="text-muted-foreground">Maps to scored rubric dimensions:</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {influencedDimensions.map((d) => (
                <Badge
                  key={d.key}
                  variant="outline"
                  className="text-[10px] font-mono border-primary/40 text-primary/90 gap-1"
                  title={d.sources?.length ? `Mapped from: ${d.sources.join(", ")}` : undefined}
                >
                  <Bot className="h-2.5 w-2.5" />
                  {d.label}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/80 italic">
              Rubric dimensions with this badge were marked as AI-touched by the writer's disclosure.
              The same badge appears next to those dimensions in the breakdown below.
            </p>
          </div>
        )}

        {disclosure.ai_influence_trace && (
          <div className="text-[10px] text-muted-foreground border-t border-border/30 pt-1.5 mt-1">
            <span className="font-mono uppercase text-[9px] tracking-wider">Trace</span>
            <p className="mt-0.5 italic">{disclosure.ai_influence_trace}</p>
          </div>
        )}
      </div>
    </Card>
  );
}
