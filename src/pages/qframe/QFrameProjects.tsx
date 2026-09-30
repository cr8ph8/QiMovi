import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Film, Loader2 } from "lucide-react";
import { DocTitle } from "@/hooks/useDocumentTitle";

interface QFProject {
  id: string;
  title: string;
  status: string;
  song_title: string | null;
  duration_sec: number | null;
  updated_at: string;
}

export default function QFrameProjects() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<QFProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("qframe_projects")
        .select("id, title, status, song_title, duration_sec, updated_at")
        .order("updated_at", { ascending: false });
      if (!active) return;
      if (error) toast.error(error.message);
      else setProjects((data ?? []) as QFProject[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      // Spend tokens for project creation
      const { error: spendErr } = await supabase.functions.invoke("spend-tokens", {
        body: { action: "qframe_project_create", label: "Q-Frame: project create" },
      });
      if (spendErr) throw spendErr;

      const { data, error } = await supabase
        .from("qframe_projects")
        .insert({ owner_id: user!.id, title: title.trim(), song_title: songTitle.trim() || null })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Q-Frame project created");
      navigate(`/q-frame/${data.id}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  if (authLoading) return <div className="p-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></div>;
  if (!user) return (
    <div className="container mx-auto py-24 text-center">
      <p className="text-muted-foreground mb-4">Sign in to use Q-Frame Engine.</p>
      <Link to="/auth"><Button>Sign In</Button></Link>
    </div>
  );

  return (
    <div className="container mx-auto py-12 max-w-6xl">
      <DocTitle title="Q-Frame Engine — Visual Story Prep" />

      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl mb-2">Q-Frame Engine</h1>
          <p className="text-muted-foreground max-w-2xl">
            Prepare raw assets, music, and references into governed, generation-ready shot packets.
            One shot at a time. Continuity enforced.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></div>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Film className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">No Q-Frame projects yet.</p>
            <Button onClick={() => setOpen(true)}>Create your first project</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link key={p.id} to={`/q-frame/${p.id}`}>
              <Card className="hover:border-primary transition cursor-pointer h-full">
                <CardHeader>
                  <CardTitle className="font-display text-xl">{p.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  {p.song_title && <p className="text-sm text-muted-foreground">♪ {p.song_title}</p>}
                  <p className="text-xs text-muted-foreground mt-2 capitalize">Status: {p.status}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Q-Frame project</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Project title" value={title} onChange={e => setTitle(e.target.value)} />
            <Input placeholder="Song title (optional)" value={songTitle} onChange={e => setSongTitle(e.target.value)} />
            <p className="text-xs text-muted-foreground">Costs 10 tokens.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !title.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
