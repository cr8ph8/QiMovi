/**
 * PublicRead — public screenplay reader page.
 * Shows metadata for scored/standard/default entries.
 * Full script text is gated behind authentication (owner access only).
 */
import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { parseFountain } from "@/lib/fountain-parser";
import { paginateElements } from "@/lib/fountain-paginator";
import ScreenplayReaderView from "@/components/screenplay/ScreenplayReaderView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText, User, BookOpen, Calendar, Layers, ArrowLeft,
  CheckCircle2, Activity, GitBranch, Shield, Share2, Check, Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface PublicEntryMeta {
  id: string;
  title: string;
  logline: string | null;
  genre: string | null;
  method_type: string;
  status: string;
  created_at: string;
  page_count: number | null;
  length_category: string | null;
  author: string | null;
  user_id: string;
  sensitivity: string;
  visibility: string;
}

interface PublicArtifactSummary {
  hasEvaluation: boolean;
  hasStability: boolean;
  hasLineage: boolean;
  hasArtifact: boolean;
}

export default function PublicRead() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [entry, setEntry] = useState<PublicEntryMeta | null>(null);
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [writerName, setWriterName] = useState<string | null>(null);
  const [artifactSummary, setArtifactSummary] = useState<PublicArtifactSummary>({
    hasEvaluation: false, hasStability: false, hasLineage: false, hasArtifact: false,
  });
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);

      // Fetch metadata from public_entries view (no script_text)
      const { data, error } = await supabase
        .from("public_entries")
        .select("id, title, logline, genre, method_type, status, created_at, page_count, length_category, author, user_id, sensitivity, visibility")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setEntry(data as PublicEntryMeta);

      // If the current user owns this entry, fetch script_text from entries table
      const { data: sessionData } = await supabase.auth.getSession();
      const currentUserId = sessionData?.session?.user?.id;
      if (currentUserId && currentUserId === data.user_id) {
        const { data: fullEntry } = await supabase
          .from("entries")
          .select("script_text")
          .eq("id", id)
          .maybeSingle();
        if (fullEntry?.script_text) {
          setScriptText(fullEntry.script_text);
        }
      }

      // Load writer name via RPC
      supabase
        .rpc("get_public_profiles", { user_ids: [data.user_id] })
        .then(({ data: profiles }) => {
          const p = (profiles as any[])?.[0];
          setWriterName(p?.pen_name || p?.display_name || null);
        });

      // Load public-safe artifact signals
      const [artifactsRes, versionsRes, gradingRes] = await Promise.all([
        supabase.from("artifacts").select("id, status").eq("entry_id", id).eq("status", "ready"),
        supabase.from("screenplay_versions").select("id").eq("entry_id", id),
        supabase.from("grading_reports").select("id").eq("entry_id", id),
      ]);

      setArtifactSummary({
        hasEvaluation: (gradingRes.data || []).length > 0,
        hasStability: (gradingRes.data || []).length >= 2,
        hasLineage: (versionsRes.data || []).length > 0,
        hasArtifact: (artifactsRes.data || []).length > 0,
      });

      setLoading(false);
    }
    load();
  }, [id]);

  const parsed = useMemo(() => parseFountain(scriptText || ""), [scriptText]);
  const paginated = useMemo(() => paginateElements(parsed.elements), [parsed]);

  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: entry?.title || "Screenplay", url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        toast({ title: "Link copied" });
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  // SEO
  useEffect(() => {
    if (!entry) return;
    document.title = `${entry.title} — CanIScreenwrite`;
    const setMeta = (prop: string, content: string) => {
      let el = document.querySelector(`meta[property="${prop}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute("property", prop); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    const desc = [entry.logline, entry.genre ? `Genre: ${entry.genre}` : null].filter(Boolean).join(" · ");
    setMeta("og:title", entry.title);
    setMeta("og:description", desc || "A screenplay on CanIScreenwrite");
    setMeta("og:type", "article");
    setMeta("og:url", window.location.href);
    return () => { document.title = "CanIScreenwrite"; };
  }, [entry]);

  if (loading) {
    return (
      <section className="min-h-screen pt-24 pb-20">
        <div className="container max-w-4xl space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-96" />
          <Skeleton className="h-[600px] w-full" />
        </div>
      </section>
    );
  }

  if (notFound || !entry) {
    return (
      <section className="min-h-screen pt-24 pb-20">
        <div className="container max-w-lg flex flex-col items-center justify-center pt-20">
          <div className="rounded-2xl border border-border/50 bg-card/80 p-10 text-center w-full">
            <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h1 className="font-display text-2xl font-bold mb-2">Not Available</h1>
            <p className="text-muted-foreground mb-6">
              This screenplay is either private, still being evaluated, or doesn't exist.
            </p>
            <Link to="/leaderboard">
              <Button variant="outline" size="sm">Browse Leaderboard</Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Link to="/leaderboard">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={handleShare} className="ml-auto gap-1.5">
              {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              {copied ? "Copied" : "Share"}
            </Button>
          </div>

          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-3">
            {entry.title}
          </h1>

          {entry.logline && (
            <p className="text-muted-foreground text-sm md:text-base leading-relaxed max-w-2xl mb-4">
              {entry.logline}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {writerName && (
              <Link to={`/writer/${entry.user_id}`} className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <User className="h-3.5 w-3.5" />
                <span>{writerName}</span>
              </Link>
            )}
            {entry.genre && (
              <Badge variant="secondary" className="text-xs font-mono">{entry.genre}</Badge>
            )}
            {entry.length_category && (
              <Badge variant="outline" className="text-xs font-mono capitalize border-primary/30 text-primary">
                {entry.length_category}
              </Badge>
            )}
            {entry.page_count && (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" /> {entry.page_count} pages
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(entry.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
            </span>
          </div>
        </div>

        {/* Public artifact signals */}
        {(artifactSummary.hasEvaluation || artifactSummary.hasArtifact) && (
          <div className="flex flex-wrap gap-2 mb-6">
            {artifactSummary.hasEvaluation && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1 border-emerald-500/30 text-emerald-500">
                <CheckCircle2 className="h-3 w-3" /> Evaluation Complete
              </Badge>
            )}
            {artifactSummary.hasStability && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1 border-primary/30 text-primary">
                <Activity className="h-3 w-3" /> Stability Verified
              </Badge>
            )}
            {artifactSummary.hasLineage && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1 border-muted-foreground/40">
                <GitBranch className="h-3 w-3" /> Revision Lineage
              </Badge>
            )}
            {artifactSummary.hasArtifact && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1 border-muted-foreground/40">
                <Shield className="h-3 w-3" /> Evidence Available
              </Badge>
            )}
          </div>
        )}

        <Separator className="mb-6 opacity-50" />

        {/* Screenplay body or auth gate */}
        {scriptText ? (
          <ScreenplayReaderView
            paginated={paginated}
            title={entry.title}
            pageCount={entry.page_count}
          />
        ) : (
          <div className="rounded-xl border border-border/50 bg-card/80 p-12 text-center">
            <Lock className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <h2 className="font-display text-lg font-bold mb-2">Full Screenplay Protected</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              The full screenplay text is only available to the author. Sign in to view your own scripts.
            </p>
            {!user && (
              <Link to="/auth">
                <Button size="sm" className="gap-1.5">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground mb-4">
            Read on CanIScreenwrite — the AI screenplay evaluation platform
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to={`/entry/${entry.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> Full Analysis
              </Button>
            </Link>
            <Link to={`/read/${entry.id}/evidence`}>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <Shield className="h-3.5 w-3.5" /> Evidence &amp; receipts
              </Button>
            </Link>
            {writerName && (
              <Link to={`/writer/${entry.user_id}`}>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <User className="h-3.5 w-3.5" /> Writer Profile
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
