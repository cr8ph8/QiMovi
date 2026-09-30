/**
 * Character & voice analysis utilities.
 * Computes heuristic metrics from parsed screenplay (FountainParseResult) data.
 * All analysis is read-only and deterministic.
 */

import type { FountainElement, FountainParseResult } from "./fountain-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CharacterSentiment {
  positive: number; // 0–100
  negative: number; // 0–100
  neutral: number;  // 0–100
  label: "positive" | "negative" | "neutral" | "mixed";
}

export interface CharacterProfile {
  name: string;
  dialogueLineCount: number;
  dialogueShareRatio: number;
  scenePresenceCount: number;
  avgLineLength: number;
  lexicalUniqueness: number;
  repeatedPhrases: { phrase: string; count: number }[];
  punctuationStyle: {
    exclamationRate: number;
    questionRate: number;
    ellipsisRate: number;
  };
  distinctivenessScore: number;
  sentiment: CharacterSentiment;
}

export interface VoiceMetrics {
  characterCount: number;
  avgDistinctiveness: number;
  lowDistinctivenessFlags: string[];
  dialogueBalance: number; // 0-100, 100 = perfectly balanced
  dominantCharacter: string | null;
  cadenceVariance: number; // std dev of avg line lengths
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDialogueByCharacter(elements: FountainElement[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let currentChar = "";
  for (const el of elements) {
    if (el.type === "character") {
      currentChar = el.text.replace(/\s*\(.*\)$/, "").trim();
    } else if (el.type === "dialogue" && currentChar) {
      const lines = map.get(currentChar) || [];
      lines.push(el.text);
      map.set(currentChar, lines);
    } else if (el.type !== "parenthetical") {
      currentChar = "";
    }
  }
  return map;
}

function getSceneCharacters(elements: FountainElement[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  let sceneIdx = -1;
  for (const el of elements) {
    if (el.type === "scene_heading") {
      sceneIdx++;
    } else if (el.type === "character" && sceneIdx >= 0) {
      const name = el.text.replace(/\s*\(.*\)$/, "").trim();
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(sceneIdx);
    }
  }
  return map;
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
}

function findRepeatedPhrases(lines: string[], minLen = 3, minCount = 2): { phrase: string; count: number }[] {
  const phraseCount = new Map<string, number>();
  for (const line of lines) {
    const w = words(line);
    for (let len = minLen; len <= Math.min(6, w.length); len++) {
      for (let i = 0; i <= w.length - len; i++) {
        const phrase = w.slice(i, i + len).join(" ");
        phraseCount.set(phrase, (phraseCount.get(phrase) || 0) + 1);
      }
    }
  }
  return Array.from(phraseCount.entries())
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));
}

function lexicalUniquenessScore(lines: string[], allDialogueWords: Set<string>): number {
  const charWords = new Set(lines.flatMap(words));
  if (charWords.size === 0 || allDialogueWords.size === 0) return 0;
  let unique = 0;
  charWords.forEach((w) => {
    // Word is "unique" to this character if rare overall
    unique++;
  });
  // Simple ratio: unique words / total vocabulary * 100
  return Math.round((charWords.size / Math.max(allDialogueWords.size, 1)) * 100);
}

function punctuationRates(lines: string[]) {
  const total = lines.length || 1;
  return {
    exclamationRate: Math.round((lines.filter((l) => l.includes("!")).length / total) * 100),
    questionRate: Math.round((lines.filter((l) => l.includes("?")).length / total) * 100),
    ellipsisRate: Math.round((lines.filter((l) => l.includes("...") || l.includes("…")).length / total) * 100),
  };
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Sentiment analysis (heuristic, keyword-based)
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = new Set([
  "love", "great", "good", "happy", "beautiful", "wonderful", "amazing", "fantastic",
  "brilliant", "perfect", "hope", "thank", "thanks", "please", "yes", "right",
  "best", "better", "glad", "nice", "fine", "well", "okay", "sure", "absolutely",
  "incredible", "excellent", "joy", "dream", "trust", "kind", "sweet", "proud",
]);

const NEGATIVE_WORDS = new Set([
  "hate", "bad", "terrible", "awful", "horrible", "never", "no", "not", "don't",
  "can't", "won't", "kill", "die", "dead", "death", "damn", "hell", "stop",
  "wrong", "worse", "worst", "afraid", "fear", "sorry", "hurt", "pain",
  "angry", "rage", "stupid", "fool", "shut", "liar", "lie", "betrayed", "lost",
]);

function computeSentiment(lines: string[]): CharacterSentiment {
  if (lines.length === 0) return { positive: 0, negative: 0, neutral: 100, label: "neutral" };

  let posCount = 0;
  let negCount = 0;
  let totalWords = 0;

  for (const line of lines) {
    const w = line.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    totalWords += w.length;
    for (const word of w) {
      if (POSITIVE_WORDS.has(word)) posCount++;
      if (NEGATIVE_WORDS.has(word)) negCount++;
    }
  }

  if (totalWords === 0) return { positive: 0, negative: 0, neutral: 100, label: "neutral" };

  const posRatio = posCount / totalWords;
  const negRatio = negCount / totalWords;
  const total = posRatio + negRatio || 1;

  const positive = Math.round((posRatio / total) * 100) || 0;
  const negative = Math.round((negRatio / total) * 100) || 0;
  const neutral = Math.max(0, 100 - positive - negative);

  let label: CharacterSentiment["label"];
  if (posRatio > negRatio * 1.5) label = "positive";
  else if (negRatio > posRatio * 1.5) label = "negative";
  else if (posCount + negCount < 2) label = "neutral";
  else label = "mixed";

  return { positive, negative, neutral, label };
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export function analyzeCharacters(parsed: FountainParseResult): CharacterProfile[] {
  const { elements, stats } = parsed;
  const dialogueByChar = getDialogueByCharacter(elements);
  const scenePresence = getSceneCharacters(elements);
  const totalDialogueLines = Array.from(dialogueByChar.values()).reduce((s, l) => s + l.length, 0);
  const allWords = new Set(
    Array.from(dialogueByChar.values())
      .flat()
      .flatMap(words)
  );

  const profiles: CharacterProfile[] = stats.uniqueCharacters.map((name) => {
    const lines = dialogueByChar.get(name) || [];
    const lineCount = lines.length;
    const avgLen = lineCount > 0 ? Math.round(lines.reduce((s, l) => s + l.length, 0) / lineCount) : 0;
    const shareRatio = totalDialogueLines > 0 ? Math.round((lineCount / totalDialogueLines) * 100) : 0;
    const scenes = scenePresence.get(name)?.size || 0;
    const lexical = lexicalUniquenessScore(lines, allWords);
    const repeated = findRepeatedPhrases(lines);
    const punct = punctuationRates(lines);

    // Distinctiveness: composite of lexical uniqueness, punctuation variance, avg line length deviation
    const punctVariance = (punct.exclamationRate + punct.questionRate + punct.ellipsisRate) / 3;
    const distinctiveness = Math.min(100, Math.round(lexical * 0.4 + punctVariance * 0.3 + Math.min(avgLen / 2, 30) * 0.3 + repeated.length * 2));

    return {
      name,
      dialogueLineCount: lineCount,
      dialogueShareRatio: shareRatio,
      scenePresenceCount: scenes,
      avgLineLength: avgLen,
      lexicalUniqueness: lexical,
      repeatedPhrases: repeated,
      punctuationStyle: punct,
      distinctivenessScore: distinctiveness,
      sentiment: computeSentiment(lines),
    };
  });

  return profiles.sort((a, b) => b.dialogueLineCount - a.dialogueLineCount);
}

export function computeVoiceMetrics(profiles: CharacterProfile[]): VoiceMetrics {
  if (profiles.length === 0) {
    return {
      characterCount: 0,
      avgDistinctiveness: 0,
      lowDistinctivenessFlags: [],
      dialogueBalance: 0,
      dominantCharacter: null,
      cadenceVariance: 0,
    };
  }

  const avgDist = Math.round(profiles.reduce((s, p) => s + p.distinctivenessScore, 0) / profiles.length);
  const lowFlags = profiles.filter((p) => p.distinctivenessScore < 20 && p.dialogueLineCount >= 3).map((p) => p.name);

  // Dialogue balance: how evenly distributed dialogue is (entropy-inspired)
  const totalLines = profiles.reduce((s, p) => s + p.dialogueLineCount, 0);
  const shares = profiles.map((p) => (totalLines > 0 ? p.dialogueLineCount / totalLines : 0));
  const idealShare = 1 / profiles.length;
  const deviation = shares.reduce((s, sh) => s + Math.abs(sh - idealShare), 0) / profiles.length;
  const balance = Math.round(Math.max(0, (1 - deviation * 2) * 100));

  const dominant = profiles[0]?.name || null;
  const cadence = stdDev(profiles.map((p) => p.avgLineLength));

  return {
    characterCount: profiles.length,
    avgDistinctiveness: avgDist,
    lowDistinctivenessFlags: lowFlags,
    dialogueBalance: balance,
    dominantCharacter: dominant,
    cadenceVariance: Math.round(cadence * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function distinctivenessLabel(score: number): string {
  if (score >= 60) return "Distinctive";
  if (score >= 35) return "Moderate";
  return "Low";
}

export function distinctivenessColor(score: number): string {
  if (score >= 60) return "text-emerald-500";
  if (score >= 35) return "text-amber-500";
  return "text-red-400";
}

export function balanceLabel(score: number): string {
  if (score >= 70) return "Balanced";
  if (score >= 40) return "Skewed";
  return "Dominated";
}

export function balanceColor(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-400";
}
