import { useState, useEffect, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Section, SectionLabel, SectionTitle } from "@/components/Section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Newspaper, Rocket, Gavel, Trophy, Settings, Megaphone, ArrowLeft,
  Pin, Calendar, Tag, ChevronRight, Scale, Sparkles, Loader2,
  Bell, Rss, CheckCircle2, Clock, CircleDot,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import AILawTimeline from "@/components/AILawTimeline";
import NewsSubscribeDialog from "@/components/NewsSubscribeDialog";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { renderNewsMarkdown } from "@/lib/newsMarkdown";
import PlatformFeaturesSection from "@/components/news/PlatformFeaturesSection";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

interface NewsArticle {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  category: string;
  tags: string[];
  status: string;
  pinned: boolean;
  published_at: string | null;
  created_at: string;
}

const CATEGORIES = [
  { key: "all", label: "All News", icon: Newspaper },
  { key: "feature_release", label: "Features", icon: Rocket },
  { key: "system_update", label: "System", icon: Settings },
  { key: "competition", label: "Competitions", icon: Trophy },
  { key: "legal", label: "Legal", icon: Gavel },
  { key: "announcement", label: "Announcements", icon: Megaphone },
  { key: "retirement", label: "Retiring", icon: Settings },
];

const CATEGORY_COLORS: Record<string, string> = {
  feature_release: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  system_update: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  competition: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  legal: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  announcement: "bg-primary/15 text-primary border-primary/30",
  retirement: "bg-red-500/15 text-red-400 border-red-500/30",
};

const CATEGORY_ICONS: Record<string, typeof Newspaper> = {
  feature_release: Rocket,
  system_update: Settings,
  competition: Trophy,
  legal: Gavel,
  announcement: Megaphone,
  retirement: Settings,
};

// ─── FAQ Data (preserved from original) ───
const faqGroups = [
  {
    title: "General",
    items: [
      { q: "What is CanIScreenwrite?", a: "CanIScreenwrite is a governance-first screenplay competition platform that evaluates storytelling across intelligence types — AI, human, and hybrid." },
      { q: "Why start with AI?", a: "AI-generated screenwriting lacks structured evaluation and governance. By starting here, we establish fair, transparent evaluation processes before extending to human and hybrid categories." },
      { q: "Is this anti-human?", a: "Absolutely not. Human-only and hybrid competitions are core to our roadmap — AI is simply our launch category." },
    ],
  },
  {
    title: "Competition",
    items: [
      { q: "What formats are accepted?", a: "We accept feature screenplays (80–130 pages), TV pilots (30–65 pages), and short film scripts (5–30 pages) in standard PDF format." },
      { q: "How is judging conducted?", a: "All scripts undergo blind review across six dimensions: coherence, character consistency, structure, originality, controllability, and voice consistency." },
    ],
  },
  {
    title: "AI Disclosure",
    items: [
      { q: "What AI models can I use?", a: "Any AI language model is eligible. You must fully disclose the model(s) used." },
      { q: "How does CanIScreenwrite help protect my copyright?", a: "Our governance layer tracks decision lineage, creative trajectory, and rewrite history — creating structured evidence of human creative control." },
    ],
  },
];

const DEFAULT_LEGAL_SECTIONS = [
  {
    title: "Key AI IP Court Cases (2023–2026)",
    content: `• Thaler v. Perlmutter (2023–2026) — Copyright requires human authorship. Supreme Court declined review in 2026.\n• Thomson Reuters v. ROSS Intelligence (2025) — AI training on copyrighted materials and fair use.\n• Concord Music Group v. Anthropic (ongoing, 2026) — AI outputs competing with copyrighted material.\n• Authors Guild v. Anthropic (2025) — $1.5B settlement on training data provenance.\n• U.S. Copyright Office AI Reports (2024–2025) — Human contribution must be identifiable.\n• Bartz v. Anthropic (2025) — Fair use for LLM training challenged; market harm is pivotal factor.\n• Kadrey v. Meta Platforms (2025) — Authors' claims survive dismissal; market substitution by AI outputs is viable theory.\n• GEMA v. OpenAI (2025, Munich) — First EU case examining whether AI training constitutes "making available" copyrighted works.`,
  },
  {
    title: "IP Risk Categories for AI-Assisted Writing",
    content: `Category A — Authorship Ambiguity\nCategory B — Derivative Similarity\nCategory C — Confidential Disclosure\nCategory D — Dataset Contamination`,
  },
  {
    title: "GenAI Training vs. TDM: Why It Matters",
    content: `Traditional Text and Data Mining (TDM) extracts patterns and knowledge from data — it doesn't reproduce the data itself. Generative AI training is fundamentally different: it replicates the full statistical distribution of training data, enabling models to produce outputs that can compete directly with the original works.\n\nThis distinction matters because EU TDM exceptions and U.S. fair use doctrine were designed for extractive analysis, not for creating systems that generate competing content. The Stober & Dornis (2026) interdisciplinary analysis establishes that GenAI training falls outside existing TDM/fair use safe harbors.\n\nFor screenwriters, this means: the AI tools you use were trained on copyrighted screenplays and scripts. The legal frameworks that might protect traditional research uses of those works may not apply to generative AI that produces new screenplays.`,
  },
  {
    title: "Memorization & Regurgitation Risk",
    content: `AI models can memorize and reproduce fragments of their training data — even without explicitly storing it. This "regurgitation" risk means AI-generated text may contain passages closely resembling copyrighted works.\n\nRecent rulings (Bartz v. Anthropic, Kadrey v. Meta, 2025) treat market harm from AI outputs as a serious legal factor. If an AI-generated screenplay contains dialogue, structure, or narrative elements that closely mirror copyrighted source material, both the AI provider and the writer using the tool may face legal exposure.\n\nFor writers using AI-assisted workflows: document which portions are human-authored and which are AI-generated. This separation is your strongest defense if questions arise about originality.`,
  },
  {
    title: "What This Means for CanIScreenwrite",
    content: `CanIScreenwrite's governance layer directly addresses the legal challenges identified in the Stober & Dornis (2026) paper and recent court rulings:\n\n**Rewrite Lineage** — Every AI-assisted modification is tracked with before/after diffs, creating a clear record of human creative decisions vs. AI suggestions.\n\n**Decision Tracking** — The platform logs which AI models were used, what prompts were given, and which suggestions the writer accepted or rejected.\n\n**Sensitivity Controls** — Writers can control what content is shared with AI systems, limiting confidential disclosure risk.\n\n**Provenance Documentation** — The evidence bundle system creates timestamped records of the creative process, directly supporting the tiered documentation framework the paper recommends.\n\nThis means writers on CanIScreenwrite have stronger legal footing than writers using AI tools without governance tracking. The platform creates the documentation courts and copyright offices are increasingly requiring to establish human authorship in hybrid workflows.`,
  },
  {
    title: "Data Privacy & Deletion Rights",
    content: "Your personal data is processed in accordance with applicable data protection laws. You have the right to access, correct, delete, or export your personal data.",
  },
];

const renderMarkdown = renderNewsMarkdown;

function readTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_date: string | null;
  released_at: string | null;
  release_notes_article_id: string | null;
}

export default function NewsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") || "all";
  const activeSlug = searchParams.get("article");

  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  // Legal summary state (preserved)
  const [legalSections] = useState(DEFAULT_LEGAL_SECTIONS);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("news_articles" as any)
      .select("*")
      .eq("status", "published")
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .then(({ data }) => {
        setArticles((data as any[] || []) as NewsArticle[]);
        setLoading(false);
      });

    supabase
      .from("feature_roadmap" as any)
      .select("id,title,description,status,target_date,released_at,release_notes_article_id")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        setRoadmap((data as any[] || []) as RoadmapItem[]);
      });
  }, []);

  const filteredArticles = useMemo(() => {
    if (activeCategory === "all") return articles;
    return articles.filter((a) => a.category === activeCategory);
  }, [articles, activeCategory]);

  const selectedArticle = useMemo(() => {
    if (!activeSlug) return null;
    return articles.find((a) => a.slug === activeSlug) || null;
  }, [articles, activeSlug]);

  const handleGenerateSummary = async () => {
    if (PAID_AI_SECURITY_HOLD) {
      setAiSummary(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    if (!user) return;
    setSummaryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("legal-summary", {
        body: { user_id: user.id },
      });
      if (error) throw error;
      setAiSummary(data.summary);
    } catch {
      setAiSummary("Unable to generate summary. Please try again later.");
    }
    setSummaryLoading(false);
  };

  // ─── Article Detail View ───
  if (selectedArticle) {
    const CatIcon = CATEGORY_ICONS[selectedArticle.category] || Newspaper;
    return (
      <>
        <section className="pt-20 pb-6">
          <div className="container max-w-3xl">
            <button
              onClick={() => setSearchParams((prev) => { prev.delete("article"); return prev; })}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="h-4 w-4" /> Back to News
            </button>

            <div className="flex items-center gap-2 mb-4">
              <Badge variant="outline" className={`text-[10px] font-mono ${CATEGORY_COLORS[selectedArticle.category] || ""}`}>
                <CatIcon className="h-3 w-3 mr-1" />
                {selectedArticle.category.replace("_", " ")}
              </Badge>
              {selectedArticle.pinned && (
                <Badge variant="outline" className="text-[10px] font-mono bg-primary/15 text-primary border-primary/30">
                  <Pin className="h-3 w-3 mr-1" /> Pinned
                </Badge>
              )}
            </div>

            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-3">
              {selectedArticle.title}
            </h1>

            {selectedArticle.published_at && (
              <p className="text-sm text-muted-foreground mb-2">
                <Calendar className="h-3.5 w-3.5 inline mr-1.5" />
                {format(new Date(selectedArticle.published_at), "MMMM d, yyyy")}
              </p>
            )}

            {selectedArticle.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-8">
                {selectedArticle.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] font-mono text-muted-foreground">
                    <Tag className="h-2.5 w-2.5 mr-1" />{tag}
                  </Badge>
                ))}
              </div>
            )}

            <div className="text-base text-foreground/90 leading-relaxed">
              {renderMarkdown(selectedArticle.body)}
            </div>
          </div>
        </section>
      </>
    );
  }

  // ─── News Feed View ───
  const pinnedArticle = articles.find((a) => a.pinned) || null;
  const heroArticle = pinnedArticle || articles[0] || null;
  const heroId = heroArticle?.id;
  const restArticles = activeCategory === "all"
    ? articles.filter((a) => a.id !== heroId)
    : filteredArticles;

  const inProgress = roadmap.filter((r) => r.status === "in-progress").slice(0, 3);
  const nextPlanned = roadmap
    .filter((r) => r.status === "planned")
    .sort((a, b) => (a.target_date || "9999").localeCompare(b.target_date || "9999"))
    .slice(0, 3);
  const recentlyReleased = roadmap
    .filter((r) => r.status === "released" && r.released_at)
    .sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""))
    .slice(0, 4);

  const HeroCatIcon = heroArticle ? (CATEGORY_ICONS[heroArticle.category] || Newspaper) : Newspaper;

  return (
    <>
      <NewsSubscribeDialog open={subscribeOpen} onOpenChange={setSubscribeOpen} />

      {/* Hero */}
      <section className="pt-20 pb-6 border-b border-border/30">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
            <span className="inline-block text-xs font-mono tracking-[0.2em] uppercase text-primary mb-4">Newsroom</span>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-3">
              News & <span className="text-gradient-gold italic">Updates</span>
            </h1>
            <p className="text-lg text-muted-foreground">
              Releases, system changes, competition news, and the occasional legal note.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => setSubscribeOpen(true)}
                className="bg-primary/90 hover:bg-primary"
              >
                <Bell className="h-3.5 w-3.5 mr-1.5" /> Subscribe to updates
              </Button>
              <Button
                size="sm"
                variant="outline"
                asChild
                className="border-border/60 text-muted-foreground hover:text-foreground"
              >
                <a
                  href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/news-rss`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Rss className="h-3.5 w-3.5 mr-1.5" /> RSS feed
                </a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Hero Pinned Card */}
      {heroArticle && activeCategory === "all" && (
        <section className="py-8">
          <div className="container">
            <motion.button
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setSearchParams({ article: heroArticle.slug })}
              className="group w-full text-left rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/80 to-card overflow-hidden hover:border-primary/50 transition-colors"
            >
              <div className="p-6 md:p-10">
                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="outline" className={`text-[10px] font-mono ${CATEGORY_COLORS[heroArticle.category] || ""}`}>
                    <HeroCatIcon className="h-3 w-3 mr-1" />
                    {heroArticle.category.replace("_", " ")}
                  </Badge>
                  {heroArticle.pinned && (
                    <Badge variant="outline" className="text-[10px] font-mono bg-primary/20 text-primary border-primary/40">
                      <Pin className="h-3 w-3 mr-1" /> Featured
                    </Badge>
                  )}
                  {heroArticle.published_at && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      <Calendar className="h-3 w-3 inline mr-1" />
                      {format(new Date(heroArticle.published_at), "MMM d, yyyy")}
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {readTime(heroArticle.body)} min read
                  </span>
                </div>
                <h2 className="font-display text-2xl md:text-4xl font-bold tracking-tight mb-3 group-hover:text-primary transition-colors">
                  {heroArticle.title}
                </h2>
                <p className="text-base text-muted-foreground max-w-3xl leading-relaxed mb-4">
                  {heroArticle.excerpt}
                </p>
                <span className="inline-flex items-center gap-1.5 text-sm font-mono text-primary">
                  Read the announcement
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </motion.button>
          </div>
        </section>
      )}

      {/* Two-column: feed + sidebar */}
      <section className="pb-16">
        <div className="container grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10">
          {/* Feed column */}
          <div>
            {/* Filter pills */}
            <div className="flex flex-wrap gap-2 mb-6">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCategory === cat.key;
                const count = cat.key === "all" ? articles.length : articles.filter((a) => a.category === cat.key).length;
                return (
                  <button
                    key={cat.key}
                    onClick={() => setSearchParams(cat.key === "all" ? {} : { category: cat.key })}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono transition-colors border ${
                      isActive
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {cat.label}
                    {count > 0 && (
                      <span className={`ml-0.5 px-1.5 py-0 rounded-full text-[10px] ${isActive ? "bg-primary/20" : "bg-muted/50"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="p-6 rounded-xl border border-border/50 bg-card/60 space-y-3">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                ))}
              </div>
            ) : restArticles.length === 0 ? (
              <div className="text-center py-16 rounded-xl border border-border/40 bg-card/40">
                <Newspaper className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No articles in this category yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {restArticles.map((article, i) => {
                  const CatIcon = CATEGORY_ICONS[article.category] || Newspaper;
                  return (
                    <motion.button
                      key={article.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.3) }}
                      onClick={() => setSearchParams({ article: article.slug })}
                      className={`w-full text-left p-6 rounded-xl border bg-card/80 hover:bg-card transition-colors group ${
                        article.pinned ? "border-primary/40" : "border-border/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <Badge variant="outline" className={`text-[10px] font-mono ${CATEGORY_COLORS[article.category] || ""}`}>
                              <CatIcon className="h-3 w-3 mr-1" />
                              {article.category.replace("_", " ")}
                            </Badge>
                            {article.pinned && (
                              <Badge variant="outline" className="text-[10px] font-mono bg-primary/15 text-primary border-primary/30">
                                <Pin className="h-3 w-3 mr-1" /> Pinned
                              </Badge>
                            )}
                            {article.published_at && (
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {format(new Date(article.published_at), "MMM d, yyyy")}
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-muted-foreground">
                              · {readTime(article.body)} min read
                            </span>
                          </div>
                          <h3 className="font-display text-lg font-bold mb-1.5 group-hover:text-primary transition-colors">
                            {article.title}
                          </h3>
                          <p className="text-sm text-muted-foreground line-clamp-2">{article.excerpt}</p>
                          {article.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-3">
                              {article.tags.slice(0, 4).map((tag) => (
                                <span key={tag} className="text-[10px] font-mono text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-6 lg:sticky lg:top-24 self-start">
            {/* Subscribe card */}
            <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <Bell className="h-4 w-4 text-primary" />
                <h4 className="font-display text-sm font-bold">Stay in the loop</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                Get a notification when something new ships. Pick the categories
                you care about.
              </p>
              <Button
                size="sm"
                onClick={() => setSubscribeOpen(true)}
                className="w-full bg-primary/90 hover:bg-primary"
              >
                Subscribe
              </Button>
            </div>

            {/* Roadmap */}
            <div className="rounded-xl border border-border/50 bg-card/60 p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-display text-sm font-bold">Roadmap</h4>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Live
                </span>
              </div>

              {inProgress.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    In flight
                  </p>
                  <ul className="space-y-2">
                    {inProgress.map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-sm">
                        <CircleDot className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                        <span className="text-foreground/90">{r.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {nextPlanned.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    Up next
                  </p>
                  <ul className="space-y-2">
                    {nextPlanned.map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-sm">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-foreground/80">{r.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {recentlyReleased.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                    Recently released
                  </p>
                  <ul className="space-y-2">
                    {recentlyReleased.map((r) => {
                      const linkedArticle = r.release_notes_article_id
                        ? articles.find((a) => a.id === r.release_notes_article_id)
                        : null;
                      const content = (
                        <span className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                          <span className="text-foreground/80 hover:text-primary transition-colors">
                            {r.title}
                          </span>
                        </span>
                      );
                      return (
                        <li key={r.id}>
                          {linkedArticle ? (
                            <button
                              className="text-left w-full"
                              onClick={() =>
                                setSearchParams({ article: linkedArticle.slug })
                              }
                            >
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>


      {/* Platform Features — Reader, Editor, full stack & history */}
      <PlatformFeaturesSection />

      {/* FAQ Section */}
      <Section className="bg-surface-overlay">
        <SectionLabel>FAQ</SectionLabel>
        <SectionTitle>Frequently Asked Questions</SectionTitle>
        <div className="mt-8 max-w-2xl">
          {faqGroups.map((group, gi) => (
            <div key={gi} className="mb-6">
              <h3 className="text-xs font-mono tracking-[0.15em] uppercase text-muted-foreground mb-3">{group.title}</h3>
              <Accordion type="single" collapsible className="space-y-2">
                {group.items.map((faq, i) => (
                  <AccordionItem key={i} value={`${gi}-${i}`} className="border border-border/50 rounded-lg px-5 bg-card/50">
                    <AccordionTrigger className="font-body text-sm font-medium hover:no-underline py-4">{faq.q}</AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground pb-4">{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>
      </Section>

      {/* Timeline Section */}
      <Section>
        <SectionLabel>Timeline</SectionLabel>
        <SectionTitle>Evolution of AI IP Law</SectionTitle>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl mb-8">
          How copyright law has evolved to address AI-generated creative works — from silence to landmark rulings.
        </p>
        <AILawTimeline />
      </Section>

      {/* Legal & Copyright Section */}
      <Section className="bg-surface-overlay">
        <SectionLabel>
          <span className="inline-flex items-center gap-2"><Scale className="h-3.5 w-3.5" /> Legal & Copyright</span>
        </SectionLabel>
        <SectionTitle>Legal Notice & AI Copyright</SectionTitle>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Important legal information regarding AI-generated content, copyright law, and your rights.
        </p>

        <div className="mt-8 max-w-2xl">
          <Accordion type="multiple" className="space-y-2">
            {legalSections.map((section, i) => (
              <AccordionItem key={i} value={`legal-${i}`} className="border border-border/50 rounded-lg px-5 bg-card/50">
                <AccordionTrigger className="font-body text-sm font-medium hover:no-underline py-4">
                  {section.title}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground pb-4 whitespace-pre-line leading-relaxed">
                  {section.content}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {/* AI Summary */}
          <div className="mt-6 p-5 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <h4 className="font-display text-sm font-bold">AI Legal Summary</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Generate a personalized plain-language summary of the legal notice.
            </p>

            {!user ? (
              <p className="text-xs text-muted-foreground italic">Sign in to generate a personalized summary.</p>
            ) : aiSummary ? (
              <div className="prose prose-sm prose-invert max-w-none text-sm text-foreground/90 leading-relaxed whitespace-pre-line mb-3">
                {aiSummary}
              </div>
            ) : null}

            {user && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateSummary}
                disabled={PAID_AI_SECURITY_HOLD || summaryLoading}
                className="border-primary/30 text-primary hover:bg-primary/10"
              >
                {summaryLoading ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating…</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {aiSummary ? "Regenerate Summary" : "Generate AI Summary"}</>
                )}
              </Button>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
