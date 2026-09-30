import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link2, Plus, Trash2, Copy, Check, Clock, Eye, MessageSquare, ExternalLink, Activity } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type ShareAccessType = "view" | "review";

interface ShareLink {
  id: string;
  entry_id: string;
  token: string;
  access_type: ShareAccessType;
  created_by: string;
  expires_at: string | null;
  revoked_at: string | null;
  label: string;
  created_at: string;
  access_count?: number;
}

interface Props {
  entryId: string;
}

const EXPIRY_OPTIONS = [
  { value: "none", label: "No expiration" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function getExpiryDate(option: string): string | null {
  const now = new Date();
  switch (option) {
    case "1h": return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    case "24h": return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    case "7d": return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    default: return null;
  }
}

export default function ShareLinksPanel({ entryId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create form
  const [newAccessType, setNewAccessType] = useState<ShareAccessType>("view");
  const [newExpiry, setNewExpiry] = useState("none");
  const [newLabel, setNewLabel] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("share_links")
      .select("*")
      .eq("entry_id", entryId)
      .order("created_at", { ascending: false });

    if (data) {
      // Fetch access counts
      const linkIds = data.map((l: any) => l.id);
      const { data: logs } = linkIds.length > 0
        ? await supabase
            .from("share_link_access_log")
            .select("share_link_id")
            .in("share_link_id", linkIds)
        : { data: [] };

      const countMap = new Map<string, number>();
      logs?.forEach((l: any) => countMap.set(l.share_link_id, (countMap.get(l.share_link_id) || 0) + 1));

      setLinks(data.map((l: any) => ({ ...l, access_count: countMap.get(l.id) || 0 })));
    }
    setLoading(false);
  }, [entryId]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const handleCreate = async () => {
    if (!user) return;
    setCreating(true);

    const { error } = await supabase.from("share_links").insert({
      entry_id: entryId,
      access_type: newAccessType,
      created_by: user.id,
      expires_at: getExpiryDate(newExpiry),
      label: newLabel.trim(),
    } as any);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await supabase.from("collaboration_events").insert({
        entry_id: entryId,
        actor_id: user.id,
        event_type: "share_link_created",
        metadata: { access_type: newAccessType, expiry: newExpiry },
      });
      toast({ title: "Share link created" });
      setNewLabel("");
      setNewExpiry("none");
      setShowCreate(false);
      fetchLinks();
    }
    setCreating(false);
  };

  const handleRevoke = async (link: ShareLink) => {
    if (!user) return;
    await supabase.from("share_links").update({ revoked_at: new Date().toISOString() } as any).eq("id", link.id);
    await supabase.from("collaboration_events").insert({
      entry_id: entryId,
      actor_id: user.id,
      event_type: "share_link_revoked",
      metadata: { link_id: link.id, label: link.label },
    });
    toast({ title: "Link revoked" });
    fetchLinks();
  };

  const copyLink = (link: ShareLink) => {
    const url = `${window.location.origin}/shared/${link.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isActive = (link: ShareLink) =>
    !link.revoked_at && (!link.expires_at || new Date(link.expires_at) > new Date());

  const activeLinks = links.filter(isActive);
  const inactiveLinks = links.filter((l) => !isActive(l));

  if (loading) return <p className="text-xs text-muted-foreground py-2">Loading…</p>;

  return (
    <div className="space-y-4">
      {/* Active Links */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" /> Share Links
            {activeLinks.length > 0 && <Badge variant="secondary" className="text-[10px]">{activeLinks.length} active</Badge>}
          </h4>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-3 w-3 mr-1" /> New Link
          </Button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="rounded-lg border border-border/50 p-3 mb-3 space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="text-xs h-8 flex-1"
              />
              <Select value={newAccessType} onValueChange={(v) => setNewAccessType(v as ShareAccessType)}>
                <SelectTrigger className="w-28 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">View Only</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Select value={newExpiry} onValueChange={setNewExpiry}>
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button size="sm" className="h-7 text-xs" onClick={handleCreate} disabled={creating}>
                {creating ? "Creating…" : "Create"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Links List */}
        {activeLinks.length === 0 && !showCreate && (
          <p className="text-xs text-muted-foreground py-2">No active share links. Create one to share this project.</p>
        )}

        {activeLinks.map((link) => (
          <div key={link.id} className="flex items-center gap-2 py-2 px-3 rounded-lg border border-border/30 hover:bg-muted/20 transition-colors mb-1 group">
            {link.access_type === "view" ? (
              <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-blue-400 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium truncate">{link.label || "Untitled link"}</span>
                <Badge variant="outline" className="text-[9px] shrink-0">
                  {link.access_type === "view" ? "View" : "Review"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {link.expires_at && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    Expires {formatDistanceToNow(new Date(link.expires_at), { addSuffix: true })}
                  </span>
                )}
                {!link.expires_at && <span>No expiration</span>}
                <span>·</span>
                <span className="flex items-center gap-0.5">
                  <Activity className="h-2.5 w-2.5" />
                  {link.access_count || 0} views
                </span>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyLink(link)}>
                  {copiedId === link.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRevoke(link)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Revoke link</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>

      {/* Inactive/Revoked Links */}
      {inactiveLinks.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Expired / Revoked</h4>
            {inactiveLinks.map((link) => (
              <div key={link.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg opacity-50">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs truncate flex-1">{link.label || "Untitled"}</span>
                <Badge variant="outline" className="text-[9px]">
                  {link.revoked_at ? "Revoked" : "Expired"}
                </Badge>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {format(new Date(link.created_at), "MMM d")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
