import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Package, Film, Sparkles, Loader2, ShieldCheck, FileJson } from "lucide-react";
import PreproductionGeneratorPanel from "./PreproductionGeneratorPanel";
import { buildPreproductionPreviewHref } from "@/lib/preproductionWorkspaceContext";

interface Props {
  projectId: string | null;
  entryOrDraftId: string;
  kind: "draft" | "entry";
}

/**
 * Stage C — Preproduction.
 * Read-only launcher. Surfaces the latest context bundle and links out to
 * the QFrame surface for shot packets, visual bible, and AI-gen briefs.
 * A bundle must exist before this stage lights up.
 */
export default function StagePreproduction({ projectId, entryOrDraftId, kind }: Props) {
  const [bundle, setBundle] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) { setLoading(false); return; }
      setLoading(true);
      const { data } = await supabase
        .from("project_artifacts" as any)
        .select("id, payload_json, created_at")
        .eq("project_id", projectId)
        .eq("artifact_type", "context_bundle")
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setBundle(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const bundleReady = Boolean(bundle);
  const localReviewHref = buildPreproductionPreviewHref(
    projectId
      ? { projectId, subjectId: entryOrDraftId, kind }
      : null,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl">Stage C · Preproduction</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Live action, animation, and AI-generation packets are built from the verified context bundle — never from raw draft text.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={localReviewHref} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors">
            <FileJson className="h-3.5 w-3.5" />
            Preview local pack
          </Link>
          {kind === "entry" && (
            <Link to="#bundle" className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border hover:border-primary/40 hover:text-primary transition-colors">
              <Package className="h-3.5 w-3.5" />
              Bundle
            </Link>
          )}
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      )}

      {!loading && (
        <div className="grid gap-3 sm:grid-cols-3">
          <LauncherCard
            icon={<Film className="h-5 w-5" />}
            title="Storyboards"
            body="Shot packets, coverage plan, camera & blocking."
            to="/q-frame"
            enabled={bundleReady}
          />
          <LauncherCard
            icon={<Sparkles className="h-5 w-5" />}
            title="AI Generation Briefs"
            body="Prompt packs anchored to the verified bundle hash."
            to="/q-frame"
            enabled={bundleReady}
          />
          <LauncherCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Visual Bible"
            body="Character, palette, and continuity references."
            to="/q-frame"
            enabled={bundleReady}
          />
        </div>
      )}

      {!loading && projectId && (
        <PreproductionGeneratorPanel
          projectId={projectId}
          entryId={kind === "entry" ? entryOrDraftId : null}
          hasBundle={bundleReady}
        />
      )}

      {!bundleReady && !loading && (
        <Card><CardContent className="p-4 text-xs text-muted-foreground">
          No verified context bundle yet. Build one from the Bundle tab (Stage B) before generating preproduction assets — this is the gate that keeps downstream artifacts anchored to admitted knowledge.
        </CardContent></Card>
      )}
    </div>
  );
}

function LauncherCard({ icon, title, body, to, enabled }: { icon: React.ReactNode; title: string; body: string; to: string; enabled: boolean }) {
  const inner = (
    <Card className={`h-full transition-colors ${enabled ? "hover:border-primary/40" : "opacity-50"}`}>
      <CardContent className="p-4 space-y-2">
        <div className="text-primary">{icon}</div>
        <h4 className="font-display text-base">{title}</h4>
        <p className="text-xs text-muted-foreground">{body}</p>
        {!enabled && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Locked · needs bundle</span>}
      </CardContent>
    </Card>
  );
  return enabled ? <Link to={to}>{inner}</Link> : inner;
}
