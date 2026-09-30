import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Section, SectionLabel, SectionTitle } from "@/components/Section";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ArrowRight } from "lucide-react";

interface Release {
  id: string;
  version: string;
  title: string;
  summary: string | null;
  released_at: string;
  kind: string;
}

export default function ChangelogSection() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (supabase as any)
      .from("changelog_releases")
      .select("id, version, title, summary, released_at, kind")
      .eq("is_published", true)
      .order("released_at", { ascending: false })
      .limit(5)
      .then(({ data }: { data: Release[] | null }) => {
        setReleases(data || []);
        setLoading(false);
      });
  }, []);

  if (!loading && releases.length === 0) return null;

  return (
    <Section className="bg-surface-overlay">
      <SectionLabel>Changelog</SectionLabel>
      <SectionTitle>Recent Releases</SectionTitle>

      <div className="mt-10 max-w-2xl mx-auto space-y-0">
        {loading ? (
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg mb-4" />)
        ) : (
          releases.map((r, idx) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.06 }}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              {idx < releases.length - 1 && (
                <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border/50" />
              )}
              <div className="flex items-start pt-0.5 shrink-0">
                <CheckCircle2 className="h-[30px] w-[30px] text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant="outline" className="font-mono text-[10px]">{r.version}</Badge>
                  <h4 className="font-display text-base font-semibold">{r.title}</h4>
                </div>
                {r.summary && (
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{r.summary}</p>
                )}
                {r.released_at && (
                  <span className="text-xs font-mono text-muted-foreground mt-1 block">
                    {new Date(r.released_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>

      <div className="mt-8 text-center">
        <Link
          to="/changelog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          View full changelog <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </Section>
  );
}
