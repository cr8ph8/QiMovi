import { Link } from "react-router-dom";
import { LayoutTemplate } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TEMPLATES = [
  { id: "blank", title: "Blank Screenplay", desc: "Start from an empty Fountain file." },
  { id: "short-film", title: "Short Film", desc: "Slugline + 3-act outline scaffold for 6–19 pages." },
  { id: "tv-pilot-30", title: "30-Minute Pilot", desc: "Cold open + teaser + 2 acts." },
  { id: "feature", title: "Feature", desc: "Full 3-act feature scaffold with logline header." },
];

/**
 * Lightweight templates gallery. Phase 1: presentational — clicking a tile
 * routes the writer into the editor with the chosen scaffold (handled by the
 * kernel-aware new-draft flow in Phase 2).
 */
export default function TemplatesPanel({ draftId }: { draftId?: string }) {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-3">
        <LayoutTemplate className="h-5 w-5 text-primary" />
        <h2 className="font-playfair text-2xl font-bold">Templates</h2>
      </div>
      <p className="mb-8 max-w-2xl text-sm text-muted-foreground">
        Start a new screenplay from a scaffold, or apply one to the current draft. Templates seed the editor
        with sluglines, headings, and pacing markers — they don't change scoring or analysis.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => (
          <Card key={t.id} className="p-5 flex flex-col gap-3 hover:border-primary/40 transition-colors">
            <div>
              <h3 className="font-semibold text-foreground">{t.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
            </div>
            <div className="mt-auto flex gap-2">
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link to={`/write?template=${t.id}${draftId ? `&from=${draftId}` : ""}`}>Use template</Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
