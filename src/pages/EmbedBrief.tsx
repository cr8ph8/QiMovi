import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, Globe, EyeOff, Clock, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { OrganizedBriefCard, type OrganizedBrief } from "@/components/braindump/OrganizedBriefCard";
import { BriefPasswordGate } from "@/components/braindump/BriefPasswordGate";

type EmbedBrief = {
  id: string;
  title: string | null;
  organized: OrganizedBrief | null;
  visibility: "unlisted" | "public";
  confidence: number | null;
  created_at: string;
  share_expires_at: string | null;
  requires_password: boolean;
};

export default function EmbedBrief() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const compact = params.get("compact") === "1";
  const hideHeader = params.get("header") === "0";

  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<EmbedBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const logView = (t: string) => {
    supabase.rpc("log_brief_view_by_token", {
      p_token: t,
      p_referrer: typeof document !== "undefined" ? document.referrer || null : null,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      p_surface: "embed",
    });
  };

  useEffect(() => {
    (async () => {
      if (!token) return;
      const { data, error } = await supabase.rpc("lookup_brief_by_token", { p_token: token });
      if (error) setError("Could not load this brief.");
      else if (!data || (data as unknown[]).length === 0) {
        setError("This brief link is invalid, expired, or no longer shared.");
      } else {
        const row = (data as EmbedBrief[])[0];
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
    if (data && (data as EmbedBrief[]).length > 0) {
      setBrief((data as EmbedBrief[])[0]);
      logView(token);
    }
  };

  const publicUrl = token ? `${window.location.origin}/brief/${token}` : "#";

  return (
    <div className="min-h-screen bg-cinema text-foreground p-4 md:p-6">
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary" />
        </div>
      )}

      {!loading && (error || !brief) && (
        <div className="rounded-lg border border-border/50 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          {error ?? "Brief unavailable."}
        </div>
      )}

      {!loading && brief && brief.requires_password && !brief.organized && (
        <div className="flex items-center justify-center py-10">
          <BriefPasswordGate onSubmit={handleUnlock} error={pwError} compact />
        </div>
      )}

      {!loading && brief && brief.organized && (
        <div className={compact ? "max-w-2xl mx-auto space-y-3" : "max-w-3xl mx-auto space-y-4"}>
          {!hideHeader && (
            <header className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={brief.visibility === "public" ? "default" : "secondary"} className="text-[10px]">
                  {brief.visibility === "public" ? (
                    <><Globe className="h-3 w-3 mr-1" /> Public</>
                  ) : (
                    <><EyeOff className="h-3 w-3 mr-1" /> Unlisted</>
                  )}
                </Badge>
                {brief.share_expires_at && (
                  <Badge variant="outline" className="text-[10px] flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expires {formatDistanceToNow(new Date(brief.share_expires_at), { addSuffix: true })}
                  </Badge>
                )}
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                >
                  Open on caniscreenwrite.com <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <h1 className={`font-display tracking-tight ${compact ? "text-xl" : "text-2xl md:text-3xl"}`}>
                {brief.title || "Untitled Brief"}
              </h1>
            </header>
          )}

          <OrganizedBriefCard brief={brief.organized} />

          <footer className="pt-2 text-[10px] text-muted-foreground text-center">
            Powered by{" "}
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              CanIScreenwrite Brain Dump
            </a>
          </footer>
        </div>
      )}
    </div>
  );
}
