import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquarePlus, Reply, Trash2, Pencil, X, Check, CheckCircle2, RotateCcw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useJudgePanelComments, JudgePanelComment } from "@/hooks/useJudgePanelComments";

interface Props {
  entryId: string;
  competitionId: string | null;
  dimensions: { key: string; label: string }[];
  onUnresolvedChange?: (count: number) => void;
  onUnresolvedBreakdownChange?: (byDimension: Record<string, number>) => void;
  focusDimension?: string | null;
  focusCommentId?: string | null;
}

export function PanelDiscussion({
  entryId,
  competitionId,
  dimensions,
  onUnresolvedChange,
  onUnresolvedBreakdownChange,
  focusDimension,
  focusCommentId,
}: Props) {
  const { user } = useAuth();
  const { comments, loading, post, remove, edit, setResolved, unresolvedCount, unresolvedByDimension } =
    useJudgePanelComments(entryId, competitionId);

  // notify parent when unresolved count changes
  useEffect(() => {
    onUnresolvedChange?.(unresolvedCount);
  }, [unresolvedCount, onUnresolvedChange]);
  useEffect(() => {
    onUnresolvedBreakdownChange?.(unresolvedByDimension);
  }, [unresolvedByDimension, onUnresolvedBreakdownChange]);
  useEffect(() => {
    if (focusDimension !== undefined && focusDimension !== null) {
      setDim(focusDimension === "__general__" ? "general" : focusDimension);
    }
  }, [focusDimension]);

  // Scroll to and highlight a focused comment
  useEffect(() => {
    if (!focusCommentId) return;
    const el = document.querySelector(`[data-comment-id="${focusCommentId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
      const t = setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [focusCommentId]);
  const [body, setBody] = useState("");
  const [dim, setDim] = useState<string>("general");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  const byParent = useMemo(() => {
    const m = new Map<string | null, JudgePanelComment[]>();
    for (const c of comments) {
      const k = c.parent_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return m;
  }, [comments]);

  const dimensionLabel = (key: string | null) =>
    !key ? "General" : dimensions.find((d) => d.key === key)?.label || key;

  const handlePost = async () => {
    if (!body.trim()) return;
    setPosting(true);
    const ok = await post(body, { dimensionKey: dim === "general" ? null : dim });
    setPosting(false);
    if (ok) {
      setBody("");
      setDim("general");
    }
  };

  const handleReply = async (parentId: string, parentDim: string | null) => {
    if (!replyBody.trim()) return;
    const ok = await post(replyBody, { parentId, dimensionKey: parentDim });
    if (ok) {
      setReplyBody("");
      setReplyTo(null);
    }
  };

  const renderThread = (parentId: string | null, depth = 0): JSX.Element[] => {
    const list = byParent.get(parentId) ?? [];
    return list.flatMap((c) => {
      const mine = c.author_id === user?.id;
      const isEditing = editingId === c.id;
      return [
      <div
        key={c.id}
        data-comment-id={c.id}
        className={`rounded-md border p-3 ${
          depth > 0 ? "ml-6 mt-2" : "mt-2"
        } ${c.resolved_at ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/40 bg-background/30"}`}
      >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-mono text-muted-foreground">{c.author_name}</span>
              {c.dimension_key && depth === 0 && (
                <Badge variant="outline" className="text-[9px] font-mono">
                  {dimensionLabel(c.dimension_key)}
                </Badge>
              )}
              {depth === 0 && c.resolved_at && (
                <Badge
                  variant="outline"
                  className="text-[9px] font-mono bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                >
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> resolved
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                {new Date(c.created_at).toLocaleString()}
                {c.edited_at && " · edited"}
              </span>
            </div>
            {!isEditing && (
              <div className="flex gap-1">
                {depth === 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] font-mono uppercase"
                    onClick={() => setResolved(c.id, !c.resolved_at)}
                    title={c.resolved_at ? "Reopen thread" : "Mark thread resolved"}
                  >
                    {c.resolved_at ? (
                      <><RotateCcw className="h-3 w-3 mr-1" /> Reopen</>
                    ) : (
                      <><CheckCircle2 className="h-3 w-3 mr-1" /> Resolve</>
                    )}
                  </Button>
                )}
                {mine && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditingBody(c.body);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(c.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editingBody}
                onChange={(e) => setEditingBody(e.target.value)}
                rows={3}
                maxLength={4000}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                  <X className="h-3 w-3 mr-1" /> Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    await edit(c.id, editingBody);
                    setEditingId(null);
                  }}
                >
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">{c.body}</p>
          )}
          {!isEditing && depth < 4 && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setReplyTo(replyTo === c.id ? null : c.id);
                  setReplyBody("");
                }}
              >
                <Reply className="h-3 w-3 mr-1" />
                {replyTo === c.id ? "Cancel reply" : "Reply"}
              </Button>
              {replyTo === c.id && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={2}
                    placeholder="Write a reply…"
                    maxLength={4000}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => handleReply(c.id, c.dimension_key)}>
                      Reply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>,
        ...renderThread(c.id, depth + 1),
      ];
    });
  };

  return (
    <div className="mt-4 border border-border/40 rounded-md p-3 bg-background/20">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Panel discussion · {comments.length}
        </div>
        {unresolvedCount > 0 ? (
          <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-300 text-[10px] font-mono">
            {unresolvedCount} unresolved · finalize blocked
          </Badge>
        ) : comments.length > 0 ? (
          <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[10px] font-mono">
            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> all threads resolved
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setDim("general")}
            className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${
              dim === "general"
                ? "border-primary text-primary bg-primary/10"
                : "border-border/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            General
          </button>
          {dimensions.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDim(d.key)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${
                dim === d.key
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={`Add a ${dim === "general" ? "general" : dimensionLabel(dim)} comment for the panel…`}
        />
        <div className="flex justify-end">
          <Button size="sm" disabled={posting || !body.trim()} onClick={handlePost}>
            <MessageSquarePlus className="h-3.5 w-3.5 mr-1.5" />
            {posting ? "Posting…" : "Post comment"}
          </Button>
        </div>
      </div>

      {loading && comments.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">Loading discussion…</div>
      ) : comments.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          No comments yet. Start the conversation.
        </div>
      ) : (
        <div>{renderThread(null)}</div>
      )}
    </div>
  );
}
