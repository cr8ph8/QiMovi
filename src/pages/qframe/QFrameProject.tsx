import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocTitle } from "@/hooks/useDocumentTitle";
import { QFAssetsTab } from "@/components/qframe/QFAssetsTab";
import { QFMusicTab } from "@/components/qframe/QFMusicTab";
import { QFBibleTab } from "@/components/qframe/QFBibleTab";
import { QFCharactersTab } from "@/components/qframe/QFCharactersTab";
import { QFShotsTab } from "@/components/qframe/QFShotsTab";
import { QFLedgerTab } from "@/components/qframe/QFLedgerTab";
import { QFExportTab } from "@/components/qframe/QFExportTab";
import { useHashTab } from "@/hooks/useHashTab";

interface Project {
  id: string;
  title: string;
  status: string;
  song_title: string | null;
  song_artist: string | null;
  bpm: number | null;
  duration_sec: number | null;
  story_summary: string | null;
}

export default function QFrameProject() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useHashTab(["assets","music","bible","characters","shots","ledger","export"] as const, "assets");

  useEffect(() => {
    if (!id || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from("qframe_projects")
        .select("*")
        .eq("id", id)
        .single();
      if (error) console.error(error);
      else setProject(data as Project);
      setLoading(false);
    })();
  }, [id, user]);

  if (authLoading || loading) return <div className="p-12 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto" /></div>;
  if (!user) return <div className="p-12 text-center text-muted-foreground">Sign in required</div>;
  if (!project) return <div className="p-12 text-center text-muted-foreground">Project not found</div>;

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <DocTitle title={`${project.title} — Q-Frame`} />

      <Link to="/q-frame" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> All Q-Frame projects
      </Link>

      <div className="mb-6">
        <h1 className="font-display text-3xl">{project.title}</h1>
        {project.song_title && <p className="text-muted-foreground">♪ {project.song_title}{project.song_artist ? ` — ${project.song_artist}` : ""}</p>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-7 w-full">
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="music">Music</TabsTrigger>
          <TabsTrigger value="bible">Bible</TabsTrigger>
          <TabsTrigger value="characters">Characters</TabsTrigger>
          <TabsTrigger value="shots">Shots</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="assets"><QFAssetsTab projectId={project.id} /></TabsContent>
        <TabsContent value="music"><QFMusicTab projectId={project.id} /></TabsContent>
        <TabsContent value="bible"><QFBibleTab projectId={project.id} /></TabsContent>
        <TabsContent value="characters"><QFCharactersTab projectId={project.id} /></TabsContent>
        <TabsContent value="shots"><QFShotsTab projectId={project.id} /></TabsContent>
        <TabsContent value="ledger"><QFLedgerTab projectId={project.id} /></TabsContent>
        <TabsContent value="export"><QFExportTab projectId={project.id} /></TabsContent>
      </Tabs>
    </div>
  );
}
