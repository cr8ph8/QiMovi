/**
 * CharacterVoicePanel — screenplay-facing character & voice analysis surface.
 * Renders inside the AnalysisTabs "characters" tab as an upgrade over the basic list.
 */
import { useMemo } from "react";
import type { FountainParseResult } from "@/lib/fountain-parser";
import {
  analyzeCharacters,
  computeVoiceMetrics,
  distinctivenessLabel,
  distinctivenessColor,
  balanceLabel,
  balanceColor,
  type CharacterProfile,
  type CharacterSentiment,
} from "@/lib/character";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Users, MessageSquare, ChevronDown, Fingerprint, BarChart3, AlertTriangle, SmilePlus, Frown, Meh, Shuffle } from "lucide-react";

function sentimentIcon(label: CharacterSentiment["label"]) {
  switch (label) {
    case "positive": return <SmilePlus className="h-3 w-3 text-emerald-500" />;
    case "negative": return <Frown className="h-3 w-3 text-destructive" />;
    case "mixed": return <Shuffle className="h-3 w-3 text-amber-500" />;
    default: return <Meh className="h-3 w-3 text-muted-foreground" />;
  }
}

function sentimentColor(label: CharacterSentiment["label"]) {
  switch (label) {
    case "positive": return "text-emerald-500";
    case "negative": return "text-destructive";
    case "mixed": return "text-amber-500";
    default: return "text-muted-foreground";
  }
}

function CharacterCard({ profile, maxLines }: { profile: CharacterProfile; maxLines: number }) {
  const barPct = maxLines > 0 ? (profile.dialogueLineCount / maxLines) * 100 : 0;

  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center gap-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors px-3 py-2.5 cursor-pointer">
          <span className="text-xs font-mono font-semibold text-foreground truncate min-w-[80px] text-left">{profile.name}</span>
          <div className="flex-1 min-w-0">
            <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${barPct}%` }} />
            </div>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{profile.dialogueLineCount} lines</span>
          <span className={`inline-flex items-center gap-0.5 shrink-0 ${sentimentColor(profile.sentiment.label)}`}>
            {sentimentIcon(profile.sentiment.label)}
            <span className="text-[9px] font-mono capitalize">{profile.sentiment.label}</span>
          </span>
          <Badge
            variant="outline"
            className={`text-[9px] font-mono shrink-0 ${distinctivenessColor(profile.distinctivenessScore)}`}
          >
            {distinctivenessLabel(profile.distinctivenessScore)}
          </Badge>
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-3 mr-3 mb-2 mt-1 rounded-lg border border-border/30 bg-card/60 p-3 space-y-3">
          {/* Metrics row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-sm font-mono font-bold text-foreground">{profile.scenePresenceCount}</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Scenes</p>
            </div>
            <div>
              <p className="text-sm font-mono font-bold text-foreground">{profile.dialogueShareRatio}%</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Dialogue Share</p>
            </div>
            <div>
              <p className="text-sm font-mono font-bold text-foreground">{profile.avgLineLength}</p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Avg Line Len</p>
            </div>
            <div>
              <p className={`text-sm font-mono font-bold ${distinctivenessColor(profile.distinctivenessScore)}`}>
                {profile.distinctivenessScore}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground uppercase">Distinctiveness</p>
            </div>
          </div>

          {/* Sentiment breakdown */}
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1.5">Sentiment</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-muted/60 overflow-hidden flex">
                {profile.sentiment.positive > 0 && (
                  <div className="h-full bg-emerald-500/70" style={{ width: `${profile.sentiment.positive}%` }} />
                )}
                {profile.sentiment.neutral > 0 && (
                  <div className="h-full bg-muted-foreground/30" style={{ width: `${profile.sentiment.neutral}%` }} />
                )}
                {profile.sentiment.negative > 0 && (
                  <div className="h-full bg-destructive/70" style={{ width: `${profile.sentiment.negative}%` }} />
                )}
              </div>
              <span className={`text-[10px] font-mono capitalize ${sentimentColor(profile.sentiment.label)}`}>
                {profile.sentiment.label}
              </span>
            </div>
            <div className="flex gap-3 mt-1 text-[9px] font-mono text-muted-foreground">
              <span className="text-emerald-500">+{profile.sentiment.positive}%</span>
              <span>~{profile.sentiment.neutral}%</span>
              <span className="text-destructive">-{profile.sentiment.negative}%</span>
            </div>
          </div>

          {/* Punctuation style */}
          <div>
            <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Punctuation Style</p>
            <div className="flex gap-3 text-[10px] font-mono text-muted-foreground">
              <span>! {profile.punctuationStyle.exclamationRate}%</span>
              <span>? {profile.punctuationStyle.questionRate}%</span>
              <span>… {profile.punctuationStyle.ellipsisRate}%</span>
            </div>
          </div>

          {/* Repeated phrases */}
          {profile.repeatedPhrases.length > 0 && (
            <div>
              <p className="text-[9px] font-mono text-muted-foreground uppercase mb-1">Verbal Signatures</p>
              <div className="flex flex-wrap gap-1">
                {profile.repeatedPhrases.slice(0, 5).map((rp) => (
                  <span key={rp.phrase} className="px-1.5 py-0.5 rounded bg-muted/40 text-[9px] font-mono text-muted-foreground">
                    "{rp.phrase}" ×{rp.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function CharacterVoicePanel({ parsed }: { parsed: FountainParseResult }) {
  const profiles = useMemo(() => analyzeCharacters(parsed), [parsed]);
  const voice = useMemo(() => computeVoiceMetrics(profiles), [profiles]);
  const maxLines = profiles.length > 0 ? profiles[0].dialogueLineCount : 0;

  if (profiles.length === 0) {
    return (
      <div className="text-center py-8">
        <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No characters detected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Voice overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className="text-lg font-mono font-bold text-foreground">{voice.characterCount}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Characters</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className={`text-lg font-mono font-bold ${distinctivenessColor(voice.avgDistinctiveness)}`}>
            {voice.avgDistinctiveness}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Avg Distinctiveness</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className={`text-lg font-mono font-bold ${balanceColor(voice.dialogueBalance)}`}>
            {balanceLabel(voice.dialogueBalance)}
          </p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Dialogue Balance</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <p className="text-lg font-mono font-bold text-foreground">{voice.cadenceVariance}</p>
          <p className="text-[9px] font-mono text-muted-foreground uppercase">Cadence Variance</p>
        </div>
      </div>

      {/* Low distinctiveness flags */}
      {voice.lowDistinctivenessFlags.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] font-mono text-amber-600 font-semibold">Low Distinctiveness Alert</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {voice.lowDistinctivenessFlags.join(", ")} — characters may sound too similar.
            </p>
          </div>
        </div>
      )}

      {/* Character cards */}
      <div className="space-y-1.5">
        {profiles.map((p) => (
          <CharacterCard key={p.name} profile={p} maxLines={maxLines} />
        ))}
      </div>
    </div>
  );
}
