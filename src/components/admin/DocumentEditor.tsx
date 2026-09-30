import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, Download, History, RotateCcw, Columns } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { computeDiff, computeWordDiff } from "@/lib/diff";
import type { WordSegment } from "@/lib/diff";

interface Doc {
  id: string;
  title: string;
  doc_type: string;
  content: string;
  status: string;
  version: number;
  updated_at: string;
  classification?: string;
}

interface Version {
  id: string;
  version: number;
  title: string;
  content: string;
  status: string;
  created_at: string;
}

export default function DocumentEditor({ doc, onBack }: { doc: Doc; onBack: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [status, setStatus] = useState(doc.status);
  const [classification, setClassification] = useState(doc.classification || "internal");
  const [currentVersion, setCurrentVersion] = useState(doc.version);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<Version | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const diffLines = useMemo(() => {
    if (!previewVersion || !showDiff) return null;
    return computeDiff(previewVersion.content, content);
  }, [previewVersion, showDiff, content]);

  // Pair up adjacent remove/add lines for word-level diff
  const pairedDiff = useMemo(() => {
    if (!diffLines) return null;
    const result: Array<{
      type: "equal" | "remove" | "add" | "change";
      oldText?: string;
      newText?: string;
      text?: string;
      oldSegments?: WordSegment[];
      newSegments?: WordSegment[];
    }> = [];
    let i = 0;
    while (i < diffLines.length) {
      const line = diffLines[i];
      if (line.type === "remove" && i + 1 < diffLines.length && diffLines[i + 1].type === "add") {
        // Paired change — compute word diff
        const wordSegs = computeWordDiff(line.text, diffLines[i + 1].text);
        result.push({
          type: "change",
          oldText: line.text,
          newText: diffLines[i + 1].text,
          oldSegments: wordSegs.filter(s => s.type !== "add"),
          newSegments: wordSegs.filter(s => s.type !== "remove"),
        });
        i += 2;
      } else {
        result.push({ type: line.type, text: line.text });
        i++;
      }
    }
    return result;
  }, [diffLines]);

  const fetchVersions = useCallback(async () => {
    setLoadingVersions(true);
    const { data } = await supabase
      .from("document_versions")
      .select("id, version, title, content, status, created_at")
      .eq("document_id", doc.id)
      .order("version", { ascending: false })
      .limit(50);
    setVersions((data as Version[]) || []);
    setLoadingVersions(false);
  }, [doc.id]);

  useEffect(() => {
    if (showHistory) fetchVersions();
  }, [showHistory, fetchVersions]);

  const save = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    const nextVersion = currentVersion + 1;

    // Save current state as a version snapshot
    await supabase.from("document_versions").insert({
      document_id: doc.id,
      version: currentVersion,
      title: doc.title,
      content: doc.content,
      status: doc.status,
      saved_by: user.id,
    });

    const { error } = await supabase
      .from("business_documents")
      .update({ title, content, status, classification: classification as any, version: nextVersion })
      .eq("id", doc.id);

    setSaving(false);
    if (error) {
      toast.error("Save failed");
    } else {
      setCurrentVersion(nextVersion);
      // Update doc ref for next diff check
      doc.title = title;
      doc.content = content;
      doc.status = status;
      doc.version = nextVersion;
      toast.success(`Saved (v${nextVersion})`);
      if (showHistory) fetchVersions();
    }
  }, [title, content, status, doc, currentVersion, user, showHistory, fetchVersions]);

  // Auto-save debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (title !== doc.title || content !== doc.content || status !== doc.status || classification !== (doc.classification || "internal")) save();
    }, 3000);
    return () => clearTimeout(timer);
  }, [title, content, status, save, doc]);

  const restoreVersion = async (v: Version) => {
    setTitle(v.title);
    setContent(v.content);
    setStatus(v.status);
    setPreviewVersion(null);
    toast.info(`Restored v${v.version} — save to commit`);
  };

  const handleExport = async (format: "docx" | "pptx") => {
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("export-document", {
        body: { document_id: doc.id, format },
      });
      if (error) throw error;
      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} downloaded`);
    } catch {
      toast.error("Export failed");
    }
    setExporting(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Badge variant="outline" className="font-mono text-[10px]">{doc.doc_type}</Badge>
        <Badge variant="secondary" className="font-mono text-[10px]">v{currentVersion}</Badge>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="final">Final</SelectItem>
          </SelectContent>
        </Select>
        <Select value={classification} onValueChange={setClassification}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="public" className="text-xs">Public</SelectItem>
            <SelectItem value="internal" className="text-xs">Internal</SelectItem>
            <SelectItem value="confidential" className="text-xs">Confidential</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button
            variant={showHistory ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-3.5 w-3.5 mr-1" /> History
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("docx")} disabled={exporting}>
            <Download className="h-3.5 w-3.5 mr-1" /> DOCX
          </Button>
          {doc.doc_type === "presentation" && (
            <Button variant="outline" size="sm" onClick={() => handleExport("pptx")} disabled={exporting}>
              <Download className="h-3.5 w-3.5 mr-1" /> PPTX
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className={`flex gap-4 ${showHistory ? "" : ""}`}>
        {/* Main editor */}
        <div className={`space-y-3 ${showHistory ? "flex-1 min-w-0" : "w-full"}`}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="font-display text-lg font-bold" />

          {/* Diff view */}
          {previewVersion && showDiff && pairedDiff ? (
            <div className="rounded-lg border border-border/50 bg-card/80 overflow-hidden">
              <div className="grid grid-cols-2 border-b border-border/30 bg-muted/20">
                <div className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground border-r border-border/30">
                  v{previewVersion.version} (old)
                </div>
                <div className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
                  Current (v{currentVersion})
                </div>
              </div>
              <ScrollArea className="h-[500px]">
                <div className="font-mono text-xs leading-6">
                  {pairedDiff.map((entry, i) => {
                    if (entry.type === "change") {
                      return (
                        <div key={i} className="flex bg-yellow-500/5">
                          <div className="w-1/2 px-3 py-0.5 border-r border-border/20 bg-red-500/10">
                            <span className="inline-block w-4 text-red-400 shrink-0 select-none">−</span>
                            {entry.oldSegments?.map((seg, si) => (
                              <span
                                key={si}
                                className={seg.type === "remove" ? "bg-red-500/30 text-red-200 rounded-sm px-0.5" : "text-muted-foreground"}
                              >
                                {seg.text}
                              </span>
                            ))}
                          </div>
                          <div className="w-1/2 px-3 py-0.5 bg-green-500/10">
                            <span className="inline-block w-4 text-green-400 shrink-0 select-none">+</span>
                            {entry.newSegments?.map((seg, si) => (
                              <span
                                key={si}
                                className={seg.type === "add" ? "bg-green-500/30 text-green-200 rounded-sm px-0.5" : "text-muted-foreground"}
                              >
                                {seg.text}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className={`flex ${
                          entry.type === "add"
                            ? "bg-green-500/10"
                            : entry.type === "remove"
                            ? "bg-red-500/10"
                            : ""
                        }`}
                      >
                        <div className={`w-1/2 px-3 py-0.5 border-r border-border/20 ${
                          entry.type === "add" ? "text-transparent select-none" : ""
                        }`}>
                          {entry.type === "remove" && (
                            <span className="inline-block w-4 text-red-400 shrink-0 select-none">−</span>
                          )}
                          {entry.type === "equal" && (
                            <span className="inline-block w-4 text-muted-foreground/30 shrink-0 select-none"> </span>
                          )}
                          {entry.type !== "add" && (
                            <span className={entry.type === "remove" ? "text-red-300" : "text-muted-foreground"}>
                              {entry.text || "\u00A0"}
                            </span>
                          )}
                        </div>
                        <div className={`w-1/2 px-3 py-0.5 ${
                          entry.type === "remove" ? "text-transparent select-none" : ""
                        }`}>
                          {entry.type === "add" && (
                            <span className="inline-block w-4 text-green-400 shrink-0 select-none">+</span>
                          )}
                          {entry.type === "equal" && (
                            <span className="inline-block w-4 text-muted-foreground/30 shrink-0 select-none"> </span>
                          )}
                          {entry.type !== "remove" && (
                            <span className={entry.type === "add" ? "text-green-300" : "text-muted-foreground"}>
                              {entry.text || "\u00A0"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          ) : (
            <Textarea
              value={previewVersion ? previewVersion.content : content}
              onChange={(e) => { if (!previewVersion) setContent(e.target.value); }}
              readOnly={!!previewVersion}
              className={`min-h-[500px] font-mono text-sm leading-relaxed ${previewVersion ? "bg-muted/30 border-primary/30" : ""}`}
              placeholder="Write your document in markdown…"
            />
          )}

          {previewVersion && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
              <span className="text-xs text-muted-foreground">
                Previewing v{previewVersion.version} from {new Date(previewVersion.created_at).toLocaleString()}
              </span>
              <Button
                size="sm"
                variant={showDiff ? "secondary" : "outline"}
                onClick={() => setShowDiff(!showDiff)}
              >
                <Columns className="h-3.5 w-3.5 mr-1" /> Diff
              </Button>
              <Button size="sm" variant="default" onClick={() => restoreVersion(previewVersion)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setPreviewVersion(null); setShowDiff(false); }}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Version history sidebar */}
        {showHistory && (
          <div className="w-64 shrink-0">
            <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/30 bg-muted/20">
                <span className="font-mono text-xs font-semibold text-muted-foreground">VERSION HISTORY</span>
              </div>
              <ScrollArea className="h-[540px]">
                {loadingVersions ? (
                  <p className="p-3 text-xs text-muted-foreground">Loading…</p>
                ) : versions.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No previous versions. Save to create the first snapshot.</p>
                ) : (
                  <div className="divide-y divide-border/20">
                    {versions.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setPreviewVersion(v)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors ${
                          previewVersion?.id === v.id ? "bg-accent/30" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-mono text-xs font-bold text-primary">v{v.version}</span>
                          <Badge variant="outline" className="font-mono text-[9px] h-4">{v.status}</Badge>
                        </div>
                        <p className="text-[11px] text-foreground truncate">{v.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(v.created_at).toLocaleDateString()} {new Date(v.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
