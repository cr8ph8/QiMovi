import { Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { charSimilarity } from "@/lib/similarity";

interface AiFieldBadgeProps {
  fieldName: string;
  currentValue: string;
  originalAiValue: string;
  isAi: boolean;
  onToggle: (fieldName: string, isAi: boolean) => void;
}

export default function AiFieldBadge({ fieldName, currentValue, originalAiValue, isAi, onToggle }: AiFieldBadgeProps) {
  const { toast } = useToast();

  if (!originalAiValue) return null;

  const similarity = Math.round(charSimilarity(currentValue, originalAiValue) * 100);

  function handleClick() {
    if (isAi) {
      // Trying to remove AI attribution
      if (similarity >= 50) {
        toast({
          title: "Still AI-generated",
          description: `This field is ${similarity}% similar to the AI suggestion. It will still be tracked as AI-sourced.`,
          variant: "destructive",
        });
        return;
      }
      onToggle(fieldName, false);
    } else {
      onToggle(fieldName, true);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
        isAi
          ? "bg-primary/15 text-primary hover:bg-primary/25"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
      title={`AI similarity: ${similarity}%`}
    >
      <Sparkles className="h-3 w-3" />
      {isAi ? "AI" : "AI off"}
      {isAi && <span className="opacity-60">{similarity}%</span>}
    </button>
  );
}
