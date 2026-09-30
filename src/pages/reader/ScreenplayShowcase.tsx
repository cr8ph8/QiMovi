import { useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import { Film, Play, Users, Quote, ArrowRight, Download, Archive, Network } from "lucide-react";
import { ReaderLayout } from "@/components/reader/ReaderLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useEntry } from "@/lib/reader/queries";
import { useReaderRole } from "@/lib/reader/roles";
import { RoleBadge } from "@/components/reader/RoleBadge";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.25, 0.1, 0, 1] as [number, number, number, number] } },
};
const stagger = { visible: { transition: { staggerChildren: 0.12 } } };

function Section({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      ref={ref}
      id={id}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={stagger}
      className={`relative py-14 md:py-20 scroll-mt-16 ${className}`}
    >
      {children}
    </motion.section>
  );
}

const FALLBACK_PULLS = [
  "Every scene earns its place — nothing wasted.",
  "Dialogue with rhythm and intent.",
  "A premise that lingers after the page closes.",
];

export default function ScreenplayShowcase() {
  const { entryId } = useParams();
  const { entry, loading } = useEntry(entryId);
  const caps = useReaderRole(entry);
  useDocumentTitle(entry ? `${entry.title} · Showcase` : "Showcase · Reader");

  if (loading) {
    return (
      <ReaderLayout>
        <div className="space-y-4 max-w-3xl">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </ReaderLayout>
    );
  }

  if (!entry) {
    return (
      <ReaderLayout>
        <div className="text-center py-20">
          <Film className="w-10 h-10 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-sm text-foreground">Script not found or not accessible.</p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link to="/reader">Back to Script Club</Link>
          </Button>
        </div>
      </ReaderLayout>
    );
  }

  const format = entry.length_category ?? "Screenplay";
  const genres = (entry.genre ?? "").split(/[,/]/).map((g) => g.trim()).filter(Boolean);
  const aiFields = (entry.ai_fields ?? {}) as Record<string, unknown>;
  const synopsis =
    (typeof aiFields.synopsis === "string" && aiFields.synopsis) ||
    (typeof aiFields.summary === "string" && aiFields.summary) ||
    entry.logline ||
    "Synopsis not yet available for this script.";

  return (
    <ReaderLayout>
      {/* HERO */}
      <Section className="!pt-4">
        <motion.div variants={fadeUp} className="space-y-5 max-w-3xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-primary">
              <Film className="w-3.5 h-3.5" /> Showcase
            </div>
            <RoleBadge role={caps.role} />
          </div>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl text-foreground leading-[1.05]">
            {entry.title}
          </h1>
          {entry.logline && (
            <p className="text-base sm:text-lg text-muted-foreground italic max-w-2xl">"{entry.logline}"</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{format}</Badge>
            {entry.page_count != null && (
              <Badge variant="outline" className="text-[10px] font-mono">{entry.page_count} pp</Badge>
            )}
            {genres.map((g) => (
              <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="sm" className="gap-1.5">
              <Link to={`/entry/${entryId}`}>
                <Play className="w-3.5 h-3.5" /> Read Screenplay
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to={`/reader/${entryId}`}>
                <Network className="w-3.5 h-3.5" /> Project Hub
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="gap-1.5">
              <Link to={`/reader/${entryId}/vault`}>
                <Archive className="w-3.5 h-3.5" /> Vault
              </Link>
            </Button>
          </div>
        </motion.div>
      </Section>

      {/* SYNOPSIS */}
      <Section className="border-t border-border/40">
        <motion.div variants={fadeUp} className="grid lg:grid-cols-[1fr_2fr] gap-10">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-primary">Synopsis</p>
          </div>
          <p className="text-base text-foreground/90 leading-relaxed max-w-2xl">{synopsis}</p>
        </motion.div>
      </Section>

      {/* PULL QUOTES */}
      <Section className="border-t border-border/40">
        <motion.div variants={fadeUp} className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary">Reader Pulls</p>
        </motion.div>
        <div className="grid md:grid-cols-3 gap-6">
          {FALLBACK_PULLS.map((p, i) => (
            <motion.blockquote
              key={i}
              variants={fadeUp}
              className="relative bg-card border border-border/60 rounded-xl p-6"
            >
              <Quote className="absolute top-4 left-4 w-4 h-4 text-primary/40" />
              <p className="text-sm text-foreground/90 italic pl-6 leading-relaxed">"{p}"</p>
            </motion.blockquote>
          ))}
        </div>
      </Section>

      {/* AUTHOR */}
      <Section className="border-t border-border/40">
        <motion.div variants={fadeUp} className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-primary">Credits</p>
            <h2 className="font-display text-2xl text-foreground mt-1">Written by</h2>
          </div>
          <Users className="w-5 h-5 text-muted-foreground" />
        </motion.div>
        <div className="bg-card border border-border/60 rounded-xl p-5 flex items-center gap-4 max-w-md">
          <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center text-primary font-display">
            {(entry.author ?? entry.title).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {entry.author ?? "Unknown author"}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              Submitted {new Date(entry.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </Section>

      {/* EXPORT BAR */}
      <Section className="border-t border-border/40 !pb-6">
        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-4 bg-card border border-border/60 rounded-xl p-5">
          <div>
            <p className="text-sm font-medium text-foreground">Take this elsewhere</p>
            <p className="text-xs text-muted-foreground">Export coverage, share read links, or open the vault.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {caps.canExportArtifacts && (
              <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-3.5 h-3.5" /> Coverage PDF</Button>
            )}
            <Button asChild size="sm" className="gap-1.5">
              <Link to={`/reader/${entryId}`}>Open Hub <ArrowRight className="w-3.5 h-3.5" /></Link>
            </Button>
          </div>
        </motion.div>
        <p className="text-[11px] text-muted-foreground/70 mt-6 text-center italic">
          Live data from your entry record.
        </p>
      </Section>
    </ReaderLayout>
  );
}
