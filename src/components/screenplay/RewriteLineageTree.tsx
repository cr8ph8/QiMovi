import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Check, ChevronRight, ChevronDown, GitBranch,
  Pencil, Undo2, Eye, X, Save, Trash2, User, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { computeDiff } from "@/lib/diff";
import WordDiffLineView from "@/components/screenplay/WordDiffLineView";
import { toast } from "sonner";

interface LogRow {
  id: string;
  action: string;
  created_at: string;
  input_text: string | null;
  output_text: string | null;
  parent_log_id: string | null;
  applied: boolean;
  correlation_id: string | null;
  metadata: Record<string, any> | null;
}

interface LogNode extends LogRow {
  children: LogNode[];
}

function buildTree(logs: LogRow[]): LogNode[] {
  const map = new Map<string, LogNode>();
  logs.forEach(l => map.set(l.id, { ...l, children: [] }));

  const roots: LogNode[] = [];
  map.forEach(node => {
    if (node.parent_log_id && map.has(node.parent_log_id)) {
      map.get(node.parent_log_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortChildren = (nodes: LogNode[]) => {
    nodes.sort((a, b) => a.created_at.localeCompare(b.created_at));
    nodes.forEach(n => sortChildren(n.children));
  };
  sortChildren(roots);
  return roots;
}

function countDescendants(node: LogNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

/* ── Diff viewer ────────────────────────────────────────── */
function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = computeDiff(oldText, newText);
  return (
    <div className="rounded-md border border-border/40 bg-background text-[11px] font-mono overflow-auto max-h-60 mt-2">
      <WordDiffLineView lines={lines} />
    </div>
  );
}

/* ── Tree node ──────────────────────────────────────────── */
function TreeNode({
  node,
  depth,
  onMutate,
}: {
  node: LogNode;
  depth: number;
  onMutate: () => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showFull, setShowFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(node.output_text ?? "");
  const [showDiff, setShowDiff] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasChildren = node.children.length > 0;
  const actionLabel = node.action.replace("ai_rewrite_", "").replace(/_/g, " ");
  const descendants = countDescendants(node);
  const isReverted = !!(node.metadata as any)?.reverted;
  const isEdited = !!(node.metadata as any)?.manually_edited;

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("feature_usage_log")
      .update({
        output_text: editText,
        metadata: { ...(node.metadata ?? {}), manually_edited: true },
      } as any)
      .eq("id", node.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to save edit");
      return;
    }
    toast.success("Rewrite output updated");
    setEditing(false);
    onMutate();
  };

  const handleRevert = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("feature_usage_log")
      .update({
        applied: false,
        metadata: { ...(node.metadata ?? {}), reverted: true },
      } as any)
      .eq("id", node.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to revert");
      return;
    }
    toast.success("Rewrite reverted");
    onMutate();
  };

  const handleDelete = async () => {
    const msg = hasChildren
      ? "This rewrite has child rewrites that will become orphaned. Delete anyway?"
      : "Are you sure you want to delete this rewrite?";
    if (!window.confirm(msg)) return;
    setSaving(true);
    const { error } = await supabase
      .from("feature_usage_log")
      .delete()
      .eq("id", node.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Rewrite deleted");
    onMutate();
  };

  return (
    <div className="relative">
      {depth > 0 && (
        <div className="absolute left-0 top-0 bottom-0 w-px bg-primary/20" />
      )}

      <div
        className={cn(
          "relative rounded-lg border bg-muted/20 p-3 text-xs transition-colors",
          depth > 0 ? "ml-5" : "",
          isReverted
            ? "border-l-2 border-l-orange-500/60 border-border/30"
            : node.applied
              ? "border-l-2 border-l-green-500/60 border-border/30"
              : "border-border/30",
        )}
      >
        {depth > 0 && (
          <div className="absolute -left-5 top-4 w-4 h-px bg-primary/20" />
        )}

        {/* Header row */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {hasChildren ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          ) : (
            <div className="w-4" />
          )}

          <Badge variant="outline" className="text-[10px] font-mono capitalize">
            {actionLabel}
          </Badge>

          {(node.metadata as any)?.manual ? (
            <Badge variant="outline" className="text-[10px] bg-accent/40 text-primary border-primary/30">
              <User className="h-3 w-3 mr-0.5" /> Human
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-secondary/40 text-secondary-foreground border-secondary/50">
              <Sparkles className="h-3 w-3 mr-0.5" /> AI
            </Badge>
          )}

          {node.applied && !isReverted && (
            <span className="flex items-center gap-0.5 text-[10px] text-green-500">
              <Check className="h-3 w-3" /> applied
            </span>
          )}
          {isReverted && (
            <span className="flex items-center gap-0.5 text-[10px] text-orange-500">
              <Undo2 className="h-3 w-3" /> reverted
            </span>
          )}
          {isEdited && (
            <span className="flex items-center gap-0.5 text-[10px] text-blue-400">
              <Pencil className="h-3 w-3" /> edited
            </span>
          )}

          {hasChildren && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {descendants}
            </span>
          )}

          <span className="ml-auto text-[10px] font-mono text-muted-foreground">
            {new Date(node.created_at).toLocaleString()}
          </span>
        </div>

        {/* Input text */}
        {node.input_text && (
          <p className="text-muted-foreground mb-1">
            <span className="text-foreground font-semibold">In:</span>{" "}
            {showFull ? node.input_text : node.input_text.slice(0, 200)}
            {!showFull && node.input_text.length > 200 && "…"}
          </p>
        )}

        {/* Output text / edit mode */}
        {editing ? (
          <div className="space-y-2 mt-1">
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="text-xs min-h-[100px] bg-background"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="default" onClick={handleSave} disabled={saving} className="h-7 text-xs gap-1">
                <Save className="h-3 w-3" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditText(node.output_text ?? ""); }} className="h-7 text-xs gap-1">
                <X className="h-3 w-3" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          node.output_text && (
            <p className="text-muted-foreground">
              <span className="text-foreground font-semibold">Out:</span>{" "}
              {showFull ? node.output_text : node.output_text.slice(0, 200)}
              {!showFull && node.output_text.length > 200 && "…"}
            </p>
          )
        )}

        {/* Expand / collapse long text */}
        {((node.input_text && node.input_text.length > 200) ||
          (node.output_text && node.output_text.length > 200)) && (
          <button
            onClick={() => setShowFull(!showFull)}
            className="text-[10px] text-primary hover:underline mt-1"
          >
            {showFull ? "collapse" : "show full"}
          </button>
        )}

        {/* Diff view */}
        {showDiff && node.input_text && node.output_text && (
          <InlineDiff oldText={node.input_text} newText={node.output_text} />
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 mt-2 border-t border-border/20 pt-2">
          {!editing && node.output_text && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 px-2"
              onClick={() => { setEditing(true); setEditText(node.output_text ?? ""); }}
            >
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
          {node.applied && !isReverted && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] gap-1 px-2 text-orange-500 hover:text-orange-400"
              onClick={handleRevert}
              disabled={saving}
            >
              <Undo2 className="h-3 w-3" /> Revert
            </Button>
          )}
          {node.input_text && node.output_text && (
            <Button
              size="sm"
              variant={showDiff ? "secondary" : "ghost"}
              className="h-6 text-[10px] gap-1 px-2"
              onClick={() => setShowDiff(!showDiff)}
            >
              <Eye className="h-3 w-3" /> {showDiff ? "Hide Diff" : "Diff"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] gap-1 px-2 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={saving}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </Button>
        </div>
      </div>

      {expanded && hasChildren && (
        <div className={cn("relative", depth > 0 ? "ml-5" : "")}>
          <div className="absolute left-0 top-0 bottom-0 w-px bg-primary/20" />
          <div className="space-y-2 pt-2">
            {node.children.map(child => (
              <TreeNode key={child.id} node={child} depth={depth + 1} onMutate={onMutate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */
export default function RewriteLineageTree({
  entryId,
  refreshKey,
}: {
  entryId: string;
  refreshKey?: number;
}) {
  const [roots, setRoots] = useState<LogNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey(k => k + 1), []);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("feature_usage_log")
      .select("id, action, created_at, input_text, output_text, parent_log_id, applied, correlation_id, metadata")
      .eq("entry_id", entryId)
      .like("action", "ai_rewrite_%")
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => {
        setRoots(buildTree((data as LogRow[]) || []));
        setLoading(false);
      });
  }, [entryId, fetchKey, refreshKey]);

  if (loading || roots.length === 0) return null;

  const totalNodes = roots.reduce((s, r) => s + 1 + countDescendants(r), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
        <GitBranch className="h-3 w-3" />
        <span>
          {totalNodes} rewrite{totalNodes !== 1 ? "s" : ""} across{" "}
          {roots.length} chain{roots.length !== 1 ? "s" : ""}
        </span>
      </div>
      {roots.map(root => (
        <TreeNode key={root.id} node={root} depth={0} onMutate={refetch} />
      ))}
    </div>
  );
}
