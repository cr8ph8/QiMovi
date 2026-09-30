import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, Globe, EyeOff, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { OrganizedBriefCard, type OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";
import { BriefComments } from "@/components/braindump/BriefComments";
import { MyReportsPanel } from "@/components/braindump/MyReportsPanel";
import { BriefPasswordGate } from "@/components/braindump/BriefPasswordGate";

type PublicBrief = {
  id: string;
  title: string | null;
  organized: OrganizedBrief | null;
  visibility: "unlisted" | "public";
  confidence: number | null;
  created_at: string;
  share_expires_at: string | null;
  requires_password: boolean;
};

export default function PublicBriefPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<PublicBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const logView = (t: string) => {
    supabase.rpc("log_brief_view_by_token", {
      p_token: t,
      p_referrer: typeof document !== "undefined" ? document.referrer || null : null,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      p_surface: "public",
    });
  };

  useEffect(() => {
    (async () => {
      if (!token) return;
      const { data, error } = await supabase.rpc("lookup_brief_by_token", { p_token: token });
      if (error) {
        setError("Could not load this brief.");
      } else if (!data || (data as unknown[]).length === 0) {
        setError("This brief link is invalid, revoked, or no longer shared.");
      } else {
        const row = (data as PublicBrief[])[0];
        setBrief(row);
        if (!row.requires_password) logView(token);
      }
      setLoading(false);
    })();
  }, [token]);

  const handleUnlock = async (password: string) => {
    if (!token) return;
    setPwError(null);
    const { data, error } = await supabase.rpc("unlock_brief_by_token", {
      p_token: token,
      p_password: password,
    });
    if (error) {
      setPwError("Incorrect passcode. Try again.");
      return;
    }
    if (data && (data as PublicBrief[]).length > 0) {
      setBrief((data as PublicBrief[])[0]);
      logView(token);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="container py-20 flex justify-center">
          <Loader2 className="animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (error || !brief) {
    return (
      <Layout>
        <div className="container py-20 text-center space-y-4">
          <h1 className="font-display text-3xl">Brief Unavailable</h1>
          <p className="text-muted-foreground">{error}</p>
          <Button asChild variant="outline"><Link to="/">Return home</Link></Button>
        </div>
      </Layout>
    );
  }

  if (brief.requires_password && !brief.organized) {
    return (
      <Layout>
        <div className="container py-20">
          <BriefPasswordGate onSubmit={handleUnlock} error={pwError} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container py-10 max-w-4xl space-y-6">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={brief.visibility === "public" ? "default" : "secondary"}>
              {brief.visibility === "public" ? (
                <><Globe className="h-3 w-3 mr-1" /> Public</>
              ) : (
                <><EyeOff className="h-3 w-3 mr-1" /> Unlisted</>
              )}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Shared {new Date(brief.created_at).toLocaleDateString()}
            </span>
            {brief.share_expires_at && (
              <Badge variant="outline" className="text-[10px] flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Expires {formatDistanceToNow(new Date(brief.share_expires_at), { addSuffix: true })}
              </Badge>
            )}
          </div>
          <h1 className="font-display text-4xl tracking-tight">
            {brief.title || "Untitled Brief"}
          </h1>
          {brief.confidence != null && (
            <p className="text-sm text-muted-foreground">
              AI confidence: {(brief.confidence * 100).toFixed(0)}%
            </p>
          )}
        </header>

        {brief.organized && <OrganizedBriefCard brief={brief.organized} />}

        <BriefComments shareToken={token} />

        <MyReportsPanel briefId={brief.id} />

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="font-display text-base">Build your own brief</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Pour your unstructured ideas into the Brain Dump tool and let AI organize them into a
            project skeleton like this one.
            <div className="mt-3">
              <Button asChild size="sm"><Link to="/brain-dump">Try Brain Dump</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
