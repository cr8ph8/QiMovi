import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Shield, Check, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface Settings {
  enabled: boolean;
  require_approval: boolean;
  keyword_blocklist: string[];
  max_links: number;
  min_length: number;
  min_confidence: number;
}

interface PendingComment {
  id: string;
  parent_comment_id: string | null;
  author_name: string;
  body: string;
  moderation_flags: string[] | null;
  moderation_score: number | null;
  hidden: boolean;
  pending_approval: boolean;
  created_at: string;
}

const DEFAULTS: Settings = {
  enabled: true,
  require_approval: false,
  keyword_blocklist: [],
  max_links: 3,
  min_length: 0,
  min_confidence: 0.4,
};

export function ModerationPanel({ briefId }: { briefId: string }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [keywordsText, setKeywordsText] = useState("");
  const [pending, setPending] = useState<PendingComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: s, error: sErr }, { data: q, error: qErr }] = await Promise.all([
      supabase.rpc("get_brief_moderation_settings", { p_brief_id: briefId }),
      supabase.rpc("list_pending_brief_comments", { p_brief_id: briefId }),
    ]);
    if (!sErr && s) {
      const row = (s as any) ?? DEFAULTS;
      const next: Settings = {
        enabled: !!row.enabled,
        require_approval: !!row.require_approval,
        keyword_blocklist: Array.isArray(row.keyword_blocklist) ? row.keyword_blocklist : [],
        max_links: row.max_links ?? 3,
        min_length: row.min_length ?? 0,
        min_confidence: row.min_confidence != null ? Number(row.min_confidence) : 0.4,
      };
      setSettings(next);
      setKeywordsText(next.keyword_blocklist.join(", "));
    }
    if (!qErr && Array.isArray(q)) {
      setPending(q as PendingComment[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId]);

  const saveSettings = async () => {
    const keywords = keywordsText
      .split(/[,\n]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0 && k.length <= 80);
    if (keywords.length > 100) {
      toast.error("Maximum 100 keywords");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("set_brief_moderation_settings", {
      p_brief_id: briefId,
      p_enabled: settings.enabled,
      p_require_approval: settings.require_approval,
      p_keyword_blocklist: keywords,
      p_max_links: settings.max_links,
      p_min_length: settings.min_length,
      p_min_confidence: settings.min_confidence,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || "Could not save settings");
      return;
    }
    toast.success("Moderation settings saved");
    setSettings((s) => ({ ...s, keyword_blocklist: keywords }));
  };

  const moderate = async (commentId: string, action: "approve" | "reject" | "reset") => {
    setActingOn(commentId);
    const { error } = await supabase.rpc("moderate_brief_comment", {
      p_comment_id: commentId,
      p_action: action,
    });
    setActingOn(null);
    if (error) {
      toast.error(error.message || "Action failed");
      return;
    }
    toast.success(
      action === "approve" ? "Comment approved" : action === "reject" ? "Comment rejected" : "Comment reset to pending",
    );
    setPending((prev) => prev.filter((c) => c.id !== commentId));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Comment moderation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Settings */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Enable moderation filters</Label>
                  <p className="text-xs text-muted-foreground">Auto-flag suspicious comments before they appear publicly.</p>
                </div>
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Require approval for every comment</Label>
                  <p className="text-xs text-muted-foreground">Hold all new comments for your review.</p>
                </div>
                <Switch
                  checked={settings.require_approval}
                  onCheckedChange={(v) => setSettings((s) => ({ ...s, require_approval: v }))}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Keyword blocklist</Label>
                <Input
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="spam, crypto, off-topic"
                  disabled={!settings.enabled}
                />
                <p className="text-xs text-muted-foreground">Comma-separated. Case-insensitive substring match.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Max links</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={settings.max_links}
                    onChange={(e) => setSettings((s) => ({ ...s, max_links: Number(e.target.value) || 0 }))}
                    disabled={!settings.enabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Min length</Label>
                  <Input
                    type="number"
                    min={0}
                    max={2000}
                    value={settings.min_length}
                    onChange={(e) => setSettings((s) => ({ ...s, min_length: Number(e.target.value) || 0 }))}
                    disabled={!settings.enabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Min confidence</Label>
                  <Input
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={settings.min_confidence}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, min_confidence: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))
                    }
                    disabled={!settings.enabled}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={saveSettings} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Save settings
                </Button>
              </div>
            </div>

            <Separator />

            {/* Queue */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Pending review ({pending.length})</Label>
                <Button size="sm" variant="ghost" onClick={loadAll}>Refresh</Button>
              </div>

              {pending.length === 0 ? (
                <p className="text-xs text-muted-foreground">No flagged comments. Approved comments appear publicly automatically.</p>
              ) : (
                <ul className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {pending.map((c) => {
                    const flags = c.moderation_flags ?? [];
                    const score = c.moderation_score != null ? Number(c.moderation_score) : null;
                    return (
                      <li key={c.id} className="rounded-md border border-border/60 p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{c.author_name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {new Date(c.created_at).toLocaleString()}
                              {c.parent_comment_id ? " · reply" : ""}
                              {c.hidden ? " · hidden" : c.pending_approval ? " · pending" : " · approved"}
                            </div>
                          </div>
                          {score != null && (
                            <Badge variant={score < 0.4 ? "destructive" : "secondary"} className="text-[10px] shrink-0">
                              conf {score.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{c.body}</p>
                        {flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {flags.map((f) => (
                              <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          {!c.hidden && c.pending_approval ? (
                            <Button size="sm" variant="default" disabled={actingOn === c.id}
                                    onClick={() => moderate(c.id, "approve")}>
                              <Check className="h-3.5 w-3.5 mr-1" /> Approve
                            </Button>
                          ) : null}
                          {!c.hidden && (
                            <Button size="sm" variant="destructive" disabled={actingOn === c.id}
                                    onClick={() => moderate(c.id, "reject")}>
                              <X className="h-3.5 w-3.5 mr-1" /> Reject
                            </Button>
                          )}
                          {(!c.pending_approval || c.hidden) && (
                            <Button size="sm" variant="ghost" disabled={actingOn === c.id}
                                    onClick={() => moderate(c.id, "reset")}>
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Re-queue
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
