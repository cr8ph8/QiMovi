import { FountainStats } from "@/lib/fountain-parser";
import { FileText, Users, MessageSquare, Clapperboard, Type, Zap } from "lucide-react";

interface ScriptStatsCardProps {
  stats: FountainStats;
  onTabNavigate?: (tab: string) => void;
}

export default function ScriptStatsCard({ stats, onTabNavigate }: ScriptStatsCardProps) {
  const items = [
    { label: "Pages", value: stats.pageCount, icon: FileText, tab: "pages" },
    { label: "Scenes", value: stats.sceneCount, icon: Clapperboard, tab: "scenes" },
    { label: "Words", value: stats.wordCount.toLocaleString(), icon: Type, tab: "overview" },
    { label: "Characters", value: stats.uniqueCharacters.length, icon: Users, tab: "characters" },
    { label: "Dialogue", value: stats.dialogueBlockCount, icon: MessageSquare, tab: "dialogue" },
    { label: "Action", value: stats.actionLineCount, icon: Zap, tab: "action" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <button
          key={item.label}
          className="rounded-lg bg-muted/40 p-3 text-center hover:bg-primary/10 hover:ring-1 ring-primary/30 transition-all cursor-pointer"
          onClick={() => onTabNavigate?.(item.tab)}
        >
          <item.icon className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
          <p className="text-lg font-mono font-bold text-foreground">{item.value}</p>
          <p className="text-[10px] font-mono text-muted-foreground uppercase">{item.label}</p>
        </button>
      ))}
    </div>
  );
}
