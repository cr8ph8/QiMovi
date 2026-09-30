import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Coins, Loader2, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const FEATURE_ID = "ip_risk_assessment";
const FALLBACK_COST = 5;

interface RiskCategory {
  key: string;
  label: string;
  level: "low" | "medium" | "high";
  description: string;
}

function getRiskAssessment(workflowType: string): { categories: RiskCategory[]; summary: string } {
  switch (workflowType) {
    case "ai":
      return {
        categories: [
          { key: "authorship", label: "Authorship Ambiguity", level: "high", description: "AI-only outputs lack identifiable human authorship. Per Thaler v. Perlmutter (upheld 2026), fully autonomous AI works cannot receive copyright protection." },
          { key: "derivative", label: "Derivative Similarity", level: "medium", description: "AI models may produce text resembling copyrighted works. Kadrey v. Meta (2025) establishes that market harm from AI-generated substitutes is a viable legal theory. Concord Music v. Anthropic (2026) is testing whether AI outputs unlawfully reproduce protected material." },
          { key: "confidential", label: "Confidential Disclosure", level: "medium", description: "Sharing unpublished scripts with AI systems may risk trade secret protection. Use sensitivity controls to limit exposure." },
          { key: "dataset", label: "Dataset Contamination", level: "medium", description: "Stober & Dornis (2026) demonstrate that AI models memorize and can regurgitate training data — including copyrighted screenplays. AI-only workflows carry higher exposure because the entire output may derive from memorized patterns without human creative filtering." },
        ],
        summary: "AI-only workflows carry the highest authorship and contamination risk. Copyright protection is unlikely without demonstrable human creative control. Stober & Dornis (2026) establish that GenAI training replicates full data distributions rather than merely extracting patterns, meaning AI outputs may carry embedded copyrighted material. Consider documenting your prompting strategy and creative decisions to strengthen any future claims.",
      };
    case "hybrid":
      return {
        categories: [
          { key: "authorship", label: "Authorship Ambiguity", level: "medium", description: "Hybrid works may qualify for partial copyright if human contribution is identifiable. U.S. Copyright Office (2024–2025) requires human-authored portions to be distinguishable." },
          { key: "derivative", label: "Derivative Similarity", level: "medium", description: "AI-assisted sections may resemble copyrighted works. Kadrey v. Meta (2025) finds market substitution by AI outputs is actionable. Document which portions are human-authored to isolate protectable elements." },
          { key: "confidential", label: "Confidential Disclosure", level: "medium", description: "Any content shared with AI systems during the hybrid process should be tracked. Use sensitivity controls for unpublished material." },
          { key: "dataset", label: "Dataset Contamination", level: "low", description: "Stober & Dornis (2026) show AI models can memorize training data and reproduce it in outputs. In hybrid workflows, human revision acts as a filter — but maintaining provenance records strengthens your position if questions arise about AI-influenced sections." },
        ],
        summary: "Hybrid workflows offer a balanced risk profile. The key is documenting which creative decisions were human-driven. CanIScreenwrite's rewrite lineage and decision tracking help demonstrate the human authorship courts require — directly aligned with the tiered documentation framework recommended by Stober & Dornis (2026).",
      };
    case "human":
      return {
        categories: [
          { key: "authorship", label: "Authorship Ambiguity", level: "low", description: "Human-authored works have clear copyright protection under existing law. No AI authorship questions arise." },
          { key: "derivative", label: "Derivative Similarity", level: "low", description: "Standard plagiarism and fair use rules apply. No AI-specific derivative risk." },
          { key: "confidential", label: "Confidential Disclosure", level: "low", description: "No AI processing means no risk of content exposure through model pipelines. Standard confidentiality practices apply." },
          { key: "dataset", label: "Dataset Contamination", level: "low", description: "Not applicable — no AI training data involved in the creative process." },
        ],
        summary: "Human-only workflows carry minimal AI-related IP risk. Your work qualifies for full copyright protection under existing law. The governance layer still benefits you by documenting your creative process for any future disputes.",
      };
    default:
      return { categories: [], summary: "" };
  }
}

const levelConfig = {
  low: { color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle, label: "Low" },
  medium: { color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/30", icon: AlertTriangle, label: "Medium" },
  high: { color: "text-destructive", bg: "bg-destructive/10 border-destructive/30", icon: AlertTriangle, label: "High" },
};

export default function IPRiskAssessment() {
  const { user } = useAuth();
  const { spendCustom } = useWallet();
  const [unlocked, setUnlocked] = useState(false);
  const [spending, setSpending] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [tokenCost, setTokenCost] = useState(FALLBACK_COST);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    supabase
      .from("feature_configs")
      .select("token_cost, enabled")
      .eq("id", FEATURE_ID)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setTokenCost(data.token_cost);
          setEnabled(data.enabled);
        }
      });
  }, []);

  const handleUnlock = async () => {
    setSpending(true);
    const success = await spendCustom(tokenCost, "IP Risk Assessment");
    setSpending(false);
    if (success) setUnlocked(true);
  };

  const assessment = selectedWorkflow ? getRiskAssessment(selectedWorkflow) : null;
  const overallRisk = assessment
    ? assessment.categories.some((c) => c.level === "high")
      ? "high"
      : assessment.categories.some((c) => c.level === "medium")
      ? "medium"
      : "low"
    : null;

  if (!enabled) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/80 p-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-semibold">IP Risk Assessment</h2>
        <Badge variant="outline" className="text-[10px] font-mono ml-auto border-primary/30 text-primary">
          <Coins className="h-3 w-3 mr-1" /> {tokenCost} ⊘
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Assess your intellectual property risk based on your workflow type, informed by current AI copyright case law (2023–2026).
      </p>

      {!user ? (
        <p className="text-xs text-muted-foreground italic">Sign in to access IP risk assessment.</p>
      ) : !unlocked ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleUnlock}
          disabled={spending}
          className="border-primary/30 text-primary hover:bg-primary/10"
        >
          {spending ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Unlocking…</>
          ) : (
            <><Coins className="h-3.5 w-3.5 mr-1.5" /> Unlock Assessment · {tokenCost} ⊘</>
          )}
        </Button>
      ) : (
        <div className="space-y-4">
          {/* Workflow selector */}
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">Select your workflow type</p>
            <div className="flex gap-2">
              {[
                { key: "ai", label: "AI-Only" },
                { key: "hybrid", label: "Hybrid" },
                { key: "human", label: "Human" },
              ].map((wf) => (
                <Button
                  key={wf.key}
                  size="sm"
                  variant={selectedWorkflow === wf.key ? "default" : "outline"}
                  onClick={() => setSelectedWorkflow(wf.key)}
                  className={selectedWorkflow === wf.key ? "bg-primary text-primary-foreground" : "border-border/50"}
                >
                  {wf.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Results */}
          <AnimatePresence mode="wait">
            {assessment && overallRisk && (
              <motion.div
                key={selectedWorkflow}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                {/* Overall risk badge */}
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${levelConfig[overallRisk].bg}`}>
                  {(() => { const Icon = levelConfig[overallRisk].icon; return <Icon className={`h-4 w-4 ${levelConfig[overallRisk].color}`} />; })()}
                  <span className={`text-sm font-semibold ${levelConfig[overallRisk].color}`}>
                    Overall Risk: {levelConfig[overallRisk].label}
                  </span>
                </div>

                {/* Risk categories */}
                <div className="grid gap-2">
                  {assessment.categories.map((cat) => {
                    const cfg = levelConfig[cat.level];
                    const Icon = cfg.icon;
                    return (
                      <div key={cat.key} className={`rounded-lg border p-3 ${cfg.bg}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                          <span className="text-sm font-semibold">{cat.label}</span>
                          <Badge variant="outline" className={`text-[10px] font-mono ml-auto ${cfg.bg} ${cfg.color}`}>
                            {cfg.label}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{cat.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Summary */}
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-xs text-foreground/80 leading-relaxed">{assessment.summary}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
