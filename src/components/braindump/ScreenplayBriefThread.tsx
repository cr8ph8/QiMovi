import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Loader2,
  Send,
  FileText,
  Sparkles,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { CollaboratorInviteDialog } from "./CollaboratorInviteDialog";

export type ThreadKind = "update" | "note" | "question" | "response" | "ai_digest";

interface ThreadMessage {
  id: string;
  entry_id: string;
  brief_id: string | null;
  brief_title: string | null;
  brief_version_id: string | null;
  brief_version_at: string | null;
  brief_version_source: string | null;
  body: string;
  kind: ThreadKind;
  source: string;
  user_id: string;
  created_at: string;
}

interface Props {
  entryId: string;
  entryTitle?: string | null;
  briefId?: string | null;
  /** Most recent brief version id, used to attach an "update" message. */
  latestVersionId?: string | null;
}

const KIND_OPTIONS: { value: ThreadKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "update", label: "Update" },
  { value: "question", label: "Question" },
  { value: "response", label: "Response" },
];

const KIND_BADGE: Record<ThreadKind, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  update: { label: "Update", variant: "default" },
  note: { label: "Note", variant: "secondary" },
  question: { label: "Question", variant: "outline" },
  response: { label: "Response", variant: "secondary" },
  ai_digest: { label: "AI digest", variant: "outline" },
};

export function ScreenplayBriefThread({
  entryId,
  entryTitle,
  briefId,
  latestVersionId,
}: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<ThreadKind>("note");
  const [posting, setPosting] = useState(false);
  const [attachVersion, setAttachVersion] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_entry_brief_thread", {
      p_entry_id: entryId,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not load thread");
      return;
    }
    const rows = (data as ThreadMessage[]) ?? [];
    setMessages(rows);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  useEffect(() => {
    if (!entryId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setPosting(true);
    const { error } = await supabase.rpc("post_entry_brief_message", {
      p_entry_id: entryId,
      p_body: trimmed,
      p_brief_id: briefId ?? null,
      p_brief_version_id: attachVersion ? latestVersionId ?? null : null,
      p_kind: kind,
      p_source: "user",
    });
    setPosting(false);
    if (error) {
      toast.error(error.message || "Could not send message");
      return;
    }
    setBody("");
    toast.success("Message added to draft thread");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("entry_brief_messages").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "Could not delete");
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Communicate with this screenplay
              {entryTitle && (
                <span className="ml-1 text-xs text-muted-foreground font-sans truncate max-w-[200px]">
                  · {entryTitle}
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Thread your brain dump updates, questions and notes directly to this screenplay draft.
            </p>
          </div>
          <CollaboratorInviteDialog entryId={entryId} entryTitle={entryTitle} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">

        <div
          ref={scrollRef}
          className="max-h-72 overflow-y-auto space-y-3 pr-1"
        >
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading thread…
            </div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">
              No messages yet. Send the first note about how this dump connects to the draft.
            </p>
          ) : (
            messages.map((m) => {
              const badge = KIND_BADGE[m.kind] ?? KIND_BADGE.note;
              return (
                <div key={m.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={badge.variant} className="text-[10px]">
                        {m.source === "ai_organize" ? <Sparkles className="h-2.5 w-2.5 mr-0.5" /> : null}
                        {badge.label}
                      </Badge>
                      {m.brief_version_id && (
                        <span className="text-[10px] text-muted-foreground">
                          attached to brief version
                          {m.brief_version_at
                            ? ` · ${new Date(m.brief_version_at).toLocaleString()}`
                            : ""}
                          {m.brief_version_source ? ` · ${m.brief_version_source}` : ""}
                        </span>
                      )}
                      {m.brief_id && m.brief_title && (
                        <Link
                          to="/brain-dump"
                          className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          <FileText className="h-2.5 w-2.5" /> {m.brief_title}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Link>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => remove(m.id)}
                      aria-label="Delete message"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleString()}
                  </p>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as ThreadKind)}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {latestVersionId && (
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={attachVersion}
                  onChange={(e) => setAttachVersion(e.target.checked)}
                  className="h-3 w-3"
                />
                Attach latest brief version
              </label>
            )}
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Tell this draft what changed in your dump, ask a question, or leave a note for future you…"
            rows={3}
            maxLength={5000}
            className="text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={send} disabled={posting || !body.trim()}>
              {posting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1" />
              )}
              Send to draft
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
