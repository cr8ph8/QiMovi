import { motion } from "framer-motion";
import { Section, SectionLabel, SectionTitle, SectionDescription } from "@/components/Section";
import { Brain, Zap, Scale, BarChart3, RefreshCw, Shield, Upload, FileSearch, Layers, Target, Trophy } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.5 }
  })
};

const pipelineNodes = [
  { icon: Upload, title: "Submission", label: "Screenplay uploaded" },
  { icon: FileSearch, title: "Ingestion", label: "Parse & format" },
  { icon: Layers, title: "Multi-Pass Analysis", label: "9 dimensions" },
  { icon: Target, title: "Calibration", label: "Benchmark alignment" },
  { icon: Trophy, title: "Signal Aggregation", label: "Combined /120" },
];

const scoringDimensions = [
  "Concept", "Story", "Characters", "Dialogue", "Theme", "Market", "Cinematic", "Climax", "Technicalities"
];

function PipelineConnectorH({ delay }: { delay: number }) {
  return (
    <div className="hidden md:flex items-center justify-center w-12 relative">
      <div className="h-px w-full bg-primary/20" />
      <div
        className="absolute h-2 w-2 rounded-full bg-primary pipeline-dot"
        style={{
          offsetPath: "path('M 0 0 L 48 0')",
          animationDelay: `${delay}s`,
        }}
      />
    </div>
  );
}

function PipelineConnectorV({ delay }: { delay: number }) {
  return (
    <div className="flex md:hidden items-center justify-center h-10 relative">
      <div className="w-px h-full bg-primary/20" />
      <div
        className="absolute h-2 w-2 rounded-full bg-primary pipeline-dot"
        style={{
          offsetPath: "path('M 0 0 L 0 40')",
          animationDelay: `${delay}s`,
        }}
      />
    </div>
  );
}

function ScoringPipeline() {
  const isMobile = useIsMobile();

  return (
    <div className="mt-12 mb-16">
      {/* Pipeline nodes */}
      <div className="flex flex-col md:flex-row items-center justify-center">
        {pipelineNodes.map((node, i) => (
          <div key={i} className="flex flex-col md:flex-row items-center">
            <motion.div
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="relative p-4 md:p-5 rounded-xl border border-primary/20 bg-card/80 w-36 md:w-40 text-center"
            >
              <node.icon className="h-6 w-6 text-primary mx-auto mb-2" />
              <h4 className="font-display text-sm font-semibold mb-0.5">{node.title}</h4>
              <p className="text-xs text-muted-foreground">{node.label}</p>

              {/* Fan-out for Multi-Pass Scoring */}
              {i === 2 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1">
                  {scoringDimensions.map((dim, j) => (
                    <motion.span
                      key={j}
                      initial={{ opacity: 0, scale: 0.8 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.4 + j * 0.07, duration: 0.3 }}
                      className="inline-block px-2 py-0.5 text-[10px] font-mono rounded-full border border-primary/30 bg-primary/10 text-primary"
                    >
                      {dim}
                    </motion.span>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Connector */}
            {i < pipelineNodes.length - 1 && (
              isMobile
                ? <PipelineConnectorV delay={i * 0.5} />
                : <PipelineConnectorH delay={i * 0.5} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const advantages = [
  { icon: Scale, title: "Zero Bias", desc: "No favoritism based on name, reputation, or genre preference — every screenplay is observed equally." },
  { icon: Zap, title: "Speed at Scale", desc: "Hundreds of screenplays analyzed with the same rigor, without reviewer fatigue." },
  { icon: RefreshCw, title: "Reproducible", desc: "The same script produces the same analytical signals every time — no mood, no off-days." },
  { icon: BarChart3, title: "Rich Signals", desc: "Granular analytical data surfaces detailed observations and competition-wide patterns." },
  { icon: Shield, title: "Transparent Criteria", desc: "Every signal maps to a published dimension — entrants know exactly what's being observed." },
  { icon: Brain, title: "Continuous Improvement", desc: "The analysis model is refined between competitions based on signal patterns and feedback." },
];

export default function AIJudgingSection() {
  return (
    <Section className="bg-surface-overlay">
      <SectionLabel>AI Analysis</SectionLabel>
      <SectionTitle>How AI Analysis Works</SectionTitle>
      <SectionDescription>
        Every screenplay is observed through a structured, multi-dimensional analysis pipeline — 
        surfacing consistent, unbiased signals at scale.
      </SectionDescription>

      {/* Animated pipeline diagram */}
      <ScoringPipeline />

      {/* Why AI judging */}
      <div>
        <h3 className="font-display text-xl font-bold mb-6">Why AI Analysis?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {advantages.map((adv, i) => (
            <motion.div
              key={i}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="p-5 rounded-lg border border-border/50 bg-card/50"
            >
              <adv.icon className="h-5 w-5 text-primary mb-3" />
              <h4 className="font-display text-base font-semibold mb-1">{adv.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{adv.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </Section>
  );
}
