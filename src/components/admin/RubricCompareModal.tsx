import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCompareArrows } from "lucide-react";
import { buildDiffRows, summarizeDiff } from "@/lib/rubric-diff";
import RubricDiffTable from "./RubricDiffTable";
import RubricImpactPanel from "./RubricImpactPanel";

interface RubricVersionRow {
  id: string;
  preset_id: string;
  version: number;
  label: string | null;
  definition: any;
  created_at: string;
}

interface RubricCompareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPreset?: string;
}

export default function RubricCompareModal({
  open,
  onOpenChange,
  initialPreset,
}: RubricCompareModalProps) {
  const [versions, setVersions] = useState<RubricVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<string>(initialPreset ?? "");
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("");

  // Load all versions on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("rubric_versions")
        .select("id, preset_id, version, label, definition, created_at")
        .order("preset_id", { ascending: true })
        .order("version", { ascending: true });
      const list = (data as RubricVersionRow[]) || [];
      setVersions(list);
      setLoading(false);
    })();
  }, [open]);

  const presets = useMemo(
    () => [...new Set(versions.map((v) => v.preset_id))].sort(),
    [versions],
  );

  // Default preset selection
  useEffect(() => {
    if (!preset && presets.length) {
      setPreset(initialPreset && presets.includes(initialPreset) ? initialPreset : presets[0]);
    }
  }, [presets, preset, initialPreset]);

  const presetVersions = useMemo(
    () => versions.filter((v) => v.preset_id === preset),
    [versions, preset],
  );

  // When preset changes, default the two selectors to oldest vs latest.
  useEffect(() => {
    if (!presetVersions.length) {
      setLeftId("");
      setRightId("");
      return;
    }
    const oldest = presetVersions[0];
    const latest = presetVersions[presetVersions.length - 1];
    setLeftId(oldest.id);
    setRightId(latest.id);
  }, [preset, presetVersions]);

  const left = presetVersions.find((v) => v.id === leftId);
  const right = presetVersions.find((v) => v.id === rightId);

  const diffRows = useMemo(() => {
    if (!left || !right) return [];
    return buildDiffRows(left.definition, right.definition);
  }, [left, right]);

  const summary = useMemo(() => summarizeDiff(diffRows), [diffRows]);
  const sameVersion = left && right && left.id === right.id;

  const versionLabel = (v: RubricVersionRow) =>
    `v${v.version}${v.label ? ` — ${v.label}` : ""} · ${new Date(v.created_at).toLocaleDateString()}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-primary" />
            Compare rubric versions
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pick any two snapshots of the same preset to see field-level differences.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preset + version pickers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Preset
              </label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger className="h-9 bg-muted border-border">
                  <SelectValue placeholder="Select preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Left (previous)
              </label>
              <Select value={leftId} onValueChange={setLeftId} disabled={!presetVersions.length}>
                <SelectTrigger className="h-9 bg-muted border-border">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {presetVersions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{versionLabel(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Right (new)
              </label>
              <Select value={rightId} onValueChange={setRightId} disabled={!presetVersions.length}>
                <SelectTrigger className="h-9 bg-muted border-border">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {presetVersions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{versionLabel(v)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary chips */}
          {left && right && !sameVersion && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/40 text-emerald-300">
                +{summary.added} added
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-destructive/40 text-destructive">
                −{summary.removed} removed
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 text-amber-300">
                {summary.changed} changed
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                {summary.equal} unchanged
              </Badge>
            </div>
          )}

          {/* Diff body + impact */}
          <ScrollArea className="max-h-[60vh] pr-2">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !presetVersions.length ? (
              <div className="text-sm text-muted-foreground italic text-center py-8">
                No versions recorded for this preset yet.
              </div>
            ) : sameVersion ? (
              <div className="text-sm text-muted-foreground italic text-center py-8">
                Pick two different versions to see a diff.
              </div>
            ) : left && right ? (
              <div className="space-y-4">
                <RubricImpactPanel
                  preset={preset}
                  leftVersion={left.version}
                  rightVersion={right.version}
                />
                <RubricDiffTable
                  rows={diffRows}
                  prevHeader={`${preset} v${left.version}`}
                  nextHeader={`${preset} v${right.version}`}
                  emptyMessage="Both versions have identical structure."
                />
              </div>
            ) : null}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
