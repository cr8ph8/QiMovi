import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Upload, Sparkles, Trash2, Image as ImageIcon, Music, FileText, Film } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type AssetKind = "photo" | "clip" | "audio" | "lyric" | "reference";

interface Asset {
  id: string;
  project_id: string;
  kind: AssetKind;
  storage_path: string;
  mime: string | null;
  filename: string | null;
  role: string | null;
  subject: string | null;
  mood: string[];
  color_notes: string[];
  quality_score: number | null;
  tagged_at: string | null;
}

const KIND_ICON: Record<AssetKind, any> = {
  photo: ImageIcon, clip: Film, audio: Music, lyric: FileText, reference: ImageIcon,
};

function detectKind(file: File): AssetKind {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "clip";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".md")) return "lyric";
  return "reference";
}

export function QFAssetsTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from("qframe_assets")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setAssets((data ?? []) as Asset[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [projectId]);

  useEffect(() => {
    // Generate signed URLs for image/clip thumbnails
    (async () => {
      const next: Record<string, string> = {};
      for (const a of assets) {
        if (a.kind !== "photo" && a.kind !== "clip" && a.kind !== "reference") continue;
        if (urls[a.id]) { next[a.id] = urls[a.id]; continue; }
        const { data } = await supabase.storage.from("qframe-assets").createSignedUrl(a.storage_path, 3600);
        if (data?.signedUrl) next[a.id] = data.signedUrl;
      }
      setUrls(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = detectKind(file);
        const path = `${user.id}/${projectId}/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("qframe-assets").upload(path, file);
        if (upErr) throw upErr;
        const { error: insErr } = await supabase.from("qframe_assets").insert({
          project_id: projectId, kind, storage_path: path, mime: file.type, filename: file.name, byte_size: file.size,
        });
        if (insErr) throw insErr;
      }
      toast.success(`Uploaded ${files.length} asset${files.length>1?"s":""}`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const tag = async (a: Asset) => {
    if (a.kind !== "photo" && a.kind !== "reference") {
      toast.info("Auto-tagging only supports photos / references right now.");
      return;
    }
    setTaggingId(a.id);
    try {
      const { error } = await supabase.functions.invoke("qframe-tag-asset", {
        body: { asset_id: a.id },
      });
      if (error) throw error;
      toast.success("Asset tagged");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Tagging failed");
    } finally {
      setTaggingId(null);
    }
  };

  const del = async (a: Asset) => {
    if (!confirm("Delete this asset?")) return;
    await supabase.storage.from("qframe-assets").remove([a.storage_path]);
    await supabase.from("qframe_assets").delete().eq("id", a.id);
    setAssets(prev => prev.filter(x => x.id !== a.id));
  };

  if (loading) return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto"/></div>;

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{assets.length} asset{assets.length!==1?"s":""}</p>
        <div>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}
            Upload
          </Button>
        </div>
      </div>

      {assets.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          Drop photos, music, clips, lyrics, and references here. Each gets tagged + roled before joining a shot packet.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {assets.map(a => {
            const Icon = KIND_ICON[a.kind];
            const src = urls[a.id];
            return (
              <Card key={a.id} className="overflow-hidden">
                <div className="aspect-square bg-muted flex items-center justify-center">
                  {src && a.kind !== "audio" ? (
                    a.kind === "clip" ? <video src={src} className="w-full h-full object-cover" /> :
                    <img src={src} className="w-full h-full object-cover" alt={a.filename ?? ""} />
                  ) : <Icon className="h-12 w-12 text-muted-foreground" />}
                </div>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{a.kind}</Badge>
                    {a.quality_score !== null && <Badge variant="secondary" className="text-xs">Q {a.quality_score.toFixed(2)}</Badge>}
                  </div>
                  <p className="text-xs truncate" title={a.filename ?? ""}>{a.filename ?? "(unnamed)"}</p>
                  {a.subject && <p className="text-xs text-muted-foreground truncate">→ {a.subject}</p>}
                  {a.mood.length > 0 && <p className="text-xs text-muted-foreground truncate">{a.mood.join(", ")}</p>}
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="flex-1 h-7 text-xs gap-1" onClick={() => tag(a)} disabled={taggingId === a.id}>
                      {taggingId === a.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <Sparkles className="h-3 w-3"/>}
                      {a.tagged_at ? "Re-tag" : "Tag"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => del(a)}>
                      <Trash2 className="h-3 w-3"/>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
