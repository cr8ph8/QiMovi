import { useMemo } from "react";
import { parseFountain } from "@/lib/fountain-parser";
import { paginateElements } from "@/lib/fountain-paginator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, BarChart3, Crown, FileText, Upload } from "lucide-react";
import { Link } from "react-router-dom";

interface FreeScreenplayPreviewProps {
  scriptText: string;
  title?: string;
  genre?: string | null;
  pageCount?: number | null;
  lengthCategory?: string | null;
  totalScore?: number | null;
  maxScore?: number;
  onViewStats?: () => void;
  isOwner?: boolean;
  onReupload?: () => void;
}

export default function FreeScreenplayPreview({
  scriptText,
  title,
  genre,
  pageCount,
  lengthCategory,
  totalScore,
  maxScore = 100,
  onViewStats,
  isOwner,
  onReupload,
}: FreeScreenplayPreviewProps) {
  const parsed = useMemo(() => parseFountain(scriptText || ""), [scriptText]);
  const paginated = useMemo(() => paginateElements(parsed.elements), [parsed.elements]);

  const firstPageElements = paginated.pages[0] || [];

  if (!scriptText || parsed.elements.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        {isOwner && onReupload ? (
          <>
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-display text-lg font-semibold mb-2">No screenplay text found</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-xs leading-relaxed">
              Upload your screenplay PDF to populate the viewer with parsed text.
            </p>
            <Button onClick={onReupload} className="font-body gap-2">
              <Upload className="h-4 w-4" /> Upload Screenplay
            </Button>
          </>
        ) : (
          <>
            <FileText className="h-12 w-12 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">No screenplay text available</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-card/50 shrink-0">
        <div className="flex items-center gap-2">
          {title && (
            <span className="text-xs font-mono font-semibold text-foreground truncate max-w-[200px]">
              {title}
            </span>
          )}
          {pageCount && (
            <Badge variant="outline" className="text-[9px] font-mono">
              {pageCount} pg
            </Badge>
          )}
          {genre && (
            <Badge variant="secondary" className="text-[9px] font-mono">
              {genre}
            </Badge>
          )}
          {lengthCategory && (
            <Badge variant="outline" className="text-[9px] font-mono capitalize border-primary/30 text-primary">
              {lengthCategory}
            </Badge>
          )}
        </div>
        {totalScore !== null && totalScore !== undefined && (
          <span className="text-sm font-mono font-bold text-primary">
            {totalScore}<span className="text-muted-foreground font-normal text-xs">/{maxScore}</span>
          </span>
        )}
      </div>

      {/* Preview — first page read-only */}
      <div className="flex-1 overflow-hidden relative">
        <div className="p-6 mx-auto max-w-[500px]">
          {/* Title page */}
          {paginated.titlePage && (
            <div className="mb-6 text-center">
              {paginated.titlePage.title && (
                <h2 className="font-mono text-lg font-bold text-foreground uppercase tracking-wide mb-2">
                  {paginated.titlePage.title}
                </h2>
              )}
              {paginated.titlePage.credit && (
                <p className="font-mono text-sm text-muted-foreground mb-1">{paginated.titlePage.credit}</p>
              )}
              {paginated.titlePage.author && (
                <p className="font-mono text-sm text-foreground">{paginated.titlePage.author}</p>
              )}
              {(paginated.titlePage as any).co_author && (
                <p className="font-mono text-sm text-foreground mt-1">& {(paginated.titlePage as any).co_author}</p>
              )}
              <hr className="border-border/30 my-4" />
            </div>
          )}

          {/* First page elements */}
          <div className="space-y-0">
            {firstPageElements.slice(0, 20).map((el, i) => (
              <div key={i} className="font-mono text-xs text-secondary-foreground">
                {el.type === "scene_heading" ? (
                  <p className="font-bold text-primary uppercase tracking-wide mt-4 mb-1 text-sm">{el.text}</p>
                ) : el.type === "character" ? (
                  <p className="font-semibold uppercase text-center mt-3 mb-0.5 tracking-wider">{el.text}</p>
                ) : el.type === "dialogue" ? (
                  <p className="text-center mx-auto max-w-[280px] leading-relaxed">{el.text}</p>
                ) : el.type === "parenthetical" ? (
                  <p className="italic text-muted-foreground text-center mx-auto max-w-[240px]">{el.text}</p>
                ) : el.type === "transition" ? (
                  <p className="text-muted-foreground uppercase text-right mt-2 mb-1">{el.text}</p>
                ) : el.type === "empty" ? (
                  <div className="h-2" />
                ) : (
                  <p className="leading-relaxed my-1">{el.text}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Frosted glass upgrade overlay */}
        <div className="absolute inset-0 top-1/3 bg-gradient-to-t from-background via-background/95 to-transparent flex flex-col items-center justify-end pb-12">
          <div className="rounded-2xl border border-border/50 bg-card/90 backdrop-blur-md p-8 max-w-sm w-full mx-4 text-center shadow-lg">
            <div className="p-3 rounded-full bg-primary/10 inline-flex mb-4">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-display text-lg font-bold mb-2">Full Screenplay Viewer</h3>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              Upgrade to <span className="font-semibold text-foreground">Pro</span> to unlock the interactive screenplay viewer with highlights, annotations, modules, and page navigation.
            </p>
            <div className="flex flex-col gap-2.5">
              <Link to="/pricing">
                <Button className="w-full bg-gold-gradient font-body font-semibold text-primary-foreground gap-2">
                  <Crown className="h-4 w-4" /> Upgrade to Pro
                </Button>
              </Link>
              {onViewStats && (
                <Button variant="outline" className="w-full font-body gap-2" onClick={onViewStats}>
                  <BarChart3 className="h-4 w-4" /> View Stats & Scores
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
