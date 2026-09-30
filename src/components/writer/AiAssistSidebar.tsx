import { useState, useCallback } from "react";
import { Loader2, Sparkles, Wand2, ShieldCheck, MessagesSquare, Copy, ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Action = "suggest_rewrites" | "continuity_check" | "alternative_dialogue";

interface AiAssistSidebarProps {
  draftId: string | null;
  fullScript: string;
  /** Returns {selection, sceneContext} from the current editor caret */
  getContext: () => { selection: string; sceneContext: string };
  onInsert: (text: string) => void;
}

const ACTIONS: { id: Action; label: string; icon: typeof Wand2; hint: string }[] = [
  { id: "suggest_rewrites", label: "Suggest Rewrites", icon: Wand2, hint: "3 concrete fixes for the current scene/selection." },
  { id: "continuity_check", label: "Continuity Check", icon: ShieldCheck, hint: "Find inconsistencies across the script." },
  { id: "alternative_dialogue", label: "Alt Dialogue", icon: MessagesSquare, hint: "3 alternative dialogue takes for the selection." },
];

export function AiAssistSidebar({ draftId, fullScript, getContext, onInsert }: AiAssistSidebarProps) {
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [loading, setLoading] = useState<Action | null>(null);
  const [result, setResult] = useState<string>("");
  const [modelUsed, setModelUsed] = useState<string>("");

  const run = useCallback(async (action: Action) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    const { selection, sceneContext } = getContext();
    if (action === "alternative_dialogue" && !selection.trim()) {
      toast.error("Select the dialogue you want alternatives for.");
      return;
    }
    if (action !== "continuity_check" && !selection.trim() && !sceneContext.trim() && !fullScript.trim()) {
      toast.error("Nothing to analyze yet — write a scene first.");
      return;
    }

    setActiveAction(action);
    setLoading(action);
    setResult("");
    try {
      const { data, error } = await supabase.functions.invoke("screenplay-assist", {
        body: {
          action,
          selection,
          scene_context: sceneContext,
          full_script: fullScript,
          draft_id: draftId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data?.result || "");
      setModelUsed(data?.model_used || "");
    } catch (e: any) {
      toast.error(e?.message || "AI assist failed");
    } finally {
      setLoading(null);
    }
  }, [getContext, fullScript, draftId]);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> AI Assist
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-1 gap-1.5">
          {ACTIONS.map(({ id, label, icon: Icon, hint }) => {
            const isLoading = loading === id;
            const isActive = activeAction === id;
            return (
              <Button
                key={id}
                size="sm"
                variant={isActive ? "default" : "outline"}
                className={cn("h-auto py-2 justify-start text-left", isActive && "ring-1 ring-primary/40")}
                disabled={PAID_AI_SECURITY_HOLD || loading !== null}
                onClick={() => run(id)}
              >
                <div className="flex items-start gap-2 w-full">
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mt-0.5 shrink-0" />
                  ) : (
                    <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px] text-muted-foreground leading-snug">{hint}</div>
                  </div>
                </div>
              </Button>
            );
          })}
        </div>

        {result && (
          <div className="rounded-md border border-border/40 bg-background/60">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/30">
              <Badge variant="secondary" className="text-[9px] font-mono">
                {ACTIONS.find((a) => a.id === activeAction)?.label}
              </Badge>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    navigator.clipboard.writeText(result);
                    toast.success("Copied");
                  }}
                  title="Copy"
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => {
                    onInsert(result);
                    toast.success("Inserted at cursor");
                  }}
                  title="Insert at cursor"
                >
                  <ArrowDownToLine className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[260px]">
              <pre className="whitespace-pre-wrap break-words text-[11px] font-mono leading-relaxed px-2.5 py-2 text-foreground/90">
                {result}
              </pre>
            </ScrollArea>
            {modelUsed && (
              <div className="px-2 py-1 border-t border-border/30 text-[9px] font-mono text-muted-foreground">
                model: {modelUsed}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground leading-snug">
          Tip: select text in the editor before running for selection-scoped suggestions. Otherwise the current scene is used.
        </p>
      </CardContent>
    </Card>
  );
}
