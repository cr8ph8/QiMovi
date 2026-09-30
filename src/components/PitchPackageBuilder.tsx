/**
 * PitchPackageBuilder — structured pitch workspace allowing writers to
 * assemble, edit, and export pitch materials using canonical project data.
 * No auto-generated claims or invented comparables.
 */
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FountainParseResult } from "@/lib/fountain-parser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  FileText, Save, Download, Info, Loader2, Copy, Check,
  BookOpen, Users, Palette, Globe, Sparkles, Quote,
} from "lucide-react";

/* ── types ── */
interface PitchField {
  key: string;
  label: string;
  icon: React.ElementType;
  hint: string;
  multiline: boolean;
}

const PITCH_FIELDS: PitchField[] = [
  { key: "logline", label: "Logline", icon: Quote, hint: "A one- or two-sentence summary of the story's core premise.", multiline: false },
  { key: "synopsis", label: "Synopsis", icon: BookOpen, hint: "A concise narrative summary of the story arc.", multiline: true },
  { key: "character_summaries", label: "Character Summaries", icon: Users, hint: "Brief descriptions of key characters and their roles.", multiline: true },
  { key: "thematic_summary", label: "Thematic Summary", icon: Sparkles, hint: "The central themes explored in the story.", multiline: true },
  { key: "world_description", label: "World Description", icon: Globe, hint: "The setting, time period, and world of the story.", multiline: true },
  { key: "tone_description", label: "Tone Description", icon: Palette, hint: "The intended tone, mood, and visual feel.", multiline: true },
  { key: "comparable_references", label: "Comparable References", icon: FileText, hint: "Optional: similar works for context (manually entered).", multiline: true },
];

interface PitchPackageBuilderProps {
  entryId: string;
  entryUserId: string;
  title: string;
  logline?: string | null;
  parsed?: FountainParseResult | null;
}

/* ── component ── */
export default function PitchPackageBuilder({
  entryId,
  entryUserId,
  title,
  logline,
  parsed,
}: PitchPackageBuilderProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOwner = user?.id === entryUserId;

  const [fields, setFields] = useState<Record<string, string>>({
    logline: "",
    synopsis: "",
    character_summaries: "",
    thematic_summary: "",
    world_description: "",
    tone_description: "",
    comparable_references: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasRecord, setHasRecord] = useState(false);
  const [copied, setCopied] = useState(false);

  // Pre-fill hints from canonical data
  const prefillData = useMemo(() => {
    const data: Record<string, string> = {};
    if (logline) data.logline = logline;
    if (parsed) {
      const chars = parsed.stats.uniqueCharacters.slice(0, 8);
      if (chars.length > 0) {
        data.character_summaries = chars.map((c) => `${c}: `).join("\n");
      }
    }
    return data;
  }, [logline, parsed]);

  const loadPitch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pitch_packages")
      .select("*")
      .eq("entry_id", entryId)
      .maybeSingle();

    if (data) {
      setHasRecord(true);
      setFields({
        logline: (data as any).logline || "",
        synopsis: (data as any).synopsis || "",
        character_summaries: (data as any).character_summaries || "",
        thematic_summary: (data as any).thematic_summary || "",
        world_description: (data as any).world_description || "",
        tone_description: (data as any).tone_description || "",
        comparable_references: (data as any).comparable_references || "",
      });
    } else {
      // Pre-fill from canonical data
      setFields((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(prefillData).filter(([k, v]) => v && !prev[k])
        ),
      }));
    }
    setLoading(false);
  }, [entryId, prefillData]);

  useEffect(() => { loadPitch(); }, [loadPitch]);

  const handleSave = async () => {
    if (!isOwner || !user) return;
    setSaving(true);
    try {
      if (hasRecord) {
        const { error } = await supabase
          .from("pitch_packages")
          .update({ ...fields, updated_at: new Date().toISOString() } as any)
          .eq("entry_id", entryId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("pitch_packages")
          .insert({ entry_id: entryId, user_id: user.id, ...fields } as any);
        if (error) throw error;
        setHasRecord(true);
      }
      toast({ title: "Pitch package saved" });
    } catch (e: any) {
      toast({ title: "Error saving", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  // Export as formatted text
  const exportText = useCallback(() => {
    const lines: string[] = [];
    lines.push(`PITCH PACKAGE — ${title.toUpperCase()}`);
    lines.push("=".repeat(40));
    lines.push("");

    for (const f of PITCH_FIELDS) {
      const val = fields[f.key]?.trim();
      if (val) {
        lines.push(`${f.label.toUpperCase()}`);
        lines.push("-".repeat(f.label.length));
        lines.push(val);
        lines.push("");
      }
    }

    return lines.join("\n");
  }, [fields, title]);

  const handleCopyText = () => {
    navigator.clipboard.writeText(exportText()).then(() => {
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadText = () => {
    const blob = new Blob([exportText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}_pitch.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count filled fields
  const filledCount = PITCH_FIELDS.filter((f) => fields[f.key]?.trim()).length;

  if (loading) {
    return (
      <div className="p-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
        <p className="text-xs text-muted-foreground mt-2">Loading pitch workspace…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <FileText className="h-4 w-4 text-primary" />
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Pitch Package</span>
        <Badge variant="outline" className="text-[9px] font-mono">
          {filledCount}/{PITCH_FIELDS.length} sections
        </Badge>
        <div className="ml-auto flex items-center gap-1.5">
          {isOwner && (
            <Button onClick={handleSave} disabled={saving} size="sm" variant="outline" className="h-7 text-xs font-mono gap-1.5">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </Button>
          )}
          <Button onClick={handleCopyText} size="sm" variant="ghost" className="h-7 text-xs font-mono gap-1.5">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={handleDownloadText} size="sm" variant="ghost" className="h-7 text-xs font-mono gap-1.5">
            <Download className="h-3 w-3" />
            Export
          </Button>
        </div>
      </div>

      {/* Title display */}
      <div className="rounded-lg border border-border/40 bg-card/60 px-4 py-3">
        <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">Project Title</p>
        <p className="font-display text-lg font-bold text-foreground">{title}</p>
      </div>

      {/* Pitch fields */}
      <div className="space-y-3">
        {PITCH_FIELDS.map((f) => (
          <div key={f.key} className="rounded-lg border border-border/30 bg-card/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <f.icon className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-mono font-semibold text-foreground">{f.label}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-xs">{f.hint}</TooltipContent>
              </Tooltip>
              {fields[f.key]?.trim() && (
                <Badge variant="outline" className="text-[8px] font-mono ml-auto border-primary/20 text-primary">
                  Filled
                </Badge>
              )}
            </div>
            {isOwner ? (
              f.multiline ? (
                <Textarea
                  value={fields[f.key]}
                  onChange={(e) => handleFieldChange(f.key, e.target.value)}
                  placeholder={f.hint}
                  className="text-xs font-mono min-h-[80px] resize-y bg-background/50"
                  rows={4}
                />
              ) : (
                <Input
                  value={fields[f.key]}
                  onChange={(e) => handleFieldChange(f.key, e.target.value)}
                  placeholder={f.hint}
                  className="text-xs font-mono bg-background/50"
                />
              )
            ) : (
              <p className={cn(
                "text-xs font-mono whitespace-pre-wrap",
                fields[f.key]?.trim() ? "text-foreground" : "text-muted-foreground/40"
              )}>
                {fields[f.key]?.trim() || "Not filled"}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Pre-fill hint */}
      {isOwner && Object.keys(prefillData).length > 0 && !hasRecord && (
        <>
          <Separator className="opacity-30" />
          <p className="text-[10px] font-mono text-muted-foreground">
            <Info className="h-3 w-3 inline mr-1" />
            Some fields have been pre-filled from project data. Edit freely before saving.
          </p>
        </>
      )}
    </div>
  );
}
