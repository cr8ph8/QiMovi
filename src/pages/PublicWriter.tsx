/**
 * PublicWriter — public-facing writer profile.
 * Shows display name / pen name, public projects, genre distribution, and stats.
 */
import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  User, FileText, ArrowLeft, Calendar, BookOpen, Share2, Check, Layers, Award,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ProjectMaturityBadge, RevisionDepthBadge } from "@/components/writer/ProjectMaturityBadge";

interface WriterProfileData {
  display_name: string | null;
  pen_name: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

interface PublicProject {
  id: string;
  title: string;
  genre: string | null;
  logline: string | null;
  length_category: string | null;
  page_count: number | null;
  created_at: string;
  status: string;
  draft_number: number;
}

/* ─── Genre Distribution Bar ─── */
function GenreDistribution({ projects }: { projects: PublicProject[] }) {
  const genreCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects) {
      const g = p.genre || "Unknown";
      map.set(g, (map.get(g) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [projects]);

  if (genreCounts.length < 2) return null;

  const max = genreCounts[0]?.[1] || 1;

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5 mb-6">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Genre Distribution</h3>
      <div className="space-y-2">
        {genreCounts.map(([genre, count]) => (
          <div key={genre} className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-muted-foreground w-20 truncate text-right" title={genre}>{genre}</span>
            <div className="flex-1 h-3 bg-muted/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground w-5 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Stats Row ─── */
function WriterStats({ projects }: { projects: PublicProject[] }) {
  const totalPages = projects.reduce((s, p) => s + (p.page_count || 0), 0);
  const avgPages = projects.length > 0 ? Math.round(totalPages / projects.length) : 0;
  const genreCount = new Set(projects.map(p => p.genre).filter(Boolean)).size;

  return (
    <div className="flex items-center gap-6 text-sm">
      <div className="text-center">
        <p className="font-display text-lg font-bold">{projects.length}</p>
        <p className="text-[10px] font-mono text-muted-foreground uppercase">Projects</p>
      </div>
      <div className="text-center">
        <p className="font-display text-lg font-bold">{genreCount}</p>
        <p className="text-[10px] font-mono text-muted-foreground uppercase">Genres</p>
      </div>
      {totalPages > 0 && (
        <div className="text-center">
          <p className="font-display text-lg font-bold">{totalPages}</p>
          <p className="text-[10px] font-mono text-muted-foreground uppercase">Total Pages</p>
        </div>
      )}
      {avgPages > 0 && (
        <div className="text-center">
          <p className="font-display text-lg font-bold">{avgPages}</p>
          <p className="text-[10px] font-mono text-muted-foreground uppercase">Avg Pages</p>
        </div>
      )}
    </div>
  );
}

/* ─── Badges Section ─── */
function WriterBadges({ userId }: { userId: string }) {
  const [badges, setBadges] = useState<{ badge_type: string; awarded_at: string }[]>([]);

  useEffect(() => {
    supabase
      .from("user_badges")
      .select("badge_type, awarded_at")
      .eq("user_id", userId)
      .order("awarded_at", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) setBadges(data as any[]);
      });
  }, [userId]);

  if (badges.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-5 mb-6">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
        <Award className="h-3 w-3" /> Achievements
      </h3>
      <div className="flex flex-wrap gap-2">
        {badges.map((b, i) => (
          <Badge key={i} variant="secondary" className="text-[10px] font-mono capitalize">
            {b.badge_type.replace(/_/g, " ")}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function PublicWriter() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<WriterProfileData | null>(null);
  const [projects, setProjects] = useState<PublicProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    async function load() {
      setLoading(true);

      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, pen_name, avatar_url, created_at")
        .eq("user_id", id)
        .single();
      const profileData = prof as WriterProfileData | null;

      if (!profileData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setProfile(profileData as WriterProfileData);

      const { data: entries } = await supabase
        .from("public_entries")
        .select("id, title, genre, logline, length_category, page_count, created_at, status, draft_number")
        .eq("user_id", id)
        .order("created_at", { ascending: false });

      setProjects((entries || []) as PublicProject[]);
      setLoading(false);
    }
    load();
  }, [id]);

  useEffect(() => {
    if (!profile) return;
    const name = profile.pen_name || profile.display_name || "Writer";
    document.title = `${name} — CanIScreenwrite`;
    return () => { document.title = "CanIScreenwrite"; };
  }, [profile]);

  function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: profile?.pen_name || profile?.display_name || "Writer", url }).catch(() => {});
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
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </section>
    );
  }

  if (notFound || !profile) {
    return (
      <section className="min-h-screen pt-24 pb-20">
        <div className="container max-w-lg flex flex-col items-center justify-center pt-20">
          <div className="rounded-2xl border border-border/50 bg-card/80 p-10 text-center w-full">
            <User className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h1 className="font-display text-2xl font-bold mb-2">Writer Not Found</h1>
            <p className="text-muted-foreground mb-6">
              This profile doesn't exist or hasn't published any public work yet.
            </p>
            <Link to="/leaderboard">
              <Button variant="outline" size="sm">Browse Leaderboard</Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const displayName = profile.pen_name || profile.display_name || "Anonymous Writer";
  const memberSince = new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long" });

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

        {/* Profile header */}
        <div className="rounded-2xl border border-border/50 bg-card/80 p-8 mb-8">
          <div className="flex items-center gap-4">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={displayName}
                className="h-16 w-16 rounded-full object-cover border border-primary/20"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-8 w-8 text-primary" />
              </div>
            )}
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">{displayName}</h1>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                <Calendar className="h-3 w-3" /> Member since {memberSince}
              </p>
            </div>
          </div>

          <Separator className="my-5 opacity-50" />

          <WriterStats projects={projects} />
        </div>

        {/* Achievement Badges */}
        {id && <WriterBadges userId={id} />}

        {/* Genre Distribution */}
        <GenreDistribution projects={projects} />

        {/* Projects list */}
        <h2 className="font-display text-lg font-bold mb-4">Public Projects</h2>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No public projects yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map(project => (
              <Link key={project.id} to={`/project/${project.id}`} className="block">
                <div className="rounded-xl border border-border/50 bg-card/80 p-5 hover:bg-card transition-colors group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display font-semibold text-sm group-hover:text-primary transition-colors truncate">
                        {project.title}
                      </h3>
                      {project.logline && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{project.logline}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {project.genre && (
                          <Badge variant="secondary" className="text-[10px] font-mono">{project.genre}</Badge>
                        )}
                        {project.length_category && (
                          <Badge variant="outline" className="text-[10px] font-mono capitalize border-primary/30 text-primary">
                            {project.length_category}
                          </Badge>
                        )}
                        {project.page_count && (
                          <span className="text-[10px] text-muted-foreground">{project.page_count} pp</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(project.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                        </span>
                        <ProjectMaturityBadge data={{
                          hasDraft: true,
                          isParsed: !!project.page_count,
                          isJudged: project.status === "scored",
                          isRevised: project.draft_number > 1,
                          lineageDepth: project.draft_number,
                          hasArtifacts: false,
                          hasStability: false,
                        }} />
                        <RevisionDepthBadge versionCount={0} draftNumber={project.draft_number} />
                      </div>
                    </div>
                    <BookOpen className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0 mt-1" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
