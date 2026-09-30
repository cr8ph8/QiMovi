import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, X, ImagePlus, ImageIcon, CheckCircle2, AlertCircle } from "lucide-react";

type SlotKey = "sprite" | "pose" | "expression" | "lighting";

const SLOTS: { key: SlotKey; label: string; hint: string }[] = [
  { key: "sprite", label: "Sprite", hint: "Identity ref — front, 3/4, profile, full body" },
  { key: "pose", label: "Pose", hint: "Action / body language references" },
  { key: "expression", label: "Expression", hint: "Neutral, grief, rage, wonder…" },
  { key: "lighting", label: "Lighting", hint: "Key looks — day, neon, candle, backlit" },
];

const EMPTY_SLOTS: Record<SlotKey, string[]> = { sprite: [], pose: [], expression: [], lighting: [] };

interface Character {
  id: string;
  project_id: string;
  name: string;
  costume: string | null;
  forbidden_changes: string[];
  notes: string | null;
  reference_slots: Record<SlotKey, string[]>;
}

interface Asset {
  id: string;
  kind: string;
  storage_path: string;
  filename: string | null;
  subject: string | null;
  mood: string[];
}

function getCompleteness(slots: Record<SlotKey, string[]>) {
  const filled = SLOTS.filter(s => (slots[s.key] ?? []).length > 0).length;
  return { filled, total: SLOTS.length, pct: Math.round((filled / SLOTS.length) * 100) };
}

export function QFCharactersTab({ projectId }: { projectId: string }) {
  const [chars, setChars] = useState<Character[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState<{ charId: string; slot: SlotKey } | null>(null);

  const load = async () => {
    const [{ data: cData }, { data: aData }] = await Promise.all([
      supabase.from("qframe_characters").select("*").eq("project_id", projectId).order("created_at"),
      supabase.from("qframe_assets").select("id,kind,storage_path,filename,subject,mood").eq("project_id", projectId).in("kind", ["photo", "reference"]).order("created_at", { ascending: false }),
    ]);
    const normalized = (cData ?? []).map((c: any) => ({
      ...c,
      reference_slots: { ...EMPTY_SLOTS, ...(c.reference_slots ?? {}) },
    })) as Character[];
    setChars(normalized);
    setAssets((aData ?? []) as Asset[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [projectId]);

  useEffect(() => {
    (async () => {
      const next: Record<string, string> = { ...urls };
      for (const a of assets) {
        if (next[a.id]) continue;
        const { data } = await supabase.storage.from("qframe-assets").createSignedUrl(a.storage_path, 3600);
        if (data?.signedUrl) next[a.id] = data.signedUrl;
      }
      setUrls(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  const assetById = useMemo(() => Object.fromEntries(assets.map(a => [a.id, a])), [assets]);

  const add = async () => {
    const { data, error } = await supabase
      .from("qframe_characters")
      .insert({ project_id: projectId, name: "New character", reference_slots: EMPTY_SLOTS })
      .select()
      .single();
    if (error) toast.error(error.message);
    else setChars(prev => [...prev, { ...(data as any), reference_slots: { ...EMPTY_SLOTS, ...((data as any).reference_slots ?? {}) } }]);
  };

  const update = async (id: string, patch: Partial<Character>) => {
    setChars(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    const { error } = await supabase.from("qframe_characters").update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const del = async (id: string) => {
    if (!confirm("Delete this character?")) return;
    await supabase.from("qframe_characters").delete().eq("id", id);
    setChars(prev => prev.filter(c => c.id !== id));
  };

  const assignToSlot = async (charId: string, slot: SlotKey, assetId: string) => {
    const c = chars.find(x => x.id === charId);
    if (!c) return;
    if (c.reference_slots[slot].includes(assetId)) return;
    const nextSlots = { ...c.reference_slots, [slot]: [...c.reference_slots[slot], assetId] };
    await update(charId, { reference_slots: nextSlots });
    setPicker(null);
  };

  const removeFromSlot = async (charId: string, slot: SlotKey, assetId: string) => {
    const c = chars.find(x => x.id === charId);
    if (!c) return;
    const nextSlots = { ...c.reference_slots, [slot]: c.reference_slots[slot].filter(id => id !== assetId) };
    await update(charId, { reference_slots: nextSlots });
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>;

  return (
    <div className="space-y-6 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="font-display text-xl">Character Atlas</h3>
          <p className="text-sm text-muted-foreground">Identity records the continuity ledger enforces on every shot packet.</p>
        </div>
        <Button onClick={add} className="gap-2"><Plus className="h-4 w-4"/> Character</Button>
      </div>

      {chars.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No characters yet. Add the main character first — most shots will require their reference.</CardContent></Card>
      ) : chars.map(c => (
        <Card key={c.id}>
          <CardContent className="p-4 space-y-4">
            <div className="flex gap-2">
              <Input value={c.name} onChange={e => update(c.id, { name: e.target.value })} placeholder="name" className="font-display text-lg"/>
              <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => del(c.id)}><Trash2 className="h-4 w-4"/></Button>
            </div>
            {(() => {
              const comp = getCompleteness(c.reference_slots);
              return (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="space-y-1 cursor-help">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Atlas completeness</span>
                          <span className="font-medium">{comp.filled}/{comp.total} · {comp.pct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${comp.pct}%` }}
                          />
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs space-y-2">
                      <div className="text-xs font-semibold">Atlas slot checklist</div>
                      <div className="space-y-1">
                        {SLOTS.map(s => {
                          const filled = (c.reference_slots[s.key] ?? []).length > 0;
                          return (
                            <div key={s.key} className="flex items-start gap-2 text-xs">
                              {filled ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                              ) : (
                                <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <span className={filled ? "text-muted-foreground line-through" : "font-medium"}>{s.label}</span>
                                {!filled && <span className="text-muted-foreground"> — {s.hint}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {comp.filled < comp.total && (
                        <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                          Click <ImagePlus className="inline h-3 w-3 align-text-bottom" /> on any empty slot to pick a reference asset from the project library.
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
            <Input value={c.costume ?? ""} onChange={e => update(c.id, { costume: e.target.value })} placeholder="costume (e.g. black coat, red thread on wrist)"/>
            <Input
              value={c.forbidden_changes.join(", ")}
              onChange={e => update(c.id, { forbidden_changes: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })}
              placeholder="forbidden changes: new hairstyle, extra tattoos, different age"
            />
            <Textarea rows={2} value={c.notes ?? ""} onChange={e => update(c.id, { notes: e.target.value })} placeholder="notes"/>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              {SLOTS.map(s => {
                const ids = c.reference_slots[s.key] ?? [];
                return (
                  <div key={s.key} className="rounded-md border border-border/60 p-3 space-y-2 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">{s.label}</div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{ids.length} ref{ids.length!==1?"s":""}</div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPicker({ charId: c.id, slot: s.key })}>
                        <ImagePlus className="h-4 w-4"/>
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug">{s.hint}</p>
                    <div className="grid grid-cols-3 gap-1.5 min-h-[64px]">
                      {ids.length === 0 ? (
                        <button
                          onClick={() => setPicker({ charId: c.id, slot: s.key })}
                          className="col-span-3 aspect-square rounded border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/50 transition-colors"
                        >
                          <ImageIcon className="h-5 w-5"/>
                        </button>
                      ) : ids.map(id => {
                        const a = assetById[id];
                        const src = urls[id];
                        return (
                          <div key={id} className="group relative aspect-square rounded overflow-hidden bg-background">
                            {src ? (
                              <img src={src} alt={a?.filename ?? ""} className="w-full h-full object-cover"/>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-4 w-4 text-muted-foreground"/></div>
                            )}
                            <button
                              onClick={() => removeFromSlot(c.id, s.key, id)}
                              className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Remove"
                            >
                              <X className="h-3 w-3"/>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Upload reference images on the Assets tab, then drop them into the slot grid here. The Continuity Ledger will enforce these on every shot packet.</p>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Pick a {picker ? SLOTS.find(s => s.key === picker.slot)?.label.toLowerCase() : ""} reference
            </DialogTitle>
          </DialogHeader>
          {assets.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No photo or reference assets in this project yet. Upload some on the Assets tab first.
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 max-h-[60vh] overflow-auto">
              {assets.map(a => {
                const src = urls[a.id];
                const already = picker ? chars.find(c => c.id === picker.charId)?.reference_slots[picker.slot].includes(a.id) : false;
                return (
                  <button
                    key={a.id}
                    disabled={already}
                    onClick={() => picker && assignToSlot(picker.charId, picker.slot, a.id)}
                    className="group relative aspect-square rounded overflow-hidden bg-muted border border-border hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {src ? <img src={src} className="w-full h-full object-cover" alt={a.filename ?? ""}/> : <ImageIcon className="h-6 w-6 m-auto text-muted-foreground"/>}
                    {already && <Badge className="absolute top-1 right-1 text-[9px]">in slot</Badge>}
                    {a.subject && <div className="absolute bottom-0 inset-x-0 bg-background/80 text-[10px] px-1 py-0.5 truncate">{a.subject}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
