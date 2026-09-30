/**
 * FranchiseSummary — Narrative prose summary + compact stats + theme tags.
 * Stripped of comparison table, genre bar, arc labels, and installment timeline
 * (all replaced by the FranchiseTimeline component).
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { FileText, Users, TrendingUp, BookOpen } from "lucide-react";

interface InstallmentData {
  title: string;
  genre: string | null;
  status: string;
  pageCount: number | null;
  createdAt: string;
  characterCount: number;
  logline?: string | null;
}

interface Props {
  universeName: string;
  description?: string;
  installments: InstallmentData[];
}

// Theme keywords grouped by narrative category
const THEME_KEYWORDS: Record<string, string[]> = {
  "Survival": ["survive", "survival", "alive", "escape", "trapped", "danger", "rescue", "chase"],
  "Identity": ["identity", "who am i", "self", "memory", "forgotten", "remember", "past", "truth"],
  "Power": ["power", "control", "rule", "king", "queen", "throne", "empire", "authority", "corrupt"],
  "Love": ["love", "heart", "romance", "relationship", "affair", "marriage", "desire", "passion"],
  "Revenge": ["revenge", "vengeance", "payback", "retribution", "avenge", "betrayal", "betrayed"],
  "Redemption": ["redemption", "forgive", "second chance", "atone", "guilt", "repent", "save"],
  "Family": ["family", "father", "mother", "son", "daughter", "brother", "sister", "child", "parent"],
  "Technology": ["ai", "artificial", "robot", "machine", "tech", "computer", "digital", "cyber", "hack"],
  "War": ["war", "battle", "soldier", "army", "fight", "conflict", "military", "weapon"],
  "Discovery": ["discover", "explore", "journey", "quest", "search", "find", "mystery", "secret"],
  "Post-Apocalyptic": ["apocalypse", "apocalyptic", "wasteland", "ruins", "aftermath", "collapse"],
  "Supernatural": ["ghost", "spirit", "haunt", "curse", "magic", "witch", "demon", "supernatural"],
};

function extractThemes(installments: InstallmentData[]): { theme: string; score: number }[] {
  const text = installments
    .map((i) => [i.logline, i.title, i.genre].filter(Boolean).join(" "))
    .join(" ")
    .toLowerCase();

  const scores: { theme: string; score: number }[] = [];
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    let count = 0;
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, "gi");
      const matches = text.match(regex);
      if (matches) count += matches.length;
    }
    if (count > 0) scores.push({ theme, score: count });
  }
  return scores.sort((a, b) => b.score - a.score).slice(0, 5);
}

function buildNarrativeProse(universeName: string, installments: InstallmentData[]): string {
  const withLoglines = installments.filter((i) => i.logline);

  if (withLoglines.length === 0) {
    const genres = [...new Set(installments.map((i) => i.genre).filter(Boolean))];
    const genreStr = genres.length > 0 ? genres.join("/").toLowerCase() : "multi-genre";
    return `${universeName} is a ${installments.length}-installment ${genreStr} franchise. Add loglines to your entries to generate a narrative summary.`;
  }

  const parts: string[] = [];

  if (withLoglines.length === 1) {
    parts.push(`${universeName} begins with "${withLoglines[0].title}" — ${withLoglines[0].logline}`);
  } else {
    parts.push(`${universeName} opens with "${withLoglines[0].title}" — ${withLoglines[0].logline}`);

    const middle = withLoglines.slice(1, -1);
    for (const inst of middle) {
      parts.push(`The story continues in "${inst.title}" where ${inst.logline?.charAt(0).toLowerCase()}${inst.logline?.slice(1) ?? ""}`);
    }

    const last = withLoglines[withLoglines.length - 1];
    const connector = withLoglines.length === 2 ? "It evolves into" : "The franchise culminates with";
    parts.push(`${connector} "${last.title}" — ${last.logline}`);
  }

  return parts.join(" ");
}

export default function FranchiseSummary({ universeName, description, installments }: Props) {
  const themes = useMemo(() => extractThemes(installments), [installments]);
  const prose = useMemo(() => buildNarrativeProse(universeName, installments), [universeName, installments]);

  const totalPages = installments.reduce((s, i) => s + (i.pageCount ?? 0), 0);
  const totalChars = installments.reduce((s, i) => s + i.characterCount, 0);
  const scored = installments.filter((i) => i.status === "scored").length;

  if (installments.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Add installments to generate a franchise summary.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Narrative prose */}
      <p className="text-sm text-foreground leading-relaxed">{prose}</p>
      {description && (
        <p className="text-xs text-muted-foreground italic">{description}</p>
      )}

      {/* Compact stat row + theme tags inline */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-mono gap-1">
          <FileText className="h-3 w-3" /> {installments.length} scripts
        </Badge>
        {totalPages > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono gap-1">
            {totalPages} pages
          </Badge>
        )}
        {totalChars > 0 && (
          <Badge variant="outline" className="text-[10px] font-mono gap-1">
            <Users className="h-3 w-3" /> {totalChars} characters
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px] font-mono gap-1">
          <TrendingUp className="h-3 w-3" /> {scored}/{installments.length} scored
        </Badge>

        {/* Theme tags inline */}
        {themes.length > 0 && (
          <>
            <span className="text-muted-foreground/40 mx-1">|</span>
            <BookOpen className="h-3 w-3 text-muted-foreground" />
            {themes.map((t) => (
              <Badge key={t.theme} variant="secondary" className="text-[10px] font-mono">
                {t.theme}
              </Badge>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
