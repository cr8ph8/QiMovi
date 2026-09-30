import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Wrench, Shield, Zap, Rocket, ArrowRight, GitPullRequest, FileText, GitCommit, CircleDot, ExternalLink } from "lucide-react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type HighlightLinkKind = "pr" | "spec" | "issue" | "commit" | "doc";
interface HighlightLink {
  label?: string;
  url: string;
  kind?: HighlightLinkKind;
}
interface Highlight {
  scope?: string;
  text: string;
  links?: HighlightLink[];
}
interface Release {
  id: string;
  version: string;
  released_at: string;
  title: string;
  summary: string | null;
  highlights: Highlight[];
  kind: "feature" | "fix" | "security" | "infra";
  news_article_id: string | null;
}

const LINK_META: Record<HighlightLinkKind, { icon: React.ElementType; label: string }> = {
  pr: { icon: GitPullRequest, label: "PR" },
  spec: { icon: FileText, label: "Spec" },
  issue: { icon: CircleDot, label: "Issue" },
  commit: { icon: GitCommit, label: "Commit" },
  doc: { icon: FileText, label: "Doc" },
};

function inferLinkKind(l: HighlightLink): HighlightLinkKind {
  if (l.kind) return l.kind;
  const u = l.url.toLowerCase();
  if (u.includes("/pull/")) return "pr";
  if (u.includes("/issues/")) return "issue";
  if (u.includes("/commit/")) return "commit";
  if (u.endsWith(".md") || u.includes("/spec")) return "spec";
  return "doc";
}

function HighlightLinks({ links }: { links?: HighlightLink[] }) {
  if (!links?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5 ml-2 align-middle">
      {links.map((l, i) => {
        const kind = inferLinkKind(l);
        const meta = LINK_META[kind];
        const Icon = meta.icon;
        return (
          <a
            key={i}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={l.url}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            <Icon className="h-2.5 w-2.5" />
            {l.label || meta.label}
            <ExternalLink className="h-2.5 w-2.5 opacity-60" />
          </a>
        );
      })}
    </span>
  );
}

const KIND_META: Record<Release["kind"], { label: string; icon: React.ElementType; className: string }> = {
  feature: { label: "Feature", icon: Rocket, className: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  fix: { label: "Fix", icon: Wrench, className: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  security: { label: "Security", icon: Shield, className: "text-rose-400 border-rose-500/30 bg-rose-500/10" },
  infra: { label: "Infra", icon: Zap, className: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
};

function groupByMonth(releases: Release[]) {
  const groups: Record<string, Release[]> = {};
  for (const r of releases) {
    const d = new Date(r.released_at);
    const key = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    (groups[key] = groups[key] || []).push(r);
  }
  return groups;
}

export default function ChangelogPage() {
  useDocumentTitle("Changelog — QiCanIScreenwrite");
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Release | null>(null);

  useEffect(() => {
    (supabase as any)
      .from("changelog_releases")
      .select("id, version, released_at, title, summary, highlights, kind, news_article_id")
      .eq("is_published", true)
      .order("released_at", { ascending: false })
      .then(({ data }: { data: Release[] | null }) => {
        setReleases(data || []);
        setLoading(false);
      });
  }, []);

  const grouped = groupByMonth(releases);

  return (
    <main className="container max-w-4xl py-16 md:py-24">
      <header className="mb-12">
        <span className="inline-block text-xs font-mono font-medium tracking-[0.2em] uppercase text-primary mb-3">
          Versioned Releases
        </span>
        <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">Changelog</h1>
        <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
          Every shipped update — dated, versioned, and grouped by month. Bookmark this page to track what's new.
        </p>
      </header>

      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : releases.length === 0 ? (
        <p className="text-muted-foreground">No releases yet.</p>
      ) : (
        <div className="space-y-12">
          {Object.entries(grouped).map(([month, items]) => (
            <section key={month}>
              <h2 className="font-display text-sm font-mono uppercase tracking-widest text-muted-foreground mb-4">
                {month}
              </h2>
              <div className="space-y-4">
                {items.map((r, idx) => {
                  const meta = KIND_META[r.kind] || KIND_META.feature;
                  const Icon = meta.icon;
                  return (
                    <motion.article
                      key={r.id}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.04 }}
                      onClick={() => setSelected(r)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(r);
                        }
                      }}
                      className="rounded-xl border border-border/60 bg-card/70 p-6 hover:border-primary/40 hover:bg-card cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge variant="outline" className="font-mono text-xs">
                            {r.version}
                          </Badge>
                          <Badge variant="outline" className={`text-[10px] gap-1 ${meta.className}`}>
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </div>
                        <time className="text-xs font-mono text-muted-foreground">
                          {new Date(r.released_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </time>
                      </div>
                      <h3 className="font-display text-xl font-semibold mb-2">{r.title}</h3>
                      {r.summary && (
                        <p className="text-sm text-muted-foreground leading-relaxed mb-3">{r.summary}</p>
                      )}
                      {r.highlights?.length > 0 && (
                        <ul className="space-y-1.5 mt-3">
                          {r.highlights.map((h, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                              <span className="text-foreground/90">
                                {h.scope && (
                                  <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mr-2">
                                    {h.scope}
                                  </span>
                                )}
                                {h.text}
                                <HighlightLinks links={h.links} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.news_article_id && (
                        <Link
                          to="/news"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-4"
                        >
                          Read full release notes <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </motion.article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {selected && (() => {
            const meta = KIND_META[selected.kind] || KIND_META.feature;
            const Icon = meta.icon;
            const scopes = Array.from(
              new Set((selected.highlights || []).map((h) => h.scope).filter(Boolean) as string[])
            );
            const grouped = (selected.highlights || []).reduce<Record<string, Highlight[]>>((acc, h) => {
              const k = h.scope || "general";
              (acc[k] = acc[k] || []).push(h);
              return acc;
            }, {});
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Badge variant="outline" className="font-mono text-xs">{selected.version}</Badge>
                    <Badge variant="outline" className={`text-[10px] gap-1 ${meta.className}`}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <time className="text-xs font-mono text-muted-foreground ml-auto">
                      {new Date(selected.released_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </time>
                  </div>
                  <DialogTitle className="font-display text-2xl">{selected.title}</DialogTitle>
                  {selected.summary && (
                    <DialogDescription className="text-sm leading-relaxed pt-2">
                      {selected.summary}
                    </DialogDescription>
                  )}
                </DialogHeader>

                <ScrollArea className="flex-1 -mx-6 px-6">
                  {scopes.length > 0 && (
                    <div className="mt-4 mb-6">
                      <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                        Affected areas
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {Object.keys(grouped).length > 0 && (
                    <div className="space-y-5">
                      <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Full upgrade details
                      </h4>
                      {Object.entries(grouped).map(([scope, items]) => (
                        <div key={scope}>
                          <div className="font-mono text-[11px] uppercase tracking-wide text-primary mb-2">
                            {scope}
                          </div>
                          <ul className="space-y-2">
                            {items.map((h, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm">
                                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                <span className="text-foreground/90 leading-relaxed">
                                  {h.text}
                                  <HighlightLinks links={h.links} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}

                  {selected.news_article_id && (
                    <Link
                      to="/news"
                      onClick={() => setSelected(null)}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-6"
                    >
                      Read full release notes <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </ScrollArea>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </main>
  );
}
