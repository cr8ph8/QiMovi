import { useState } from "react";
import { Copy, Check, Loader2, Share2, Clock, Code2, Lock, Unlock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ShareViewsPanel } from "./ShareViewsPanel";
import { EngagementStatsPanel } from "./EngagementStatsPanel";
import { ModerationPanel } from "./ModerationPanel";

type Visibility = "private" | "unlisted" | "public";

interface Props {
  briefId: string;
  initialVisibility: Visibility;
  initialShareToken: string | null;
  initialShareExpiresAt?: string | null;
  initialHasPassword?: boolean;
  onUpdated?: () => void;
}

const EXPIRY_OPTIONS = [
  { value: "none", label: "No expiration" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "keep", label: "Keep current expiration" },
];

function expiryToISO(option: string, current: string | null): string | null {
  const now = Date.now();
  switch (option) {
    case "1h": return new Date(now + 60 * 60 * 1000).toISOString();
    case "24h": return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    case "7d": return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    case "keep": return current;
    default: return null;
  }
}

function genToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

export function ShareBriefDialog({ briefId, initialVisibility, initialShareToken, initialShareExpiresAt, initialHasPassword, onUpdated }: Props) {
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [token, setToken] = useState<string | null>(initialShareToken);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialShareExpiresAt ?? null);
  const [expiryChoice, setExpiryChoice] = useState<string>(initialShareExpiresAt ? "keep" : "none");
  const [hasPassword, setHasPassword] = useState<boolean>(!!initialHasPassword);
  const [pwInput, setPwInput] = useState<string>("");
  const [pwBusy, setPwBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = token ? `${window.location.origin}/brief/${token}` : "";
  const expired = !!expiresAt && new Date(expiresAt).getTime() <= Date.now();

  const handleSave = async () => {
    setSaving(true);
    try {
      let nextToken = token;
      let nextExpiry: string | null = expiryToISO(expiryChoice, expiresAt);
      if ((visibility === "unlisted" || visibility === "public") && !nextToken) {
        nextToken = genToken();
      }
      if (visibility === "private") {
        nextToken = null;
        nextExpiry = null;
      }
      const { error } = await supabase
        .from("project_briefs")
        .update({ visibility, share_token: nextToken, share_expires_at: nextExpiry } as any)
        .eq("id", briefId);
      if (error) throw error;
      setToken(nextToken);
      setExpiresAt(nextExpiry);
      setExpiryChoice(nextExpiry ? "keep" : "none");
      toast.success("Sharing settings updated.");
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async () => {
    if (visibility === "private") return;
    setSaving(true);
    try {
      const newToken = genToken();
      const { error } = await supabase
        .from("project_briefs")
        .update({ share_token: newToken })
        .eq("id", briefId);
      if (error) throw error;
      setToken(newToken);
      toast.success("New link generated. Old link is no longer valid.");
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rotate failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPassword = async () => {
    const pw = pwInput.trim();
    if (pw.length < 4) {
      toast.error("Passcode must be at least 4 characters.");
      return;
    }
    setPwBusy(true);
    try {
      const { error } = await supabase.rpc("set_brief_share_password", {
        p_brief_id: briefId,
        p_password: pw,
      });
      if (error) throw error;
      setHasPassword(true);
      setPwInput("");
      toast.success("Passcode set. Viewers will be prompted before reading.");
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set passcode.");
    } finally {
      setPwBusy(false);
    }
  };

  const handleClearPassword = async () => {
    setPwBusy(true);
    try {
      const { error } = await supabase.rpc("set_brief_share_password", {
        p_brief_id: briefId,
        p_password: "",
      });
      if (error) throw error;
      setHasPassword(false);
      setPwInput("");
      toast.success("Passcode removed. Anyone with the link can view again.");
      onUpdated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clear passcode.");
    } finally {
      setPwBusy(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Share">
          <Share2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Share this brief</DialogTitle>
          <DialogDescription>
            Choose who can see your organized brief and how long the link stays active.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private — only you</SelectItem>
                <SelectItem value="unlisted">Unlisted — anyone with the link</SelectItem>
                <SelectItem value="public">Public — discoverable</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visibility !== "private" && (
            <div className="space-y-2">
              <Label>Link expiration</Label>
              <Select value={expiryChoice} onValueChange={setExpiryChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS
                    .filter((o) => o.value !== "keep" || expiresAt)
                    .map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {expiresAt && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {expired
                    ? `Expired ${formatDistanceToNow(new Date(expiresAt), { addSuffix: true })}`
                    : `Currently expires ${formatDistanceToNow(new Date(expiresAt), { addSuffix: true })}`}
                </p>
              )}
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save settings
          </Button>

          {visibility !== "private" && token && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <Label>Share link</Label>
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={handleRotate} disabled={saving}>
                Rotate link
              </Button>
              {expired && (
                <p className="text-xs text-destructive">
                  This link has expired. Pick a new expiration above and save to reactivate it.
                </p>
              )}

              <EmbedSnippet token={token} disabled={expired} />

              <div className="space-y-2 pt-3 mt-2 border-t border-border/50">
                <Label className="flex items-center gap-1.5">
                  {hasPassword ? <Lock className="h-3.5 w-3.5 text-primary" /> : <Unlock className="h-3.5 w-3.5" />}
                  Passcode protection
                  {hasPassword && (
                    <span className="text-[10px] text-primary font-normal">· Active</span>
                  )}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {hasPassword
                    ? "Viewers must enter a passcode to read this brief."
                    : "Optionally require a passcode before anyone can view the brief."}
                </p>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={pwInput}
                    onChange={(e) => setPwInput(e.target.value)}
                    placeholder={hasPassword ? "Enter new passcode to change" : "Choose a passcode (4+ chars)"}
                    maxLength={128}
                    className="text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSetPassword}
                    disabled={pwBusy || pwInput.trim().length < 4}
                  >
                    {pwBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : hasPassword ? "Update" : "Set"}
                  </Button>
                </div>
                {hasPassword && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearPassword}
                    disabled={pwBusy}
                    className="text-xs h-7"
                  >
                    Remove passcode
                  </Button>
                )}
              </div>

              <EngagementStatsPanel briefId={briefId} />

              <ModerationPanel briefId={briefId} />

              <div className="flex justify-end">
                <a
                  href="/brain-dump/moderation"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open full moderation queue →
                </a>
              </div>

              <ShareViewsPanel briefId={briefId} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmbedSnippet({ token, disabled }: { token: string; disabled: boolean }) {
  const [compact, setCompact] = useState(false);
  const [hideHeader, setHideHeader] = useState(false);
  const [copied, setCopied] = useState(false);

  const params = new URLSearchParams();
  if (compact) params.set("compact", "1");
  if (hideHeader) params.set("header", "0");
  const qs = params.toString();
  const embedUrl = `${window.location.origin}/embed/brief/${token}${qs ? `?${qs}` : ""}`;
  const snippet = `<iframe src="${embedUrl}" width="100%" height="${compact ? 480 : 640}" style="border:0;border-radius:12px;background:#0b0b0f" loading="lazy" title="Project Brief"></iframe>`;

  const copySnippet = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2 pt-3 mt-2 border-t border-border/50">
      <Label className="flex items-center gap-1.5">
        <Code2 className="h-3.5 w-3.5" /> Embed on your blog or portfolio
      </Label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
          Compact size
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={hideHeader} onChange={(e) => setHideHeader(e.target.checked)} />
          Hide title header
        </label>
      </div>
      <Textarea
        readOnly
        value={snippet}
        className="font-mono text-[11px] h-24 resize-none"
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copySnippet} disabled={disabled} className="flex-1">
          {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
          {copied ? "Copied" : "Copy embed code"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={embedUrl} target="_blank" rel="noopener noreferrer">Preview</a>
        </Button>
      </div>
      {disabled && (
        <p className="text-[11px] text-muted-foreground">
          The link is currently expired — extend its expiration above to make the embed render.
        </p>
      )}
    </div>
  );
}
