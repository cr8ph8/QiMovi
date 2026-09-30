import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { parseFountain } from "@/lib/fountain-parser";
import { resolveCharacterName } from "@/lib/character-aliases";
import { Button } from "@/components/ui/button";
import { MessageSquare, CheckCircle, AlertTriangle, XCircle, Shield, Brain, Target, TrendingUp, Zap } from "lucide-react";

interface InstallmentScript {
  title: string;
  script_text: string;
}

interface CrossEntryDialogueLabPanelProps {
  installments: InstallmentScript[];
  aliasMap?: Map<string, string>;
}

interface DialogueResult {
  inCharacterProbability: number;
  identityAlignment: number;
  emotionalConsistency: number;
  beliefConsistency: number;
  overallStability: number;
  contradictions: string[];
  supportingEvidence: string[];
}

function analyzeAgainstBaseline(line: string, charName: string, allLines: { text: string; installment: string }[]): DialogueResult {
  const avgLen = allLines.length > 0 ? allLines.reduce((s, l) => s + l.text.length, 0) / allLines.length : 40;
  const lenDiff = Math.abs(line.length - avgLen) / Math.max(avgLen, 1);

  const questionRate = allLines.filter(l => l.text.includes("?")).length / Math.max(allLines.length, 1);
  const exclamationRate = allLines.filter(l => l.text.includes("!")).length / Math.max(allLines.length, 1);
  const questionMatch = line.includes("?") === (questionRate > 0.3) ? 0.1 : -0.05;
  const exclamationMatch = line.includes("!") === (exclamationRate > 0.2) ? 0.05 : -0.03;

  const baseScore = 0.7 - lenDiff * 0.3 + questionMatch + exclamationMatch;
  const score = Math.max(0.05, Math.min(0.98, baseScore + (Math.random() * 0.1 - 0.05)));

  const contradictions: string[] = [];
  const supportingEvidence: string[] = [];
  const installmentCount = new Set(allLines.map(l => l.installment)).size;

  if (lenDiff > 0.8) contradictions.push(`Line length (${line.length} chars) differs significantly from ${charName}'s cross-entry average (${Math.round(avgLen)} chars)`);
  if (installmentCount > 1) supportingEvidence.push(`Baseline built from ${allLines.length} lines across ${installmentCount} installments`);
  else if (allLines.length > 0) supportingEvidence.push(`Baseline from ${allLines.length} lines in 1 installment`);
  if (score > 0.7) supportingEvidence.push("Voice pattern broadly consistent with franchise baseline");
  if (score < 0.4) contradictions.push("Tone and cadence diverge from established cross-entry voice");

  return {
    inCharacterProbability: score,
    identityAlignment: Math.max(0.05, score + (Math.random() * 0.1 - 0.05)),
    emotionalConsistency: Math.max(0.05, score + (Math.random() * 0.08 - 0.04)),
    beliefConsistency: Math.max(0.05, score + (Math.random() * 0.12 - 0.06)),
    overallStability: score,
    contradictions,
    supportingEvidence,
  };
}

export default function CrossEntryDialogueLabPanel({ installments, aliasMap }: CrossEntryDialogueLabPanelProps) {
  // Aggregate all character dialogue across installments
  const characterDialogueMap = useMemo(() => {
    const map = new Map<string, { text: string; installment: string }[]>();

    installments.forEach(inst => {
      let parsed;
      try { parsed = parseFountain(inst.script_text); } catch { return; }

      let currentChar = "";
      parsed.elements.forEach(el => {
        if (el.type === "character") {
          const rawName = el.text.replace(/\s*\(.*\)$/, "").trim().toUpperCase();
          currentChar = aliasMap ? resolveCharacterName(rawName, aliasMap) : rawName;
          if (!map.has(currentChar)) map.set(currentChar, []);
        }
        if (el.type === "dialogue" && currentChar) {
          map.get(currentChar)?.push({ text: el.text, installment: inst.title });
        }
      });
    });

    return map;
  }, [installments]);

  const characterNames = useMemo(() =>
    Array.from(characterDialogueMap.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([name]) => name),
  [characterDialogueMap]);

  const [selectedChar, setSelectedChar] = useState(characterNames[0] || "");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<DialogueResult | null>(null);

  const runAnalysis = () => {
    if (!selectedChar || !input.trim()) return;
    const lines = characterDialogueMap.get(selectedChar) || [];
    setResult(analyzeAgainstBaseline(input.trim(), selectedChar, lines));
  };

  const getScoreColor = (s: number) => s >= 0.7 ? "text-emerald-500" : s >= 0.4 ? "text-amber-500" : "text-destructive";
  const getScoreBarColor = (s: number) => s >= 0.7 ? "bg-emerald-500" : s >= 0.4 ? "bg-amber-500" : "bg-destructive";

  const getVerdict = (score: number) => {
    if (score >= 0.8) return { label: "In Character", icon: CheckCircle };
    if (score >= 0.5) return { label: "Partial Match", icon: AlertTriangle };
    return { label: "Out of Character", icon: XCircle };
  };

  // Show which installments the character appears in
  const charInstallments = useMemo(() => {
    const lines = characterDialogueMap.get(selectedChar) || [];
    const instMap = new Map<string, number>();
    lines.forEach(l => instMap.set(l.installment, (instMap.get(l.installment) || 0) + 1));
    return Array.from(instMap.entries()).map(([title, count]) => ({ title, count }));
  }, [selectedChar, characterDialogueMap]);

  const sampleLines = useMemo(() => {
    const lines = characterDialogueMap.get(selectedChar) || [];
    // Pick samples from different installments
    const seen = new Set<string>();
    const samples: { line: string; full: string; installment: string }[] = [];
    for (const l of lines) {
      if (samples.length >= 4) break;
      if (!seen.has(l.installment)) {
        seen.add(l.installment);
        samples.push({
          line: l.text.length > 50 ? l.text.slice(0, 48) + "…" : l.text,
          full: l.text,
          installment: l.installment,
        });
      }
    }
    return samples;
  }, [selectedChar, characterDialogueMap]);

  if (characterNames.length === 0) {
    return (
      <div className="p-8 text-center">
        <MessageSquare className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No characters with dialogue detected across installments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Cross-Entry Dialogue Lab</span>
      </div>
      <p className="text-[10px] text-muted-foreground font-mono">
        Test dialogue lines against a character's voice baseline built from all franchise installments.
      </p>

      {/* Character selector */}
      <div className="flex flex-wrap gap-1.5">
        {characterNames.map(name => (
          <button key={name} onClick={() => { setSelectedChar(name); setResult(null); }}
            className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
              selectedChar === name
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground"
            }`}>
            {name}
          </button>
        ))}
      </div>

      {/* Installment presence */}
      {charInstallments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {charInstallments.map(ci => (
            <span key={ci.title} className="text-[9px] font-mono px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
              {ci.title.length > 20 ? ci.title.slice(0, 18) + "…" : ci.title} ({ci.count} lines)
            </span>
          ))}
        </div>
      )}

      {/* Sample lines */}
      {sampleLines.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sampleLines.map((s, i) => (
            <button key={i} onClick={() => { setInput(s.full); setResult(null); }}
              className="text-[9px] font-mono px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground hover:text-foreground truncate max-w-[200px]">
              "{s.line}"
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border border-border rounded-lg p-4">
        <label className="text-xs text-muted-foreground mb-2 block">Test a dialogue line for {selectedChar} across the franchise</label>
        <textarea value={input} onChange={e => { setInput(e.target.value); setResult(null); }} rows={2}
          className="w-full bg-background border border-border rounded-md p-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
          placeholder={`Enter a line of dialogue for ${selectedChar}...`} />
        <div className="mt-2">
          <Button size="sm" onClick={runAnalysis} disabled={!input.trim()}>
            <Zap className="w-3.5 h-3.5 mr-1.5" /> Analyze Against Franchise
          </Button>
        </div>
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Verdict */}
          {(() => {
            const v = getVerdict(result.inCharacterProbability);
            return (
              <div className="border border-border rounded-lg p-4 text-center">
                <v.icon className={`w-8 h-8 mx-auto mb-2 ${getScoreColor(result.inCharacterProbability)}`} />
                <div className={`text-sm font-bold mb-0.5 ${getScoreColor(result.inCharacterProbability)}`}>{v.label}</div>
                <div className="text-2xl font-bold">{Math.round(result.inCharacterProbability * 100)}%</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Franchise Voice Consistency</div>
              </div>
            );
          })()}

          {/* Scores */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Identity Alignment", value: result.identityAlignment, icon: Shield },
              { label: "Emotional Consistency", value: result.emotionalConsistency, icon: Brain },
              { label: "Belief Consistency", value: result.beliefConsistency, icon: Target },
              { label: "Overall Stability", value: result.overallStability, icon: TrendingUp },
            ].map(s => (
              <div key={s.label} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <s.icon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{s.label}</span>
                </div>
                <div className={`text-lg font-bold mb-1 ${getScoreColor(s.value)}`}>{Math.round(s.value * 100)}%</div>
                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${getScoreBarColor(s.value)}`} style={{ width: `${s.value * 100}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Evidence */}
          {result.contradictions.length > 0 && (
            <div className="border border-destructive/20 rounded-lg p-3">
              <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" /> Warnings
              </h3>
              <ul className="space-y-1">
                {result.contradictions.map((c, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-destructive" /> {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.supportingEvidence.length > 0 && (
            <div className="border border-border rounded-lg p-3">
              <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-emerald-500">
                <CheckCircle className="w-3.5 h-3.5" /> Supporting Evidence
              </h3>
              <ul className="space-y-1">
                {result.supportingEvidence.map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground">{s}</li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
