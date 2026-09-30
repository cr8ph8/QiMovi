import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Filter, Lock, Sparkles, Film, Clock, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface QiEntry {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
  logline: string | null;
  length_category: string | null;
  method_type: string;
  created_at: string;
  page_count: number | null;
  visibility: string;
}

const METHOD_LABELS: Record<string, string> = {
  ai: "AI",
  human: "Human",
  hybrid: "Hybrid",
};

const CATEGORY_LABELS: Record<string, string> = {
  vertical: "Vertical",
  micro: "Micro Short",
  short: "Short Film",
  pilot_30: "30-Min Pilot",
  pilot_60: "60-Min Pilot",
  feature: "Feature",
};

export default function QiList() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<QiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "title">("date");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    async function load() {
      const { data } = await supabase
        .from("qi_list_entries" as any)
        .select("id, title, author, genre, logline, length_category, method_type, created_at, page_count, visibility")
        .order("created_at", { ascending: false });

      setEntries((data as unknown as QiEntry[]) || []);
      setLoading(false);
    }
    load();
  }, [user]);

  const genres = useMemo(() => {
    const set = new Set(entries.map((e) => e.genre).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.author?.toLowerCase().includes(q)) ||
          (e.genre?.toLowerCase().includes(q))
      );
    }
    if (genreFilter !== "all") list = list.filter((e) => e.genre === genreFilter);
    if (formatFilter !== "all") list = list.filter((e) => e.length_category === formatFilter);
    if (methodFilter !== "all") list = list.filter((e) => e.method_type === methodFilter);

    if (sortBy === "title") {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    }

    return list;
  }, [entries, search, genreFilter, formatFilter, methodFilter, sortBy]);

  // Auth gate
  if (!user) {
    return (
      <section className="pt-32 pb-20">
        <div className="container max-w-lg text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              The <span className="text-gradient-gold italic">Qi-List</span>
            </h1>
            <p className="text-muted-foreground leading-relaxed">
              The Qi-List is an exclusive, members-only catalog of every evaluated screenplay on the platform. Sign in to browse the full registry.
            </p>
            <Link to="/auth">
              <Button className="bg-gold-gradient text-primary-foreground font-body font-semibold hover:opacity-90">
                Sign In to Access
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-24 pb-20">
      <div className="container max-w-5xl">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gold-gradient flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-primary block">Members Only</span>
              <h1 className="font-display text-3xl font-bold tracking-tight">
                The <span className="text-gradient-gold italic">Qi-List</span>
              </h1>
            </div>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            The definitive private registry of every evaluated screenplay. Browse, discover, and explore projects from writers across all intelligence types.
          </p>
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col md:flex-row gap-3 mb-6"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, author, genre..."
              className="pl-10 bg-muted border-border"
            />
          </div>
          <Select value={genreFilter} onValueChange={setGenreFilter}>
            <SelectTrigger className="w-full md:w-40 bg-muted border-border">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Genre" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Genres</SelectItem>
              {genres.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={formatFilter} onValueChange={setFormatFilter}>
            <SelectTrigger className="w-full md:w-40 bg-muted border-border">
              <Film className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Formats</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger className="w-full md:w-36 bg-muted border-border">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="human">Human</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortBy(sortBy === "date" ? "title" : "date")}
            title={`Sort by ${sortBy === "date" ? "title" : "date"}`}
            className="shrink-0"
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </motion.div>

        {/* Count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground font-mono">
            {filtered.length} screenplay{filtered.length !== 1 ? "s" : ""} registered
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            Sorted by {sortBy === "date" ? "newest" : "A → Z"}
          </p>
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-pulse text-muted-foreground text-sm">Loading catalog...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <Film className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-muted-foreground">No screenplays match your filters.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.5) }}
              >
                <Link
                  to={`/project/${entry.id}`}
                  className="group block rounded-xl border border-border/50 bg-card/60 hover:bg-card hover:border-primary/20 transition-all duration-200 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-display text-sm font-semibold truncate group-hover:text-primary transition-colors">
                          {entry.title}
                        </h3>
                        {entry.visibility === "qi_list" && (
                          <Badge variant="outline" className="text-[9px] font-mono border-primary/30 text-primary shrink-0">
                            Qi-List Exclusive
                          </Badge>
                        )}
                      </div>
                      {entry.logline && (
                        <p className="text-xs text-muted-foreground line-clamp-1 mb-2">{entry.logline}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.author && (
                          <span className="text-[11px] text-muted-foreground">{entry.author}</span>
                        )}
                        {entry.genre && (
                          <Badge variant="secondary" className="text-[10px] font-mono">{entry.genre}</Badge>
                        )}
                        {entry.length_category && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {CATEGORY_LABELS[entry.length_category] || entry.length_category}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {METHOD_LABELS[entry.method_type] || entry.method_type}
                        </Badge>
                        {entry.page_count && (
                          <span className="text-[10px] text-muted-foreground font-mono">{entry.page_count} pgs</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono shrink-0">
                      <Clock className="h-3 w-3" />
                      {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
