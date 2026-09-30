import { Film, Tv, FileText, Clapperboard, ScrollText, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ICON_MAP: Record<string, LucideIcon> = {
  film: Film,
  tv: Tv,
  "file-text": FileText,
  clapperboard: Clapperboard,
  "scroll-text": ScrollText,
  sparkles: Sparkles,
};

export const ICON_KEYS = Object.keys(ICON_MAP);
