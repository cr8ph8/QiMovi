import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Sparkles, Plus, Trash2 } from "lucide-react";

interface Bible {
  project_id: string;
  core_theme: string | null;
  visual_question: string | null;
  color_arc: Record<string, string>;
  perspective_arc: Record<string, string>;
  notes: string | null;
}

interface Symbol {
  id: string;
  project_id: string;
  symbol: string;
  meaning: string | null;
  evolution: string[];
  must_appear_in: string[];
}

const DEFAULT_SECTIONS = ["intro","verse","chorus","bridge","finale"];

export function QFBibleTab({ projectId }: { projectId: string }) {
  const [bible, setBible] = useState<Bible | null>(null);
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);

  const load = async () => {
    const [b, s] = await Promise.all([
      supabase.from("qframe_visual_bible").select("*").eq("project_id", projectId).maybeSingle(),
      supabase.from("qframe_symbols").select("*").eq("project_id", projectId).order("created_at"),
    ]);
    if (b.data) setBible(b.data as Bible);
    else setBible({ project_id: projectId, core_theme: "", visual_question: "", color_arc: {}, perspective_arc: {}, notes: "" });
    setSymbols((s.data ?? []) as Symbol[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [projectId]);

  const save = async (patch: Partial<Bible>) => {
    if (!bible) return;
    const next = { ...bible, ...patch };
    setBible(next);
    await supabase.from("qframe_visual_bible").upsert(next);
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const { error } = await supabase.functions.invoke("qframe-draft-bible", { body: { project_id: projectId } });
      if (error) throw error;
      toast.success("Bible drafted by AI — review and edit");
      await load();
    } catch (e: any) { toast.error(e.message ?? "Draft failed"); }
    finally { setDrafting(false); }
  };

  const addSymbol = async () => {
    const { data } = await supabase.from("qframe_symbols").insert({ project_id: projectId, symbol: "new symbol" }).select().single();
    if (data) setSymbols(prev => [...prev, data as Symbol]);
  };

  const updateSymbol = async (id: string, patch: Partial<Symbol>) => {
    setSymbols(prev => prev.map(s => s.id === id ? { ...s, ...patch } as Symbol : s));
    await supabase.from("qframe_symbols").update(patch).eq("id", id);
  };

  const delSymbol = async (id: string) => {
    await supabase.from("qframe_symbols").delete().eq("id", id);
    setSymbols(prev => prev.filter(s => s.id !== id));
  };

  if (loading || !bible) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>;

  return (
    <div className="space-y-6 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="font-display text-xl">Visual Story Bible</h3>
          <p className="text-sm text-muted-foreground">The symbolic system the video runs on. Without it, video models drift into pretty nonsense.</p>
        </div>
        <Button onClick={draft} disabled={drafting} variant="outline" className="gap-2">
          {drafting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/>}
          AI draft
        </Button>
      </div>

      <Card><CardContent className="p-4 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Core theme</label>
          <Textarea rows={2} value={bible.core_theme ?? ""} onChange={e => save({ core_theme: e.target.value })}/>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Visual question</label>
          <Textarea rows={2} value={bible.visual_question ?? ""} onChange={e => save({ visual_question: e.target.value })}/>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <h4 className="font-medium">Color arc</h4>
        {DEFAULT_SECTIONS.map(k => (
          <div key={k} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-16">{k}</span>
            <Input value={bible.color_arc[k] ?? ""} onChange={e => save({ color_arc: { ...bible.color_arc, [k]: e.target.value } })} placeholder="e.g. cold blue"/>
          </div>
        ))}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <h4 className="font-medium">Perspective arc</h4>
        {DEFAULT_SECTIONS.map(k => (
          <div key={k} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-16">{k}</span>
            <Input value={bible.perspective_arc[k] ?? ""} onChange={e => save({ perspective_arc: { ...bible.perspective_arc, [k]: e.target.value } })} placeholder="e.g. 1-point"/>
          </div>
        ))}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Symbols</h4>
          <Button size="sm" variant="outline" onClick={addSymbol} className="gap-1"><Plus className="h-3 w-3"/> Symbol</Button>
        </div>
        {symbols.length === 0 ? (
          <p className="text-sm text-muted-foreground">No symbols defined.</p>
        ) : symbols.map(sym => (
          <Card key={sym.id} className="bg-muted/30">
            <CardContent className="p-3 space-y-2">
              <div className="flex gap-2">
                <Input value={sym.symbol} onChange={e => updateSymbol(sym.id, { symbol: e.target.value })} placeholder="symbol"/>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => delSymbol(sym.id)}><Trash2 className="h-4 w-4"/></Button>
              </div>
              <Input value={sym.meaning ?? ""} onChange={e => updateSymbol(sym.id, { meaning: e.target.value })} placeholder="meaning"/>
              <Input value={sym.evolution.join(" → ")} onChange={e => updateSymbol(sym.id, { evolution: e.target.value.split("→").map(x => x.trim()).filter(Boolean) })} placeholder="evolution: loose → tangled → glowing → stitched"/>
              <Input value={sym.must_appear_in.join(", ")} onChange={e => updateSymbol(sym.id, { must_appear_in: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} placeholder="must appear in: intro, chorus, finale"/>
            </CardContent>
          </Card>
        ))}
      </CardContent></Card>
    </div>
  );
}
