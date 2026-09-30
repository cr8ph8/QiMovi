/**
 * PublicEvidence — read-only evidence & provenance page for future readers.
 *
 * Route: /read/:id/evidence
 *
 * Renders three sections against the entrant-facing view of an entry:
 *   1. AI / authorship disclosure — derived only from the public-safe
 *      `method_type` field. The free-form `ai_fields` JSON stays private.
 *   2. Public scorecard — through the canonical `UnifiedScorecard`
 *      component (finalized totals + dimension breakdown; qualitative
 *      reviews only appear when RLS makes them public).
 *   3. Rollback / restore history — governance events for
 *      `publication_claims_restored`, rendered through the shared
 *      `ReceiptTrail` in *entrant* redaction mode so hashes, correlation
 *      ids, and actor ids are stripped.
 *
 * The page is intentionally strict: only rows admitted by `public_entries`
 * are shown. Everything else 404s.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  FileText,
  History,
  Layers,
  Lock,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { UnifiedScorecard } from "@/components/scoring/UnifiedScorecard";
import {
  ReceiptTrail,
  type ReceiptEntry,
} from "@/components/evidence/ReceiptTrail";

interface PublicEntry {
  id: string;
  title: string;
  logline: string | null;
  genre: string | null;
  length_category: string | null;
  page_count: number | null;
  created_at: string | null;
  method_type: "ai" | "human" | "hybrid" | null;
  visibility: string | null;
}

interface RestoreRow {
  id: string;
  created_at: string;
  from_version: number | null;
  new_version: number | null;
  reason_code: string | null;
  reason_notes: string | null;
}

export default function PublicEvidence() {
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<PublicEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [restoreHistory, setRestoreHistory] = useState<RestoreRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("public_entries")
        .select(
          "id,title,logline,genre,length_category,page_count,created_at,method_type,visibility",
        )
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setEntry(null);
      } else {
        setEntry(data as PublicEntry);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    (async () => {
      setHistoryLoading(true);
      // Rollback history is best-effort: RLS may deny anon reads on
      // `governance_events`. In that case we simply render an empty trail
      // rather than surface an error to public readers.
      try {
        const { data } = await (supabase as any)
          .from("governance_events")
          .select("id, created_at, metadata_json")
          .eq("event_type", "publication_claims_restored")
          .order("created_at", { ascending: false })
          .limit(50);
        if (cancelled) return;
        const rows: RestoreRow[] = (data ?? [])
          .filter((r: any) => {
            const m = r.metadata_json ?? {};
            return m.record_id === id || m.entry_id === id;
          })
          .map((r: any) => {
            const m = r.metadata_json ?? {};
            return {
              id: r.id,
              created_at: r.created_at,
              from_version: m.from_version ?? null,
              new_version: m.new_version ?? null,
              reason_code: m.reason_code ?? null,
              reason_notes: m.reason_notes ?? null,
            };
          });
        setRestoreHistory(rows);
      } catch {
        if (!cancelled) setRestoreHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const disclosure = useMemo(() => {
    const method = entry?.method_type ?? "human";
    return {
      assisted: method === "ai" || method === "hybrid",
      label: method === "ai"
        ? "AI-generated"
        : method === "hybrid"
          ? "Hybrid authorship"
          : "Human-authored",
    };
  }, [entry?.method_type]);

  const restoreEntries: ReceiptEntry[] = useMemo(
    () =>
      restoreHistory.map((h) => ({
        id: h.id,
        timestamp: h.created_at,
        title: `Restored v${h.from_version ?? "?"} → v${h.new_version ?? "?"}`,
        badges: h.reason_code
          ? [{ label: h.reason_code, tone: "warn" as const }]
          : [],
        notes: h.reason_notes ?? undefined,
        // Redacted for public readers — no hash, no correlation, no actor.
      })),
    [restoreHistory],
  );

  useEffect(() => {
    if (!entry) return;
    document.title = `${entry.title} — Evidence & receipts`;
  }, [entry]);

  if (loading) {
    return (
      <section className="min-h-screen bg-background py-12">
        <div className="max-w-3xl mx-auto px-4 space-y-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </section>
    );
  }

  if (notFound || !entry) {
    return (
      <section className="min-h-screen bg-background py-24">
        <div className="max-w-xl mx-auto px-4 text-center">
          <Lock className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
          <h1 className="font-display text-2xl font-bold mb-2">
            Evidence not public
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            This screenplay's evidence page is not available. It may be private,
            withdrawn, or restricted to reviewers.
          </p>
          <Link to="/leaderboard">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" /> Browse public entries
            </Button>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-background py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to={`/read/${entry.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to reader
          </Link>
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-primary/40 text-primary"
          >
            <ShieldCheck className="h-3 w-3 mr-1" /> Read-only evidence
          </Badge>
        </div>

        <header className="mb-8">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Evidence &amp; receipts
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-3">
            {entry.title}
          </h1>
          {entry.logline && (
            <p className="text-muted-foreground text-sm md:text-base leading-relaxed max-w-2xl mb-4">
              {entry.logline}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {entry.genre && (
              <Badge variant="secondary" className="text-xs font-mono">
                {entry.genre}
              </Badge>
            )}
            {entry.length_category && (
              <Badge
                variant="outline"
                className="text-xs font-mono capitalize border-primary/30 text-primary"
              >
                {entry.length_category}
              </Badge>
            )}
            {entry.page_count && (
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3" /> {entry.page_count} pages
              </span>
            )}
            {entry.created_at && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(entry.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </header>

        <p className="text-[11px] text-muted-foreground italic mb-6">
          This page is the public evidence view. Authorship identifiers,
          reviewer identities, cryptographic hashes, and internal correlation
          ids are hidden from readers by design.
        </p>

        <Separator className="mb-8 opacity-50" />

        {/* 1 — Disclosures */}
        <section className="mb-10">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold mb-3">
            <Sparkles className="h-4 w-4 text-primary" /> Disclosures
          </h2>
          <div className="rounded-xl border border-border/50 bg-card/80 p-5">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Badge
                variant="outline"
                className={
                  disclosure.assisted
                    ? "text-[10px] font-mono uppercase tracking-wider border-amber-500/40 text-amber-300 bg-amber-500/5"
                    : "text-[10px] font-mono uppercase tracking-wider border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
                }
              >
                {disclosure.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This public label comes from the submission's structured
              authorship method. Free-form AI notes, prompts, and model
              configuration remain private.
            </p>
          </div>
        </section>

        {/* 2 — Scores */}
        <section className="mb-10">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold mb-3">
            <Scale className="h-4 w-4 text-primary" /> Scores
          </h2>
          <UnifiedScorecard entryId={entry.id} />
        </section>

        {/* 3 — Rollback / restore history */}
        <section className="mb-10">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold mb-3">
            <History className="h-4 w-4 text-primary" /> Rollback history
          </h2>
          <ReceiptTrail
            title="Publication restores"
            entries={restoreEntries}
            loading={historyLoading}
            emptyMessage="No rollback events have been recorded for this entry."
          />
          <p className="mt-2 text-[10px] text-muted-foreground italic">
            Reviewer identities and internal correlation ids are hidden from
            public readers.
          </p>
        </section>

        <Separator className="mb-6 opacity-50" />

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to={`/read/${entry.id}`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Read the screenplay
            </Button>
          </Link>
          <Link to="/how-it-works">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> How evidence works
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
