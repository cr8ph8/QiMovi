import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { BookOpen, Users, Lock, Globe, Link2 } from "lucide-react";
import { ReaderLayout } from "@/components/reader/ReaderLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Badge } from "@/components/ui/badge";
import { useAccessibleEntries } from "@/lib/reader/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { RoleBadge } from "@/components/reader/RoleBadge";

const visMeta: Record<string, { label: string; icon: typeof Lock; tone: string }> = {
  public: { label: "Public", icon: Globe, tone: "text-emerald-400" },
  qi_list: { label: "Qi-List", icon: Users, tone: "text-primary" },
  unlisted: { label: "Unlisted", icon: Link2, tone: "text-amber-400" },
  private: { label: "Private", icon: Lock, tone: "text-muted-foreground" },
  default: { label: "Private", icon: Lock, tone: "text-muted-foreground" },
};

export default function ScriptClub() {
  useDocumentTitle("Script Club · Reader");
  const { entries, loading } = useAccessibleEntries();
  const { user, isAdmin, isTester } = useAuth();
  const globalRole = isAdmin ? "operator" : isTester ? "judge" : user ? "reader" : "reader";

  return (
    <ReaderLayout>
      <section className="space-y-2 mb-10">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-primary">
            <BookOpen className="w-3.5 h-3.5" /> Script Club
          </div>
          <RoleBadge role={globalRole} />
        </div>
        <h1 className="font-display text-3xl sm:text-4xl text-foreground">
          Scripts you've been invited to read
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every screenplay here was shared with you directly, surfaced on the Qi-List, or
          published publicly. Owners control visibility per script.
        </p>
      </section>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[280px] rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border/60 rounded-xl">
          <BookOpen className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-foreground">No scripts available to read yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Submit a script, get invited as a collaborator, or wait for new Qi-List entries.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {entries.map((s, i) => {
            const Meta = visMeta[s.visibility] ?? visMeta.default;
            const Icon = Meta.icon;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.04 }}
              >
                <Link
                  to={`/reader/${s.id}`}
                  className="group block rounded-xl border border-border/60 bg-card overflow-hidden hover:border-primary/50 transition-colors h-full"
                >
                  <div className="aspect-[16/9] bg-gradient-to-br from-secondary via-secondary/40 to-background flex items-center justify-center">
                    <BookOpen className="w-10 h-10 text-muted-foreground/40" />
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-lg text-foreground group-hover:text-primary transition-colors line-clamp-2">
                        {s.title}
                      </h3>
                      <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider shrink-0 ${Meta.tone}`}>
                        <Icon className="w-3 h-3" /> {Meta.label}
                      </span>
                    </div>
                    {s.logline && (
                      <p className="text-xs text-muted-foreground italic line-clamp-2">"{s.logline}"</p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border/40">
                      <span className="truncate">{s.author ?? "Unknown author"}</span>
                      {s.page_count != null && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {s.page_count} pp
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </ReaderLayout>
  );
}
