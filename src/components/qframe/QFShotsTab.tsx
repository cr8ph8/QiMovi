import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Trash2, Wand2, AlertTriangle } from "lucide-react";

const PERSPECTIVES = ["1-point","2-point","3-point","4-point","5-point","infinity-point","macro/flat"];

interface Shot {
  id: string;
  project_id: string;
  ordinal: number;
  section_id: string | null;
  time_start_sec: number | null;
  time_end_sec: number | null;
  narrative_function: string | null;
  perspective_mode: string | null;
  camera: any;
  motion_prompt: string | null;
  visual_prompt: string | null;
  negative_prompt: string | null;
  continuity_rules: string[];
  status: string;
  lint_warnings: any[];
}

interface Section { id: string; name: string; ordinal: number; }

export function QFShotsTab({ projectId }: { projectId: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [editing, setEditing] = useState<Shot | null>(null);
  const [compilingId, setCompilingId] = useState<string | null>(null);

  const load = async () => {
    const [s, sec] = await Promise.all([
      supabase.from("qframe_shots").select("*").eq("project_id", projectId).order("ordinal"),
      supabase.from("qframe_music_sections").select("id, name, ordinal").eq("project_id", projectId).order("ordinal"),
    ]);
    setShots((s.data ?? []) as Shot[]);
    setSections((sec.data ?? []) as Section[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [projectId]);

  const add = async () => {
    const ordinal = shots.length ? Math.max(...shots.map(s => s.ordinal)) + 1 : 0;
    const { data, error } = await supabase.from("qframe_shots").insert({ project_id: projectId, ordinal }).select().single();
    if (error) toast.error(error.message); else { setShots(prev => [...prev, data as Shot]); setEditing(data as Shot); }
  };
  const update = async (id: string, patch: Partial<Shot>) => {
    setShots(prev => prev.map(s => s.id === id ? { ...s, ...patch } as Shot : s));
    if (editing?.id === id) setEditing({ ...editing, ...patch } as Shot);
    await supabase.from("qframe_shots").update(patch as any).eq("id", id);
  };
  const del = async (id: string) => {
    await supabase.from("qframe_shots").delete().eq("id", id);
    setShots(prev => prev.filter(s => s.id !== id));
  };
  const suggest = async () => {
    setSuggesting(true);
    try {
      const { error } = await supabase.functions.invoke("qframe-suggest-shots", { body: { project_id: projectId } });
      if (error) throw error;
      toast.success("Shot list drafted");
      await load();
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setSuggesting(false); }
  };
  const compile = async (id: string) => {
    setCompilingId(id);
    try {
      const { error } = await supabase.functions.invoke("qframe-compile-packet", { body: { shot_id: id } });
      if (error) throw error;
      toast.success("Packet compiled");
      await load();
    } catch (e: any) { toast.error(e.message ?? "Compile failed"); }
    finally { setCompilingId(null); }
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>;

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="font-display text-xl">Shot list</h3>
          <p className="text-sm text-muted-foreground">Command center. Each row becomes an AI-generation-ready packet.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={suggest} disabled={suggesting} className="gap-2">
            {suggesting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Sparkles className="h-4 w-4"/>} AI suggest
          </Button>
          <Button onClick={add} className="gap-2"><Plus className="h-4 w-4"/> Shot</Button>
        </div>
      </div>

      {shots.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No shots yet.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {shots.map(s => (
            <Card key={s.id} className="hover:border-primary cursor-pointer" onClick={() => setEditing(s)}>
              <CardContent className="p-3 flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground w-12">#{String(s.ordinal+1).padStart(3,"0")}</span>
                <span className="font-mono text-xs w-24">{s.time_start_sec?.toFixed(1) ?? "–"}s → {s.time_end_sec?.toFixed(1) ?? "–"}s</span>
                <Badge variant="outline" className="text-xs">{s.perspective_mode ?? "no perspective"}</Badge>
                <span className="text-sm flex-1 truncate">{s.narrative_function ?? <em className="text-muted-foreground">no function</em>}</span>
                {s.lint_warnings?.length > 0 && (
                  <Badge variant="destructive" className="gap-1 text-xs"><AlertTriangle className="h-3 w-3"/>{s.lint_warnings.length}</Badge>
                )}
                <Badge variant="secondary" className="text-xs capitalize">{s.status}</Badge>
                <Button size="sm" variant="ghost" className="h-8 px-2 gap-1" onClick={e => { e.stopPropagation(); compile(s.id); }} disabled={compilingId === s.id}>
                  {compilingId === s.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <Wand2 className="h-3 w-3"/>} Compile
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={e => { e.stopPropagation(); del(s.id); }}><Trash2 className="h-4 w-4"/></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {editing && (
            <>
              <DialogHeader><DialogTitle>Shot #{String(editing.ordinal+1).padStart(3,"0")}</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Section</label>
                    <Select value={editing.section_id ?? "none"} onValueChange={v => update(editing.id, { section_id: v === "none" ? null : v })}>
                      <SelectTrigger><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {sections.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Start (sec)</label>
                    <Input type="number" step="0.1" value={editing.time_start_sec ?? ""} onChange={e => update(editing.id, { time_start_sec: e.target.value === "" ? null : Number(e.target.value) })}/>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">End (sec)</label>
                    <Input type="number" step="0.1" value={editing.time_end_sec ?? ""} onChange={e => update(editing.id, { time_end_sec: e.target.value === "" ? null : Number(e.target.value) })}/>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Narrative function</label>
                  <Input value={editing.narrative_function ?? ""} onChange={e => update(editing.id, { narrative_function: e.target.value })}/>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Perspective mode</label>
                  <Select value={editing.perspective_mode ?? "none"} onValueChange={v => update(editing.id, { perspective_mode: v === "none" ? null : v })}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {PERSPECTIVES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Visual prompt</label>
                  <Textarea rows={4} value={editing.visual_prompt ?? ""} onChange={e => update(editing.id, { visual_prompt: e.target.value })}/>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Motion prompt</label>
                  <Textarea rows={2} value={editing.motion_prompt ?? ""} onChange={e => update(editing.id, { motion_prompt: e.target.value })}/>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Negative prompt</label>
                  <Textarea rows={2} value={editing.negative_prompt ?? ""} onChange={e => update(editing.id, { negative_prompt: e.target.value })}/>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Continuity rules (comma-separated)</label>
                  <Input value={editing.continuity_rules.join(", ")} onChange={e => update(editing.id, { continuity_rules: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })}/>
                </div>
                {editing.lint_warnings?.length > 0 && (
                  <Card className="border-destructive/50">
                    <CardContent className="p-3 space-y-1">
                      <p className="text-xs font-medium text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3"/> Lint warnings</p>
                      {editing.lint_warnings.map((w: any, i: number) => (
                        <p key={i} className="text-xs text-muted-foreground">• {typeof w === "string" ? w : w.message ?? JSON.stringify(w)}</p>
                      ))}
                    </CardContent>
                  </Card>
                )}
                <Button onClick={() => compile(editing.id)} disabled={compilingId === editing.id} className="w-full gap-2">
                  {compilingId === editing.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Wand2 className="h-4 w-4"/>}
                  Compile packet
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
