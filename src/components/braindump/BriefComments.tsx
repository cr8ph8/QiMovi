import { useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, MessageCircle, EyeOff, Trash2, Flag, ShieldAlert, Reply, X, Sparkles, Send, Copy, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Comment = {
  id: string;
  parent_comment_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
  hidden?: boolean;
};

type Report = {
  id: string;
  comment_id: string;
  reason: string | null;
  status: "pending" | "reviewed" | "dismissed";
  appeal_status?: "none" | "requested" | "upheld" | "overturned";
  appeal_response?: string | null;
  created_at: string;
};

type Props = {
  shareToken?: string;
  briefId?: string;
  isOwner?: boolean;
};

const MAX_DEPTH = 2; // 0 = root, 2 = third level

const REPORT_CATEGORIES: { value: string; label: string; description: string }[] = [
  { value: "hate_harassment", label: "Hate or harassment", description: "Attacks, slurs, or threats toward a person or group." },
  { value: "spam", label: "Spam or scam", description: "Unsolicited promotion, scams, or repeated content." },
  { value: "copyright", label: "Copyrighted content", description: "Reproduces protected work without permission." },
  { value: "sexual_content", label: "Sexual or explicit content", description: "Pornographic or sexually explicit material." },
  { value: "violence", label: "Violence or self-harm", description: "Graphic violence, threats, or self-harm content." },
  { value: "misinformation", label: "Misinformation", description: "Demonstrably false or misleading claims." },
  { value: "personal_info", label: "Personal information", description: "Shares private or identifying info without consent." },
  { value: "off_topic", label: "Off-topic or low quality", description: "Unrelated to the brief or not constructive." },
  { value: "other", label: "Other", description: "Something else not listed above." },
];

function depthOf(c: Comment, byId: Map<string, Comment>): number {
  let d = 0;
  let cur: Comment | undefined = c;
  while (cur?.parent_comment_id && d < 10) {
    cur = byId.get(cur.parent_comment_id);
    if (!cur) break;
    d += 1;
  }
  return d;
}

export function BriefComments({ shareToken, briefId, isOwner = false }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [reportsByComment, setReportsByComment] = useState<Record<string, Report[]>>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  // Reply state
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [replyName, setReplyName] = useState("");
  const [replyBody, setReplyBody] = useState("");

  // Report dialog state (viewer mode)
  const [reportTarget, setReportTarget] = useState<Comment | null>(null);
  const [reportCategory, setReportCategory] = useState<string>("");
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);

  // Appeal dialog state (owner mode)
  const [appealTarget, setAppealTarget] = useState<Comment | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [appealing, setAppealing] = useState(false);

  // AI suggestion sync state (owner mode)
  type AISuggestion = {
    title: string;
    kind: string;
    target?: string;
    suggestion: string;
    rationale: string;
    confidence: number;
  };
  const [aiTarget, setAiTarget] = useState<Comment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [aiBriefEntryId, setAiBriefEntryId] = useState<string | null>(null);
  const [linkedEntry, setLinkedEntry] = useState<{ id: string; title: string } | null>(null);
  const [sendingIdx, setSendingIdx] = useState<number | null>(null);

  // Resolve linked entry once for owner so we can offer "Send to screenplay".
  useEffect(() => {
    if (!isOwner || !briefId) return;
    (async () => {
      const { data } = await supabase
        .from("project_briefs")
        .select("entry_id, entries(id, title)")
        .eq("id", briefId)
        .maybeSingle();
      const e = (data as { entry_id: string | null; entries?: { id: string; title: string } | null } | null);
      setAiBriefEntryId(e?.entry_id ?? null);
      setLinkedEntry(e?.entries ?? null);
    })();
  }, [isOwner, briefId]);

  const openConvertDialog = async (c: Comment) => {
    setAiTarget(c);
    setAiSummary("");
    setAiSuggestions([]);
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("convert-comment-to-suggestion", {
        body: { comment_id: c.id },
      });
      if (error) {
        const ctx = (error as { context?: { status?: number } }).context;
        if (ctx?.status === 402) toast.error("Out of AI credits — top up to keep generating suggestions.");
        else if (ctx?.status === 429) toast.error("Too many requests — try again in a moment.");
        else if (ctx?.status === 403) toast.error("Brain Dump suggestions require the Pro plan.");
        else toast.error("Couldn't generate suggestions.");
        setAiTarget(null);
      } else if (data) {
        setAiSummary(data.summary ?? "");
        setAiSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't reach the AI service.");
      setAiTarget(null);
    } finally {
      setAiLoading(false);
    }
  };

  const sendSuggestionToScreenplay = async (idx: number) => {
    const s = aiSuggestions[idx];
    if (!s || !aiBriefEntryId || !briefId || !aiTarget) return;
    setSendingIdx(idx);
    const formatted = [
      `💡 Suggestion from a brain dump comment`,
      `Kind: ${s.kind}${s.target ? ` · ${s.target}` : ""}`,
      `${s.title}`,
      "",
      s.suggestion,
      "",
      `Why: ${s.rationale}`,
      `Source comment by ${aiTarget.author_name}: "${aiTarget.body.slice(0, 240)}${aiTarget.body.length > 240 ? "…" : ""}"`,
    ].join("\n");
    const { error } = await supabase.rpc("post_entry_brief_message", {
      p_entry_id: aiBriefEntryId,
      p_body: formatted,
      p_brief_id: briefId,
      p_kind: "ai_digest",
      p_source: "ai_organize",
    });
    setSendingIdx(null);
    if (error) {
      toast.error(error.message ?? "Couldn't send to the screenplay thread.");
    } else {
      toast.success(`Sent to ${linkedEntry?.title ?? "screenplay"} thread`);
    }
  };

  const copySuggestion = async (s: AISuggestion) => {
    try {
      await navigator.clipboard.writeText(
        `${s.title}\n${s.suggestion}\n\nWhy: ${s.rationale}`,
      );
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    if (isOwner && briefId) {
      const { data, error } = await supabase
        .from("brief_comments")
        .select("id, parent_comment_id, author_name, body, created_at, hidden")
        .eq("brief_id", briefId)
        .order("created_at", { ascending: true });
      if (!error) setComments((data ?? []) as Comment[]);

      const { data: reports } = await supabase
        .from("brief_comment_reports")
        .select("id, comment_id, reason, status, appeal_status, appeal_response, created_at")
        .eq("brief_id", briefId)
        .order("created_at", { ascending: false });
      const grouped: Record<string, Report[]> = {};
      (reports ?? []).forEach((r) => {
        const rr = r as Report;
        (grouped[rr.comment_id] ||= []).push(rr);
      });
      setReportsByComment(grouped);
    } else if (shareToken) {
      const { data, error } = await supabase.rpc("list_brief_comments_by_token", {
        p_token: shareToken,
      });
      if (!error) setComments((data ?? []) as Comment[]);
    }
    setLoading(false);
  }, [shareToken, briefId, isOwner]);

  useEffect(() => { load(); }, [load]);

  const { byId, childrenOf, roots } = useMemo(() => {
    const byId = new Map<string, Comment>();
    const childrenOf = new Map<string, Comment[]>();
    comments.forEach((c) => byId.set(c.id, c));
    comments.forEach((c) => {
      if (c.parent_comment_id) {
        const arr = childrenOf.get(c.parent_comment_id) ?? [];
        arr.push(c);
        childrenOf.set(c.parent_comment_id, arr);
      }
    });
    const roots = comments.filter((c) => !c.parent_comment_id || !byId.has(c.parent_comment_id));
    return { byId, childrenOf, roots };
  }, [comments]);

  const postComment = async (parentId: string | null, n: string, b: string) => {
    if (!shareToken) return false;
    const trimmedName = n.trim();
    const trimmedBody = b.trim();
    if (!trimmedName || !trimmedBody) {
      toast.error("Please add your name and a comment.");
      return false;
    }
    setPosting(true);
    const { data: newId, error } = await supabase.rpc("post_brief_comment_by_token", {
      p_token: shareToken,
      p_author_name: trimmedName,
      p_body: trimmedBody,
      p_parent_id: parentId,
    });
    setPosting(false);
    if (error) {
      toast.error(error.message || "Could not post comment.");
      return false;
    }
    toast.success(parentId ? "Reply posted" : "Comment posted");
    // Fire-and-forget owner notification (in-app + email)
    if (newId) {
      supabase.functions
        .invoke("notify-brief-comment", {
          body: { commentId: newId, shareToken },
        })
        .catch((e) => console.warn("notify-brief-comment failed", e));
    }
    load();
    return true;
  };

  const handlePost = async () => {
    const ok = await postComment(null, name, body);
    if (ok) setBody("");
  };

  const handleReplySubmit = async () => {
    if (!replyTo) return;
    const ok = await postComment(replyTo.id, replyName || name, replyBody);
    if (ok) {
      if (!name && replyName) setName(replyName);
      setReplyBody("");
      setReplyTo(null);
    }
  };

  const submitReport = async () => {
    if (!shareToken || !reportTarget) return;
    if (!reportCategory) {
      toast.error("Please select a reason.");
      return;
    }
    setReporting(true);
    const details = reportReason.trim();
    const composed = details ? `[${reportCategory}] ${details}` : `[${reportCategory}]`;
    const { error } = await supabase.rpc("report_brief_comment_by_token", {
      p_token: shareToken,
      p_comment_id: reportTarget.id,
      p_reason: composed,
    });
    setReporting(false);
    if (error) {
      toast.error(error.message || "Could not flag comment.");
      return;
    }
    toast.success("Comment flagged for review.");
    setReportTarget(null);
    setReportReason("");
    setReportCategory("");
    load();
  };

  const toggleHide = async (c: Comment) => {
    const { error } = await supabase
      .from("brief_comments")
      .update({ hidden: !c.hidden })
      .eq("id", c.id);
    if (error) toast.error(error.message);
    else load();
  };

  const remove = async (c: Comment) => {
    const { error } = await supabase.from("brief_comments").delete().eq("id", c.id);
    if (error) toast.error(error.message);
    else load();
  };

  const updateReportStatus = async (
    commentId: string,
    status: "reviewed" | "dismissed"
  ) => {
    const { error } = await supabase
      .from("brief_comment_reports")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("comment_id", commentId)
      .eq("status", "pending");
    if (error) toast.error(error.message);
    else {
      toast.success(`Reports ${status}`);
      load();
    }
  };

  const submitAppeal = async () => {
    if (!appealTarget) return;
    const reason = appealReason.trim();
    if (reason.length < 5) {
      toast.error("Please explain why this comment should be restored.");
      return;
    }
    setAppealing(true);
    const { error } = await supabase.rpc("request_comment_report_appeal", {
      p_comment_id: appealTarget.id,
      p_reason: reason,
    });
    setAppealing(false);
    if (error) {
      toast.error(error.message || "Could not submit appeal.");
      return;
    }
    toast.success("Appeal submitted — an admin will review.");
    setAppealTarget(null);
    setAppealReason("");
    load();
  };

  const renderComment = (c: Comment): JSX.Element => {
    const reports = reportsByComment[c.id] ?? [];
    const pendingCount = reports.filter((r) => r.status === "pending").length;
    const depth = depthOf(c, byId);
    const kids = childrenOf.get(c.id) ?? [];
    const canReply = !!shareToken && !isOwner && depth < MAX_DEPTH && !c.hidden;

    return (
      <li
        key={c.id}
        className={`rounded-md border p-3 text-sm ${
          c.hidden ? "opacity-60 bg-muted/40 border-destructive/40" : "bg-background"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{c.author_name}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(c.created_at).toLocaleString()}
            </span>
            {c.hidden && (
              <Badge variant="destructive" className="text-[10px] h-4">Hidden</Badge>
            )}
            {isOwner && pendingCount > 0 && (
              <Badge variant="outline" className="text-[10px] h-4 border-destructive text-destructive">
                <ShieldAlert className="h-3 w-3 mr-0.5" />
                {pendingCount} {pendingCount === 1 ? "report" : "reports"}
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            {canReply && (
              <Button
                size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground"
                onClick={() => {
                  setReplyTo(c);
                  setReplyBody("");
                  setReplyName(name);
                }}
                title="Reply"
              >
                <Reply className="h-3.5 w-3.5" />
              </Button>
            )}
            {isOwner ? (
              <>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7 text-primary hover:text-primary"
                  onClick={() => openConvertDialog(c)}
                  title="Convert to screenplay suggestion"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => toggleHide(c)} title={c.hidden ? "Unhide" : "Hide"}>
                  <EyeOff className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => remove(c)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button
                size="icon" variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => setReportTarget(c)}
                title="Report this comment"
              >
                <Flag className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="whitespace-pre-wrap text-foreground/90">{c.body}</p>

        {replyTo?.id === c.id && (
          <div className="mt-3 space-y-2 rounded-md border border-dashed p-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Replying to <span className="font-medium">{c.author_name}</span>
              </span>
              <Button
                size="icon" variant="ghost" className="h-6 w-6"
                onClick={() => setReplyTo(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <Input
              placeholder="Your name"
              value={replyName}
              onChange={(e) => setReplyName(e.target.value)}
              maxLength={60}
              className="h-8 text-xs"
            />
            <Textarea
              placeholder="Write a reply…"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              maxLength={2000}
              rows={2}
              className="text-xs"
            />
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">{replyBody.length}/2000</span>
              <Button size="sm" onClick={handleReplySubmit} disabled={posting}>
                {posting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Post reply
              </Button>
            </div>
          </div>
        )}

        {isOwner && reports.length > 0 && (
          <div className="mt-2 pt-2 border-t border-dashed space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Reports ({reports.length})
            </div>
            <ul className="space-y-1">
              {reports.slice(0, 3).map((r) => (
                <li key={r.id} className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                  <Badge
                    variant={r.status === "pending" ? "destructive" : "secondary"}
                    className="text-[10px] h-4"
                  >
                    {r.status}
                  </Badge>
                  {r.appeal_status && r.appeal_status !== "none" && (
                    <Badge
                      variant={
                        r.appeal_status === "overturned" ? "default"
                          : r.appeal_status === "upheld" ? "destructive"
                          : "outline"
                      }
                      className="text-[10px] h-4"
                    >
                      appeal: {r.appeal_status}
                    </Badge>
                  )}
                  <span className="flex-1">{r.reason || <em>No reason given</em>}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1 flex-wrap">
              {pendingCount > 0 && (
                <>
                  <Button size="sm" variant="outline"
                    onClick={() => updateReportStatus(c.id, "reviewed")}>
                    Mark reviewed
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => updateReportStatus(c.id, "dismissed")}>
                    Dismiss reports
                  </Button>
                </>
              )}
              {reports.some((r) => r.appeal_status === "none" || r.appeal_status === "overturned" || !r.appeal_status) && (
                <Button size="sm" variant="ghost"
                  onClick={() => { setAppealTarget(c); setAppealReason(""); }}>
                  <ShieldAlert className="h-3 w-3 mr-1" />
                  Dispute reports
                </Button>
              )}
            </div>
          </div>
        )}

        {kids.length > 0 && (
          <ul className="mt-3 space-y-2 pl-4 border-l-2 border-border/60">
            {kids.map((k) => renderComment(k))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          Comments {comments.length > 0 && (
            <span className="text-muted-foreground text-sm">({comments.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : roots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="space-y-3">{roots.map((c) => renderComment(c))}</ul>
        )}

        {shareToken && !isOwner && (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Leave feedback</p>
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <Textarea
              placeholder="Share your thoughts on this brief…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{body.length}/2000</span>
              <Button size="sm" onClick={handlePost} disabled={posting}>
                {posting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Post comment
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!reportTarget} onOpenChange={(o) => {
        if (!o) {
          setReportTarget(null);
          setReportCategory("");
          setReportReason("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-4 w-4" /> Report this comment
            </DialogTitle>
          </DialogHeader>
          {reportTarget && (
            <div className="space-y-3">
              <div className="rounded border bg-muted/30 p-2 text-sm">
                <div className="text-xs text-muted-foreground mb-1">
                  {reportTarget.author_name}
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap">{reportTarget.body}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason for reporting</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {REPORT_CATEGORIES.map((cat) => {
                    const active = reportCategory === cat.value;
                    return (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={() => setReportCategory(cat.value)}
                        className={`text-left rounded border p-2 text-sm transition-colors ${
                          active
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <div className="font-medium">{cat.label}</div>
                        <div className="text-xs text-muted-foreground">{cat.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Textarea
                placeholder="Add additional details (optional)"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                maxLength={500}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Reports are sent to the brief owner. Comments with multiple reports are
                automatically hidden pending review.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => {
              setReportTarget(null);
              setReportCategory("");
              setReportReason("");
            }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={submitReport}
              disabled={reporting || !reportCategory}
            >
              {reporting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!appealTarget}
        onOpenChange={(o) => {
          if (!o) { setAppealTarget(null); setAppealReason(""); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Dispute reports
            </DialogTitle>
          </DialogHeader>
          {appealTarget && (
            <div className="space-y-3">
              <div className="rounded border bg-muted/30 p-2 text-sm">
                <div className="text-xs text-muted-foreground mb-1">
                  {appealTarget.author_name}
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap">{appealTarget.body}</p>
              </div>
              <Textarea
                placeholder="Explain why this comment should be restored or the reports were unfair (required)"
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                maxLength={1000}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Your appeal will be reviewed by an admin. Reporters will be notified
                that the report is under appeal and again when it's resolved.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAppealTarget(null); setAppealReason(""); }}>
              Cancel
            </Button>
            <Button onClick={submitAppeal} disabled={appealing || appealReason.trim().length < 5}>
              {appealing && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Submit appeal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!aiTarget}
        onOpenChange={(o) => {
          if (!o) {
            setAiTarget(null);
            setAiSummary("");
            setAiSuggestions([]);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI suggestions from this comment
            </DialogTitle>
          </DialogHeader>
          {aiTarget && (
            <div className="space-y-3">
              <div className="rounded border bg-muted/30 p-2 text-sm">
                <div className="text-xs text-muted-foreground mb-1">{aiTarget.author_name}</div>
                <p className="line-clamp-4 whitespace-pre-wrap">{aiTarget.body}</p>
              </div>

              {linkedEntry ? (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FileText className="h-3 w-3 text-primary" />
                  Linked screenplay: <span className="font-medium text-foreground">{linkedEntry.title}</span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  Tip: link this brief to a screenplay to send suggestions straight into its thread.
                </div>
              )}

              {aiLoading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating actionable suggestions…
                </div>
              ) : aiSuggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  {aiSummary || "No actionable suggestions found in this comment."}
                </p>
              ) : (
                <>
                  {aiSummary && (
                    <p className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-2">
                      {aiSummary}
                    </p>
                  )}
                  <ul className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                    {aiSuggestions.map((s, idx) => (
                      <li key={idx} className="rounded-md border p-3 space-y-1.5 bg-background">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="font-medium text-sm">{s.title}</div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                              {s.kind.replace(/_/g, " ")}
                            </Badge>
                            {s.target && (
                              <Badge variant="secondary" className="text-[10px]">{s.target}</Badge>
                            )}
                            <Badge variant="outline" className="text-[10px]">
                              {(s.confidence * 100).toFixed(0)}%
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{s.suggestion}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Why:</span> {s.rationale}
                        </p>
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            size="sm" variant="outline"
                            onClick={() => copySuggestion(s)}
                          >
                            <Copy className="h-3 w-3 mr-1" /> Copy
                          </Button>
                          {aiBriefEntryId && (
                            <Button
                              size="sm"
                              onClick={() => sendSuggestionToScreenplay(idx)}
                              disabled={sendingIdx === idx}
                            >
                              {sendingIdx === idx
                                ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                : <Send className="h-3 w-3 mr-1" />}
                              Send to screenplay thread
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAiTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
