import { useState } from "react";
import { Diamond, Sparkles, Pencil, Loader2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface CharacterDiamondData {
  north_star: string | null;
  counter_star: string | null;
  flaw_mask: string | null;
  non_negotiable: string | null;
  source?: string;
}

interface CharacterDiamondProps {
  entryId?: string;
  characterName: string;
  diamond: CharacterDiamondData | null;
  dialogueLines: string[];
  sceneContext?: string;
  canEdit: boolean;
  onChange: (next: CharacterDiamondData | null) => void;
}

const CORNERS: Array<{
  key: keyof Omit<CharacterDiamondData, "source">;
  label: string;
  hint: string;
}> = [
  { key: "north_star", label: "North Star", hint: "Dominant identity in one sharp sentence." },
  { key: "counter_star", label: "Counter-Star", hint: "Trait that pulls against the North Star." },
  { key: "flaw_mask", label: "Flaw / Mask", hint: "How they distort under pressure." },
  { key: "non_negotiable", label: "Non-Negotiable", hint: "The line they will not cross." },
];

const MAX_LEN = 140;

function isEmpty(d: CharacterDiamondData | null): boolean {
  if (!d) return true;
  return !d.north_star && !d.counter_star && !d.flaw_mask && !d.non_negotiable;
}

export default function CharacterDiamond({
  entryId,
  characterName,
  diamond,
  dialogueLines,
  sceneContext,
  canEdit,
  onChange,
}: CharacterDiamondProps) {
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CharacterDiamondData>({
    north_star: diamond?.north_star ?? "",
    counter_star: diamond?.counter_star ?? "",
    flaw_mask: diamond?.flaw_mask ?? "",
    non_negotiable: diamond?.non_negotiable ?? "",
  });

  const openEditor = () => {
    setDraft({
      north_star: diamond?.north_star ?? "",
      counter_star: diamond?.counter_star ?? "",
      flaw_mask: diamond?.flaw_mask ?? "",
      non_negotiable: diamond?.non_negotiable ?? "",
    });
    setEditing(true);
  };

  const persist = async (next: CharacterDiamondData, source: string) => {
    if (!entryId) return;
    const payload = {
      entry_id: entryId,
      character_name: characterName,
      north_star: next.north_star || null,
      counter_star: next.counter_star || null,
      flaw_mask: next.flaw_mask || null,
      non_negotiable: next.non_negotiable || null,
      source,
    };
    const { error } = await supabase
      .from("character_diamonds" as any)
      .upsert(payload, { onConflict: "entry_id,character_name" });
    if (error) throw error;
    onChange({ ...next, source });
  };

  const handleGenerate = async () => {
    if (!entryId) {
      toast.error("Save the screenplay first to generate diamonds.");
      return;
    }
    if (dialogueLines.length < 2) {
      toast.error("Not enough dialogue to draft a diamond.");
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-character-diamond", {
        body: {
          entry_id: entryId,
          character_name: characterName,
          dialogue_lines: dialogueLines.slice(0, 60),
          scene_context: sceneContext ?? "",
        },
      });
      if (error) throw error;
      const d = data?.diamond;
      if (!d) throw new Error("No diamond returned");
      await persist(
        {
          north_star: d.north_star ?? "",
          counter_star: d.counter_star ?? "",
          flaw_mask: d.flaw_mask ?? "",
          non_negotiable: d.non_negotiable ?? "",
        },
        diamond && !isEmpty(diamond) ? "hybrid" : "ai",
      );
      toast.success(`Diamond drafted for ${characterName}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate diamond");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await persist(
        {
          north_star: (draft.north_star || "").slice(0, MAX_LEN),
          counter_star: (draft.counter_star || "").slice(0, MAX_LEN),
          flaw_mask: (draft.flaw_mask || "").slice(0, MAX_LEN),
          non_negotiable: (draft.non_negotiable || "").slice(0, MAX_LEN),
        },
        diamond?.source === "ai" ? "hybrid" : "manual",
      );
      toast.success("Diamond saved");
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const empty = isEmpty(diamond);

  return (
    <div className="rounded-md border border-border/40 bg-muted/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Diamond className="h-3 w-3 text-primary" />
          <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-foreground">
            Character Diamond
          </span>
          {diamond?.source && !empty && (
            <span className="text-[8px] font-mono uppercase text-muted-foreground">
              · {diamond.source}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[9px] font-mono"
              onClick={handleGenerate}
              disabled={generating || !entryId}
              title={entryId ? "Draft with AI" : "Save screenplay first"}
            >
              {generating ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Sparkles className="h-2.5 w-2.5" />
              )}
              <span className="ml-1">{empty ? "Generate" : "Redraft"}</span>
            </Button>

            <Popover open={editing} onOpenChange={(o) => (o ? openEditor() : setEditing(false))}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[9px] font-mono"
                  disabled={!entryId}
                >
                  <Pencil className="h-2.5 w-2.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3 space-y-2" align="end">
                <p className="text-[10px] font-mono font-bold uppercase text-foreground">
                  Edit Diamond — {characterName}
                </p>
                {CORNERS.map((c) => (
                  <div key={c.key} className="space-y-1">
                    <label className="text-[9px] font-mono uppercase text-muted-foreground">
                      {c.label}
                    </label>
                    <Textarea
                      value={draft[c.key] ?? ""}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [c.key]: e.target.value.slice(0, MAX_LEN) }))
                      }
                      placeholder={c.hint}
                      rows={2}
                      className="text-[10px] font-mono resize-none"
                    />
                    <p className="text-[8px] font-mono text-muted-foreground text-right">
                      {(draft[c.key] ?? "").length}/{MAX_LEN}
                    </p>
                  </div>
                ))}
                <div className="flex justify-end gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[9px] font-mono"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    <X className="h-2.5 w-2.5 mr-1" /> Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-6 text-[9px] font-mono"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                    ) : (
                      <Check className="h-2.5 w-2.5 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {empty ? (
        <p className="text-[9px] font-mono text-muted-foreground italic py-2 text-center">
          {canEdit
            ? "Draft a diamond to define this character's identity, contradiction, flaw, and sacred line."
            : "No diamond yet."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {CORNERS.map((c) => {
            const v = diamond?.[c.key];
            return (
              <div
                key={c.key}
                className={cn(
                  "rounded border border-border/30 bg-card/50 p-1.5 space-y-0.5",
                  !v && "opacity-50",
                )}
              >
                <p className="text-[8px] font-mono uppercase tracking-wider text-primary">
                  {c.label}
                </p>
                <p className="text-[10px] font-mono text-foreground leading-snug">
                  {v || <span className="italic text-muted-foreground">—</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
