import { motion } from "framer-motion";
import ComingSoonSection from "@/components/ComingSoonSection";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { Brain, Users, Layers, Eye, BarChart3, Globe, Rocket, BookOpen, Shield } from "lucide-react";
import { AccessGate } from "@/components/AccessGate";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5 } })
};

export default function PlatformPage() {
  const roadmap = [
    { phase: "Phase 1 — Now", icon: Rocket, title: "AI Competition Launch", desc: "Inaugural AI-only screenwriting competition with AI judging and structured scoring.", status: "active", items: ["Screenplay submissions", "AI-powered judging", "Six-dimension scoring", "Disclosure workflows"] },
    { phase: "Phase 2", icon: Users, title: "Human-Only Competitions", desc: "Traditional screenplay competitions with the same structured scoring infrastructure.", status: "upcoming", items: ["Human-written entries", "Same blind review process", "Cross-mode comparison data", "Industry judge panels"] },
    { phase: "Phase 3", icon: Layers, title: "Hybrid Competitions", desc: "Human+AI collaborative entries with detailed contribution mapping.", status: "upcoming", items: ["Collaboration disclosure", "AI contribution tracking", "Workflow transparency", "Mixed-mode leaderboards"] },
    { phase: "Phase 4", icon: BookOpen, title: "Reader Community", desc: "Open the platform to screenplay readers who discover, rate, and discuss scripts.", status: "future", items: ["Reader profiles", "Script discovery feed", "Community ratings", "Discussion threads"] },
  ];

  return (
    <AccessGate tier="dev_mode" label="the Platform page">
    <>
      <section className="pt-20 pb-10">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
            <span className="inline-block text-xs font-mono tracking-[0.2em] uppercase text-primary mb-4">Platform Vision</span>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              Built for Every<br />
              <span className="text-gradient-gold italic">Intelligence Type</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
              CanIScreenwrite is architected from day one to support AI, human, and hybrid competitions — 
              plus a future reader community. Here's the full picture.
            </p>
          </motion.div>
        </div>
      </section>

      <Section>
        <SectionLabel>Roadmap</SectionLabel>
        <SectionTitle>Platform Evolution</SectionTitle>
        <div className="mt-12 space-y-6">
          {roadmap.map((item, i) => (
            <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className={`relative p-8 rounded-xl border transition-all ${
                item.status === "active" ? "border-primary/40 bg-card glow-gold" : "border-border/50 bg-card/50"
              }`}>
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                <div className="shrink-0">
                  <div className={`flex items-center gap-2 text-xs font-mono mb-2 ${
                    item.status === "active" ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {item.status === "active" && <span className="h-2 w-2 rounded-full bg-primary animate-pulse-gold" />}
                    {item.phase}
                  </div>
                  <item.icon className={`h-8 w-8 ${item.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-xl font-bold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{item.desc}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {item.items.map((feature, j) => (
                      <div key={j} className="flex items-center gap-2 text-sm text-secondary-foreground">
                        <div className={`h-1.5 w-1.5 rounded-full ${item.status === "active" ? "bg-primary" : "bg-muted-foreground/40"}`} />
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </Section>

      <Section className="bg-surface-overlay">
        <SectionLabel>Core Infrastructure</SectionLabel>
        <SectionTitle>Platform Capabilities</SectionTitle>
        <SectionDescription>The systems powering fair, transparent screenplay evaluation.</SectionDescription>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: Shield, title: "AI Judging Engine", desc: "AI-powered judges evaluate every submission with consistent, structured scoring." },
            { icon: Eye, title: "Disclosure Framework", desc: "Structured AI usage declarations integrated into every submission flow." },
            { icon: BarChart3, title: "Scoring Analytics", desc: "Rich performance data across six evaluation dimensions." },
            { icon: Brain, title: "Intelligence Classification", desc: "Track and compare performance across AI, human, and hybrid modes." },
            { icon: Globe, title: "Discovery Engine", desc: "Surface top scripts for industry attention and community engagement." },
            { icon: Users, title: "Admin Control Layer", desc: "Operator dashboards for managing competitions end to end." },
          ].map((feat, i) => (
            <motion.div key={i} custom={i} variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true }}
              className="p-6 rounded-xl border border-border/50 bg-card/50">
              <feat.icon className="h-5 w-5 text-primary mb-4" />
              <h3 className="font-display text-base font-semibold mb-2">{feat.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feat.desc}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      <ComingSoonSection />
    </>
    </AccessGate>
  );
}
