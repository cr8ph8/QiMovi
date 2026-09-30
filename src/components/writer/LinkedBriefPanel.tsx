import { useEffect, useState } from "react";
import { Link2, Unlink, Loader2, Sparkles, BookOpen, ListPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

type BriefRow = {
  id: string;
  title: string | null;
  organized: OrganizedBrief | null;
};

const NONE = "__none__";

export function LinkedBriefPanel({
  briefId,
  onLink,
  onInsertScaffold,
  userId,
}: {
  briefId: string | null;
  onLink: (id: string | null) => void;
  onInsertScaffold: (text: string) => void;
  userId: string;
}) {
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [current, setCurrent] = useState<BriefRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("project_briefs")
      .select("id, title, organized")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setBriefs(data as BriefRow[]);
      });
  }, [userId]);

  useEffect(() => {
    if (!briefId) {
      setCurrent(null);
      return;
    }
    setLoading(true);
    supabase
      .from("project_briefs")
      .select("id, title, organized")
      .eq("id", briefId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCurrent(data as BriefRow);
        setLoading(false);
      });
  }, [briefId]);

  const insertBeats = () => {
    const beats = current?.organized?.plot_beats ?? [];
    if (beats.length === 0) {
      toast.error("This brief has no plot beats.");
      return;
    }
    const text = beats
      .map((b, i) => {
        const heading = `INT. SCENE ${i + 1} - DAY`;
        const note = `[[ ${b.beat_name}: ${b.description} ]]`;
        return `${heading}\n\n${note}\n`;
      })
      .join("\n");
    onInsertScaffold(text);
    toast.success(`Inserted ${beats.length} beat scaffolds.`);
  };

  const seedDraft = async () => {
    if (!current) return;
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    toast.message("Generating draft from brief — this may take ~20 seconds…");
    const { data, error } = await supabase.functions.invoke("seed-screenplay-draft", {
      body: { brief_id: current.id },
    });
    if (error) {
      toast.error(error.message || "Generation failed.");
      return;
    }
    if ((data as { error?: string })?.error) {
      toast.error((data as { error: string }).error);
      return;
    }
    const newId = (data as { draft_id: string }).draft_id;
    if (newId) {
      toast.success("Draft generated.");
      window.location.href = `/write?draft=${newId}`;
    }
  };

  if (!briefId) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <BookOpen className="h-4 w-4" /> Link a Brief
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <Select onValueChange={(v) => onLink(v === NONE ? null : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a brain dump brief…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {briefs.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.title || "Untitled"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Linking a brief lets AI seed a draft, gives you a reference panel, and pushes detected
            characters back to the brief on save.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading || !current) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="animate-spin h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const o = current.organized ?? {};

  return (
    <Card>
      <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" /> Linked Brief
        </CardTitle>
        <Button size="icon" variant="ghost" className="h-6 w-6" title="Unlink"
          onClick={() => onLink(null)}>
          <Unlink className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <div className="font-semibold text-sm">{current.title || "Untitled brief"}</div>
        {o.logline && (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Logline</div>
            <p className="mt-0.5 leading-snug">{o.logline}</p>
          </div>
        )}
        {o.characters?.length ? (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Characters</div>
            <div className="flex flex-wrap gap-1">
              {o.characters.slice(0, 8).map((c, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">{c.name}</Badge>
              ))}
            </div>
          </div>
        ) : null}
        {o.plot_beats?.length ? (
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">
              Beats ({o.plot_beats.length})
            </div>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {o.plot_beats.map((b, i) => (
                <li key={i} className="border-l-2 border-primary/40 pl-2">
                  <span className="font-medium">{b.beat_name}</span>
                  <p className="text-muted-foreground text-[11px]">{b.description}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="pt-2 flex flex-col gap-1.5 border-t border-border/30">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={insertBeats}>
            <ListPlus className="h-3 w-3" /> Insert beats as scenes
          </Button>
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={seedDraft}
            disabled={PAID_AI_SECURITY_HOLD}
            title={PAID_AI_SECURITY_HOLD ? PAID_AI_SECURITY_MESSAGE : undefined}
          >
            <Sparkles className="h-3 w-3" /> Regenerate from brief
          </Button>
          {PAID_AI_SECURITY_HOLD && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              AI draft generation is temporarily paused. No tokens will be charged.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
