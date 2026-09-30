/**
 * PublicProject — clean project summary page.
 * Only shows scored, standard-sensitivity, default-visibility entries.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText, User, BookOpen, Calendar, Layers, ArrowLeft,
  CheckCircle2, Activity, GitBranch, Shield, Share2, Check, Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ProductionReadinessPanel from "@/components/ProductionReadinessPanel";

interface ProjectEntry {
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
  draft_number: number;
}

export default function PublicProject() {
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<ProjectEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [writerName, setWriterName] = useState<string | null>(null);
  const [artifactCount, setArtifactCount] = useState(0);
  const [versionCount, setVersionCount] = useState(0);
  const [gradingCount, setGradingCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("public_entries")
        .select("id, title, logline, genre, method_type, status, created_at, page_count, length_category, author, user_id, draft_number")
        .eq("id", id)
        .eq("status", "scored")
        .eq("sensitivity", "standard")
        .eq("visibility", "default")
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setEntry(data as ProjectEntry);

      const [profileRes, artRes, verRes, gradeRes] = await Promise.all([
        supabase.from("profiles").select("display_name, pen_name").eq("user_id", data.user_id).maybeSingle(),
        supabase.from("artifacts").select("id").eq("entry_id", id).eq("status", "ready"),
        supabase.from("screenplay_versions").select("id").eq("entry_id", id),
        supabase.from("grading_reports").select("id").eq("entry_id", id),
      ]);

      setWriterName(profileRes.data?.pen_name || profileRes.data?.display_name || null);
      setArtifactCount((artRes.data || []).length);
      setVersionCount((verRes.data || []).length);
      setGradingCount((gradeRes.data || []).length);
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!entry) return;
    document.title = `${entry.title} — Project — CanIScreenwrite`;
    return () => { document.title = "CanIScreenwrite"; };
  }, [entry]);

  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: entry?.title || "Project", url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        toast({ title: "Link copied" });
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  if (loading) {
    return (
      <section className="min-h-screen pt-24 pb-20">
        <div className="container max-w-2xl space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
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
            <h1 className="font-display text-2xl font-bold mb-2">Project Not Available</h1>
            <p className="text-muted-foreground mb-6">
              This project is private, still being evaluated, or doesn't exist.
            </p>
            <Link to="/leaderboard">
              <Button variant="outline" size="sm">Browse Leaderboard</Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const formatLabel = entry.length_category
    ? entry.length_category.charAt(0).toUpperCase() + entry.length_category.slice(1)
    : "Screenplay";

  return (
    <section className="min-h-screen pt-20 pb-20">
      <div className="container max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
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

        <div className="rounded-2xl border border-border/50 bg-card/80 p-8 md:p-10">
          {/* Title */}
          <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight mb-2">
            {entry.title}
          </h1>

          {/* Writer */}
          {writerName && (
            <Link to={`/writer/${entry.user_id}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 mb-4">
              <User className="h-3.5 w-3.5" /> {writerName}
            </Link>
          )}

          {/* Logline */}
          {entry.logline && (
            <p className="text-muted-foreground text-sm leading-relaxed mt-4 mb-6 max-w-xl">
              {entry.logline}
            </p>
          )}

          <Separator className="my-6 opacity-50" />

          {/* Metadata grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <MetaItem label="Format" value={formatLabel} />
            {entry.genre && <MetaItem label="Genre" value={entry.genre} />}
            <MetaItem label="Method" value={entry.method_type === "ai" ? "AI-Generated" : entry.method_type === "hybrid" ? "Human–AI Hybrid" : "Human-Written"} />
            {entry.page_count && <MetaItem label="Pages" value={String(entry.page_count)} />}
            <MetaItem label="Draft" value={`v${entry.draft_number}`} />
            <MetaItem label="Submitted" value={new Date(entry.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })} />
          </div>

          {/* Signals */}
          {(gradingCount > 0 || artifactCount > 0) && (
            <>
              <Separator className="my-6 opacity-50" />
              <div className="flex flex-wrap gap-2">
                {gradingCount > 0 && (
                  <Badge variant="outline" className="text-[10px] font-mono gap-1 border-emerald-500/30 text-emerald-500">
                    <CheckCircle2 className="h-3 w-3" /> Evaluation Complete
                  </Badge>
                )}
                {gradingCount >= 2 && (
                  <Badge variant="outline" className="text-[10px] font-mono gap-1 border-primary/30 text-primary">
                    <Activity className="h-3 w-3" /> Stability Verified
                  </Badge>
                )}
                {versionCount > 0 && (
                  <Badge variant="outline" className="text-[10px] font-mono gap-1 border-muted-foreground/40">
                    <GitBranch className="h-3 w-3" /> Revision Lineage
                  </Badge>
                )}
                {artifactCount > 0 && (
                  <Badge variant="outline" className="text-[10px] font-mono gap-1 border-muted-foreground/40">
                    <Shield className="h-3 w-3" /> Evidence Available
                  </Badge>
                )}
              </div>
            </>
          )}

          <Separator className="my-6 opacity-50" />

          {/* Production Readiness */}
          <ProductionReadinessPanel
            draftNumber={entry.draft_number}
            sceneCount={0}
            characterCount={0}
            dialogueBlockCount={0}
            actionLineCount={0}
            pageCount={entry.page_count || 0}
            artifactReadyCount={artifactCount}
            artifactTotalCount={artifactCount}
            versionCount={versionCount}
            evaluationCount={gradingCount}
            compact
          />

          <Separator className="my-6 opacity-50" />

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Link to={`/read/${entry.id}`}>
              <Button size="sm" className="gap-1.5">
                <Eye className="h-3.5 w-3.5" /> Read Screenplay
              </Button>
            </Link>
            <Link to={`/entry/${entry.id}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> Full Analysis
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className="font-display font-semibold text-sm">{value}</p>
    </div>
  );
}
