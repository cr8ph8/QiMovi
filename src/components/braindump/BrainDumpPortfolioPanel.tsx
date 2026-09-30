import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Brain,
  Plus,
  ExternalLink,
  Loader2,
  FileText,
  Crown,
  Sparkles,
  Clock,
  ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FeatureTierGate } from "@/components/platform/FeatureTierGate";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { BrainDumpProGate } from "./BrainDumpProGate";

type BriefRow = {
  id: string;
  title: string | null;
  confidence: number | null;
  created_at: string;
  entry_id: string | null;
  entries?: { id: string; title: string } | null;
};

type SavedDraft = {
  title?: string;
  rawText?: string;
  selectedEntryId?: string;
  savedAt?: string;
};

const DRAFT_KEY = "braindump:draft";

function readSavedDraft(): SavedDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedDraft;
    if (!d?.rawText || d.rawText.trim().length === 0) return null;
    return d;
  } catch {
    return null;
  }
}

function BrainDumpPanelInner() {
  const { user } = useAuth();
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SavedDraft | null>(null);

  useEffect(() => {
    setDraft(readSavedDraft());
    const onStorage = () => setDraft(readSavedDraft());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("project_briefs")
        .select("id, title, confidence, created_at, entry_id, entries(id, title)")
        .order("created_at", { ascending: false })
        .limit(5);
      setBriefs((data ?? []) as unknown as BriefRow[]);
      setLoading(false);
    })();
  }, [user]);

  const linkedCount = useMemo(() => briefs.filter((b) => b.entries).length, [briefs]);

  const draftPreview = (draft?.rawText ?? "").trim().slice(0, 140);
  const draftAge = draft?.savedAt ? new Date(draft.savedAt).toLocaleString() : null;

  return (
    <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card shadow-lg">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl"
      />
      <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Brain Dump
            <Badge className="gap-1 bg-primary/15 text-primary border border-primary/30 text-[10px] font-mono uppercase tracking-wider hover:bg-primary/20">
              <Crown className="h-2.5 w-2.5" /> Pro mode
            </Badge>
          </CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Drafts and briefs save automatically — pick up where you left off.
          </p>
        </div>
        <Link to="/brain-dump">
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New brain dump
          </Button>
        </Link>
      </CardHeader>

      <CardContent className="relative space-y-3">
        {/* Saved context: unsaved draft */}
        {draft && (
          <Link
            to="/brain-dump"
            className="block rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5 transition hover:bg-primary/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-primary">
                <Sparkles className="h-3 w-3" />
                Resume your draft
              </div>
              {draftAge && (
                <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {draftAge}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm font-medium truncate">
              {draft.title || "Untitled draft"}
            </div>
            {draftPreview && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {draftPreview}
                {draft.rawText && draft.rawText.length > 140 ? "…" : ""}
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-primary">
              Continue editing <ArrowRight className="h-3 w-3" />
            </div>
          </Link>
        )}

        {/* Saved briefs */}
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : briefs.length === 0 ? (
          !draft && (
            <p className="text-xs text-muted-foreground italic">
              No briefs yet. Pour your first messy idea in and let AI organize it.
            </p>
          )
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Recent briefs</span>
              {linkedCount > 0 && (
                <span className="text-primary/80">
                  {linkedCount} linked to a screenplay
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {briefs.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between rounded-md border border-border/50 bg-background/40 px-3 py-2 text-sm"
                >
                  <Link to="/brain-dump" className="flex-1 min-w-0 hover:text-primary">
                    <div className="font-medium truncate">{b.title || "Untitled"}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <span>{new Date(b.created_at).toLocaleDateString()}</span>
                      {b.confidence != null && (
                        <span>· {(b.confidence * 100).toFixed(0)}% conf.</span>
                      )}
                      {b.entries && (
                        <span className="inline-flex items-center gap-0.5 text-primary">
                          · <FileText className="h-2.5 w-2.5" />
                          {b.entries.title}
                        </span>
                      )}
                    </div>
                  </Link>
                  {b.entries && (
                    <Link to={`/entry/${b.entries.id}`}>
                      <Button size="icon" variant="ghost" className="h-7 w-7">
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function BrainDumpPortfolioPanel() {
  const { canAccessFeature, loading } = useSubscription();
  if (loading) return null;
  if (!canAccessFeature("pro")) return <BrainDumpProGate compact />;
  return (
    <FeatureTierGate id="brain_dump">
      <BrainDumpPanelInner />
    </FeatureTierGate>
  );
}
