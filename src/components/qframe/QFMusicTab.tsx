import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";

interface Section {
  id: string;
  project_id: string;
  name: string;
  ordinal: number;
  start_sec: number;
  end_sec: number;
  energy: number | null;
  emotion: string | null;
  visual_mode: string | null;
  lyric_excerpt: string | null;
}

export function QFMusicTab({ projectId }: { projectId: string }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("qframe_music_sections")
      .select("*")
      .eq("project_id", projectId)
      .order("ordinal");
    setSections((data ?? []) as Section[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [projectId]);

  const addRow = async () => {
    const ordinal = sections.length ? Math.max(...sections.map(s => s.ordinal)) + 1 : 0;
    const last = sections[sections.length - 1];
    const start = last ? Number(last.end_sec) : 0;
    const { data, error } = await supabase
      .from("qframe_music_sections")
      .insert({ project_id: projectId, name: "section", ordinal, start_sec: start, end_sec: start + 10 })
      .select().single();
    if (error) toast.error(error.message); else setSections(prev => [...prev, data as Section]);
  };

  const update = async (id: string, patch: Partial<Section>) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } as Section : s));
    await supabase.from("qframe_music_sections").update(patch).eq("id", id);
  };

  const del = async (id: string) => {
    await supabase.from("qframe_music_sections").delete().eq("id", id);
    setSections(prev => prev.filter(s => s.id !== id));
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const { error } = await supabase.functions.invoke("qframe-analyze-music", { body: { project_id: projectId } });
      if (error) throw error;
      toast.success("Music analyzed");
      await load();
    } catch (e: any) { toast.error(e.message ?? "Analyze failed"); }
    finally { setAnalyzing(false); }
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>;

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define song sections — they are the spine of the shot list. Upload an audio asset on the Assets tab, then run analyze.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={analyze} disabled={analyzing} className="gap-2">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/>}
            AI analyze
          </Button>
          <Button onClick={addRow} className="gap-2"><Plus className="h-4 w-4"/> Section</Button>
        </div>
      </div>

      {sections.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No sections yet.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {sections.map(s => (
            <Card key={s.id}>
              <CardContent className="p-3 grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-2" value={s.name} onChange={e => update(s.id, { name: e.target.value })} placeholder="name"/>
                <Input className="col-span-1" type="number" step="0.1" value={s.start_sec} onChange={e => update(s.id, { start_sec: Number(e.target.value) })} />
                <Input className="col-span-1" type="number" step="0.1" value={s.end_sec} onChange={e => update(s.id, { end_sec: Number(e.target.value) })} />
                <Input className="col-span-1" type="number" step="0.01" min="0" max="1" value={s.energy ?? ""} onChange={e => update(s.id, { energy: e.target.value === "" ? null : Number(e.target.value) })} placeholder="energy"/>
                <Input className="col-span-2" value={s.emotion ?? ""} onChange={e => update(s.id, { emotion: e.target.value })} placeholder="emotion"/>
                <Input className="col-span-2" value={s.visual_mode ?? ""} onChange={e => update(s.id, { visual_mode: e.target.value })} placeholder="visual mode"/>
                <Input className="col-span-2" value={s.lyric_excerpt ?? ""} onChange={e => update(s.id, { lyric_excerpt: e.target.value })} placeholder="lyric"/>
                <Button size="sm" variant="ghost" className="col-span-1 h-8 w-8 p-0" onClick={() => del(s.id)}><Trash2 className="h-4 w-4"/></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
