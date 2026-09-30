import { useEffect, useRef, useState } from "react";
import {
  Loader2, Upload, FileText, Trash2, CheckCircle2, AlertTriangle, FileAudio,
  FileVideo, FileImage, File as FileIcon, Sparkles, RotateCcw, Clock,
  ChevronDown, ChevronUp, ScrollText, User, Tag, BookOpen, Quote, Link2Off
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PAID_AI_SECURITY_HOLD, PAID_AI_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

export type BrainDumpFileStructured = {
  logline?: string;
  genre?: string;
  synopsis?: string;
  themes?: string[];
  characters?: Array<{ name: string; role?: string; description?: string }>;
  doc_type?: string;
  confidence?: number;
  field_confidence?: Record<string, number>;
  field_sources?: Record<string, Array<{ snippet: string; start?: number; end?: number; verified?: boolean }>>;
  parsed_at?: string;
  model_id?: string;
};

export type BrainDumpFile = {
  id: string;
  filename: string;
  mime_type: string | null;
  byte_size: number | null;
  storage_path: string;
  extracted_text: string | null;
  extraction_status: "pending" | "done" | "skipped" | "error";
  extraction_error: string | null;
  char_count: number | null;
  created_at: string;
  brief_id: string | null;
  structured: BrainDumpFileStructured | null;
  structured_status: "pending" | "done" | "skipped" | "error" | null;
  structured_error: string | null;
  structured_parsed_at: string | null;
  content_hash?: string | null;
};

type QueueStatus = "queued" | "hashing" | "uploading" | "extracting" | "done" | "failed" | "deduped";
type QueueItem = {
  id: string;
  name: string;
  size: number;
  status: QueueStatus;
  error?: string;
  file: File; // kept for retry
};

const ACCEPT =
  ".pdf,.txt,.md,.markdown,.fountain,.fdx,.rtf,.csv,.json,.html,.htm,.xml,.srt,.vtt,.docx,.doc,.xlsx,.pptx,.mp3,.wav,.m4a,.ogg,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB per file
const LOW_CONFIDENCE_THRESHOLD = 0.65;

function confidenceColor(value: number) {
  if (value >= 0.85) return "text-emerald-400 bg-emerald-500/10";
  if (value >= LOW_CONFIDENCE_THRESHOLD) return "text-amber-400 bg-amber-500/10";
  return "text-destructive bg-destructive/10";
}

function ConfidenceBadge({ value }: { value: number }) {
  const cls = confidenceColor(value);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {value < LOW_CONFIDENCE_THRESHOLD && <AlertTriangle className="h-2.5 w-2.5" />}
      {(value * 100).toFixed(0)}%
    </span>
  );
}

function LowConfidenceBanner({
  confidence,
  onReparse,
  disabled,
}: {
  confidence: number;
  onReparse: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2.5">
      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-destructive">
          Low-confidence parse ({(confidence * 100).toFixed(0)}%)
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Some extracted fields may be inaccurate. Consider re-parsing with a different model or after editing the source text.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs shrink-0 border-destructive/30 hover:bg-destructive/10"
        disabled={disabled}
        onClick={onReparse}
      >
        <Sparkles className="h-3 w-3 mr-1" /> Re-parse
      </Button>
    </div>
  );
}

function humanSize(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIconFor(mime: string | null, name: string) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("audio/")) return FileAudio;
  if (m.startsWith("video/")) return FileVideo;
  if (m.startsWith("image/")) return FileImage;
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return FileText;
  if (m.startsWith("text/") || /\.(txt|md|fountain|fdx|csv|json|rtf|srt|vtt)$/i.test(name)) return FileText;
  return FileIcon;
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function statusBadge(status: QueueStatus) {
  const map: Record<QueueStatus, { label: string; cls: string; icon: any }> = {
    queued: { label: "Queued", cls: "bg-muted text-muted-foreground", icon: Clock },
    hashing: { label: "Hashing", cls: "bg-muted text-muted-foreground", icon: Loader2 },
    uploading: { label: "Uploading", cls: "bg-primary/10 text-primary", icon: Loader2 },
    extracting: { label: "Extracting", cls: "bg-primary/10 text-primary", icon: Loader2 },
    done: { label: "Done", cls: "bg-emerald-500/10 text-emerald-400", icon: CheckCircle2 },
    deduped: { label: "Reused", cls: "bg-emerald-500/10 text-emerald-400", icon: CheckCircle2 },
    failed: { label: "Failed", cls: "bg-destructive/10 text-destructive", icon: AlertTriangle },
  };
  const m = map[status];
  const Icon = m.icon;
  const spin = status === "hashing" || status === "uploading" || status === "extracting";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${m.cls}`}>
      <Icon className={`h-2.5 w-2.5 ${spin ? "animate-spin" : ""}`} /> {m.label}
    </span>
  );
}

interface Props {
  briefId: string | null;
  onExtracted: (text: string, filename: string) => void;
}

export function BrainDumpUploader({ briefId, onExtracted }: Props) {
  const { user } = useAuth();
  const [files, setFiles] = useState<BrainDumpFile[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFullTextFor, setShowFullTextFor] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{
    fileId: string;
    snippet: string;
    occurrences: Array<{ start: number; end: number }>;
    activeIndex: number;
  } | null>(null);
  const previewRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const markRefs = useRef<Map<string, HTMLElement>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!highlight) return;
    const key = `${highlight.fileId}:${highlight.activeIndex}`;
    const mark = markRefs.current.get(key);
    if (mark) {
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlight]);

  const findAllOccurrences = (text: string, snippet: string): Array<{ start: number; end: number }> => {
    if (!text || !snippet) return [];
    const out: Array<{ start: number; end: number }> = [];
    let from = 0;
    const max = 200;
    while (out.length < max) {
      const idx = text.indexOf(snippet, from);
      if (idx < 0) break;
      out.push({ start: idx, end: idx + snippet.length });
      from = idx + Math.max(1, snippet.length);
    }
    return out;
  };

  const fetchFiles = async () => {
    if (!user) return;
    let q = supabase
      .from("brain_dump_files")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (briefId) q = q.eq("brief_id", briefId);
    else q = q.is("brief_id", null);
    const { data } = await q;
    if (data) setFiles(data as BrainDumpFile[]);
  };

  useEffect(() => {
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, briefId]);

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const processOne = async (item: QueueItem) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    if (!user) return;
    const file = item.file;

    // Compute SHA-256 content hash for dedupe.
    updateQueueItem(item.id, { status: "hashing", error: undefined });
    let contentHash: string | null = null;
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      contentHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      contentHash = null;
    }

    // Short-circuit: if a matching extraction already exists, reuse it.
    if (contentHash) {
      const { data: existing } = await supabase
        .from("brain_dump_files")
        .select("*")
        .eq("content_hash", contentHash)
        .in("extraction_status", ["done", "skipped"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        const e = existing as BrainDumpFile;
        setFiles((prev) => (prev.some((x) => x.id === e.id) ? prev : [e, ...prev]));
        if (e.extraction_status === "done" && e.extracted_text) {
          onExtracted(e.extracted_text, file.name);
          toast.success(`${file.name} already ingested — reused ${e.extracted_text.length.toLocaleString()} chars.`);
        } else {
          toast.message(`${file.name} already on file — reused existing record.`);
        }
        updateQueueItem(item.id, { status: "deduped" });
        return;
      }
    }

    updateQueueItem(item.id, { status: "uploading" });
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(file.name)}`;
    const { error: upErr } = await supabase.storage
      .from("brain-dump-files")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
    if (upErr) {
      updateQueueItem(item.id, { status: "failed", error: `Upload: ${upErr.message}` });
      toast.error(`Upload failed for ${file.name}: ${upErr.message}`);
      return;
    }

    updateQueueItem(item.id, { status: "extracting" });
    const { data, error } = await supabase.functions.invoke("ingest-brain-dump-file", {
      body: {
        storage_path: path,
        filename: file.name,
        mime_type: file.type || "",
        byte_size: file.size,
        brief_id: briefId,
        content_hash: contentHash,
      },
    });
    if (error) {
      updateQueueItem(item.id, { status: "failed", error: `Ingest: ${error.message}` });
      toast.error(`Ingest failed for ${file.name}: ${error.message}`);
      return;
    }
    const payload = data as { extracted_text?: string; status?: string; file?: BrainDumpFile; deduped?: boolean };
    if (payload?.file) {
      setFiles((prev) => {
        const f = payload.file as BrainDumpFile;
        return prev.some((x) => x.id === f.id) ? prev : [f, ...prev];
      });
    }
    if (payload?.deduped && payload.extracted_text) {
      onExtracted(payload.extracted_text, file.name);
      toast.success(`${file.name} already ingested — reused ${payload.extracted_text.length.toLocaleString()} chars.`);
      updateQueueItem(item.id, { status: "deduped" });
    } else if (payload?.status === "done" && payload.extracted_text) {
      onExtracted(payload.extracted_text, file.name);
      toast.success(`Added ${payload.extracted_text.length.toLocaleString()} chars from ${file.name}.`);
      if (payload.file?.id) runParse(payload.file.id, { silent: true });
      updateQueueItem(item.id, { status: "done" });
    } else if (payload?.status === "skipped") {
      toast.message(`${file.name} stored. Extraction skipped.`);
      updateQueueItem(item.id, { status: "done" });
    } else if (payload?.status === "error") {
      updateQueueItem(item.id, { status: "failed", error: "Extraction failed" });
      toast.error(`${file.name} stored but extraction failed.`);
    } else {
      updateQueueItem(item.id, { status: "done" });
    }
  };

  const handleFiles = async (list: FileList | File[]) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    if (!user) return;
    const arr = Array.from(list);
    if (arr.length === 0) return;

    const accepted: QueueItem[] = [];
    for (const file of arr) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} exceeds 20MB limit.`);
        continue;
      }
      accepted.push({
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        status: "queued",
        file,
      });
    }
    if (accepted.length === 0) return;
    setQueue((prev) => [...accepted, ...prev]);
    setUploading(true);
    try {
      for (const item of accepted) {
        await processOne(item);
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const retryQueueItem = async (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setUploading(true);
    try {
      await processOne(item);
    } finally {
      setUploading(false);
    }
  };

  const clearFinishedQueue = () => {
    setQueue((prev) => prev.filter((q) => q.status !== "done" && q.status !== "deduped"));
  };

  const retryStoredFile = async (f: BrainDumpFile) => {
    if (PAID_AI_SECURITY_HOLD) {
      toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    setRetryingId(f.id);
    setFiles((prev) =>
      prev.map((x) => (x.id === f.id ? { ...x, extraction_status: "pending", extraction_error: null } : x)),
    );
    try {
      const { data, error } = await supabase.functions.invoke("ingest-brain-dump-file", {
        body: {
          storage_path: f.storage_path,
          filename: f.filename,
          mime_type: f.mime_type || "",
          byte_size: f.byte_size,
          brief_id: f.brief_id,
          content_hash: f.content_hash ?? null,
          existing_file_id: f.id,
        },
      });
      if (error) {
        toast.error(`Retry failed: ${error.message}`);
        setFiles((prev) =>
          prev.map((x) => (x.id === f.id ? { ...x, extraction_status: "error", extraction_error: error.message } : x)),
        );
        return;
      }
      const payload = data as { extracted_text?: string; status?: string; file?: BrainDumpFile };
      if (payload?.file) {
        setFiles((prev) => prev.map((x) => (x.id === f.id ? (payload.file as BrainDumpFile) : x)));
      }
      if (payload?.status === "done" && payload.extracted_text) {
        onExtracted(payload.extracted_text, f.filename);
        toast.success(`Retried ${f.filename} — extracted ${payload.extracted_text.length.toLocaleString()} chars.`);
        if (payload.file?.id) runParse(payload.file.id, { silent: true });
      } else if (payload?.status === "skipped") {
        toast.message(`${f.filename} stored. Extraction skipped.`);
      } else if (payload?.status === "error") {
        toast.error(`Retry failed for ${f.filename}.`);
      }
    } finally {
      setRetryingId(null);
    }
  };

  const runParse = async (fileId: string, opts: { silent?: boolean } = {}) => {
    if (PAID_AI_SECURITY_HOLD) {
      if (!opts.silent) toast.error(PAID_AI_SECURITY_MESSAGE);
      return;
    }
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, structured_status: "pending" } : f)),
    );
    if (!opts.silent) toast.message("Parsing structured fields…");
    const { data, error } = await supabase.functions.invoke("parse-brain-dump-file", {
      body: { file_id: fileId },
    });
    if (error) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, structured_status: "error", structured_error: error.message } : f,
        ),
      );
      if (!opts.silent) toast.error(`Parse failed: ${error.message}`);
      return;
    }
    const payload = data as { structured?: BrainDumpFileStructured; file?: BrainDumpFile; status?: string };
    if (payload?.file) {
      setFiles((prev) => prev.map((f) => (f.id === fileId ? (payload.file as BrainDumpFile) : f)));
    }
    if (payload?.status === "skipped") {
      if (!opts.silent) toast.message("Skipped: not enough text to parse.");
    } else if (payload?.structured) {
      if (!opts.silent) toast.success("Structured fields parsed.");
    }
  };

  const handleDelete = async (f: BrainDumpFile) => {
    const { error: stErr } = await supabase.storage.from("brain-dump-files").remove([f.storage_path]);
    if (stErr) {
      toast.error(`Could not remove file: ${stErr.message}`);
      return;
    }
    const { error } = await supabase.from("brain_dump_files").delete().eq("id", f.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    toast.success("File removed.");
  };

  const reinsertText = (f: BrainDumpFile) => {
    if (!f.extracted_text) {
      toast.error("No extracted text available for this file.");
      return;
    }
    onExtracted(f.extracted_text, f.filename);
    toast.success(`Re-inserted text from ${f.filename}.`);
  };

  const activeQueue = queue.filter((q) => q.status !== "done" && q.status !== "deduped");
  const finishedCount = queue.length - activeQueue.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display text-lg">Upload Source Files</CardTitle>
        <span className="text-xs text-muted-foreground">{files.length} stored</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          className={`rounded-lg border border-dashed p-6 text-center transition ${
            dragOver ? "border-primary bg-primary/5" : "border-border/60"
          }`}
        >
          <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Drop PDFs, text files, scripts, notes, audio or video here.
          </p>
          <p className="text-xs text-muted-foreground">
            Raw files are stored privately. Text is auto-extracted from PDFs and text files.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={PAID_AI_SECURITY_HOLD || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>
        </div>

        {queue.length > 0 && (
          <div className="space-y-1.5 rounded-md border border-border/50 p-2">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-medium text-muted-foreground">
                Ingestion queue · {activeQueue.length} active
              </p>
              {finishedCount > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearFinishedQueue}>
                  Clear finished
                </Button>
              )}
            </div>
            {queue.map((q) => (
              <div key={q.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate">{q.name}</span>
                    {statusBadge(q.status)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {humanSize(q.size)}
                    {q.error ? ` · ${q.error}` : ""}
                  </div>
                </div>
                {q.status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={uploading}
                    onClick={() => retryQueueItem(q.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Retry
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f) => {
              const Icon = fileIconFor(f.mime_type, f.filename);
              const s = f.structured ?? null;
              const isExpanded = expandedId === f.id;
              const textPreviewLimit = 1200;
              const showFullText = showFullTextFor === f.id;
              return (
                <div
                  key={f.id}
                  className="flex flex-col gap-2 rounded-md border border-border/50 p-2"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="truncate font-medium">{f.filename}</span>
                        {f.extraction_status === "done" && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        )}
                        {f.extraction_status === "error" && (
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                        )}
                        {f.extraction_status === "skipped" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                            stored
                          </span>
                        )}
                        {f.extraction_status === "pending" && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                        )}
                        {f.structured_status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" /> parsing
                          </span>
                        )}
                        {f.structured_status === "done" && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                            <Sparkles className="h-2.5 w-2.5" /> parsed
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {humanSize(f.byte_size)}
                        {f.char_count ? ` · ${f.char_count.toLocaleString()} chars extracted` : ""}
                        {f.extraction_error ? ` · ${f.extraction_error}` : ""}
                      </div>
                    </div>
                    {f.extraction_status === "error" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={retryingId === f.id}
                        onClick={() => retryStoredFile(f)}
                      >
                        {retryingId === f.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        Retry
                      </Button>
                    )}
                    {f.extraction_status === "done" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => reinsertText(f)}
                      >
                        Re-insert
                      </Button>
                    )}
                    {f.extraction_status === "done" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={f.structured_status === "pending"}
                        onClick={() => runParse(f.id)}
                        title="Run structured parsing"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {s ? "Re-parse" : "Parse"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setExpandedId(isExpanded ? null : f.id)}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" /> Hide
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" /> Details
                        </>
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(f)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Inline teaser */}
                  {s && !isExpanded && (
                    <div className="ml-7 space-y-1 text-xs">
                      {s.logline && (
                        <p className="text-foreground/90 italic">
                          "{s.logline}"
                          {s.confidence != null && s.confidence < LOW_CONFIDENCE_THRESHOLD && (
                            <AlertTriangle className="inline-block h-3 w-3 text-destructive ml-1 -mt-0.5" />
                          )}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1">
                        {s.genre && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {s.genre}
                          </span>
                        )}
                        {s.doc_type && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                            {s.doc_type}
                          </span>
                        )}
                        {(s.themes ?? []).slice(0, 6).map((t) => (
                          <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                            {t}
                          </span>
                        ))}
                        {s.confidence != null && (
                          <ConfidenceBadge value={s.confidence} />
                        )}
                      </div>
                      {(s.characters ?? []).length > 0 && (
                        <p className="text-muted-foreground truncate">
                          <span className="font-medium text-foreground/80">Characters:</span>{" "}
                          {(s.characters ?? []).map((c) => c.name).slice(0, 8).join(", ")}
                        </p>
                      )}
                      {s.synopsis && (
                        <p className="text-muted-foreground line-clamp-3">{s.synopsis}</p>
                      )}
                    </div>
                  )}
                  {f.structured_status === "error" && f.structured_error && (
                    <p className="ml-7 text-xs text-destructive">Parse error: {f.structured_error}</p>
                  )}

                  {/* Expandable details drawer */}
                  {isExpanded && (
                    <div className="ml-7 mt-1 space-y-3 rounded-md bg-muted/40 p-3 text-sm">
                      {/* Structured fields */}
                      {s ? (
                        <div className="space-y-3">
                          {/* Low-confidence warning banner */}
                          {s.confidence != null && s.confidence < LOW_CONFIDENCE_THRESHOLD && (
                            <LowConfidenceBanner
                              confidence={s.confidence}
                              onReparse={() => runParse(f.id)}
                              disabled={f.structured_status === "pending"}
                            />
                          )}

                          {s.logline && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                <BookOpen className="h-3.5 w-3.5" /> Logline
                                {s.field_confidence?.logline != null && (
                                  <ConfidenceBadge value={s.field_confidence.logline} />
                                )}
                              </div>
                              <p className="text-foreground/90 italic text-sm leading-relaxed">"{s.logline}"</p>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            {s.genre && (
                              <div className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                                <Tag className="h-3 w-3 text-muted-foreground" />
                                {s.genre}
                                {s.field_confidence?.genre != null && (
                                  <ConfidenceBadge value={s.field_confidence.genre} />
                                )}
                              </div>
                            )}
                            {s.doc_type && (
                              <div className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                                <ScrollText className="h-3 w-3 text-muted-foreground" />
                                {s.doc_type}
                                {s.field_confidence?.doc_type != null && (
                                  <ConfidenceBadge value={s.field_confidence.doc_type} />
                                )}
                              </div>
                            )}
                            {s.confidence != null && (
                              <div className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium">
                                <span className="text-muted-foreground">Overall:</span>
                                <ConfidenceBadge value={s.confidence} />
                              </div>
                            )}
                          </div>

                          {s.synopsis && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                <BookOpen className="h-3.5 w-3.5" /> Synopsis
                                {s.field_confidence?.synopsis != null && (
                                  <ConfidenceBadge value={s.field_confidence.synopsis} />
                                )}
                              </div>
                              <p className="text-foreground/80 text-sm leading-relaxed">{s.synopsis}</p>
                            </div>
                          )}

                          {(s.themes ?? []).length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                <Tag className="h-3.5 w-3.5" /> Themes
                                {s.field_confidence?.themes != null && (
                                  <ConfidenceBadge value={s.field_confidence.themes} />
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {(s.themes ?? []).map((t) => (
                                  <span key={t} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {(s.characters ?? []).length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                <User className="h-3.5 w-3.5" /> Characters
                                {s.field_confidence?.characters != null && (
                                  <ConfidenceBadge value={s.field_confidence.characters} />
                                )}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {(s.characters ?? []).map((c, i) => (
                                  <div
                                    key={i}
                                    className={`rounded-md p-2 text-xs ${
                                      s.field_confidence?.characters != null && s.field_confidence.characters < LOW_CONFIDENCE_THRESHOLD
                                        ? "bg-destructive/5 border border-destructive/10"
                                        : "bg-muted/60"
                                    }`}
                                  >
                                    <span className="font-medium text-foreground">{c.name}</span>
                                    {c.role && (
                                      <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                                        {c.role}
                                      </span>
                                    )}
                                    {c.description && (
                                      <p className="mt-1 text-muted-foreground line-clamp-2">{c.description}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {s.parsed_at && (
                            <p className="text-[10px] text-muted-foreground">
                              Parsed {new Date(s.parsed_at).toLocaleString()}
                              {s.model_id ? ` · Model: ${s.model_id}` : ""}
                            </p>
                          )}

                          {s.field_sources && Object.values(s.field_sources).some((arr) => (arr ?? []).length > 0) && (
                            <div className="space-y-2 pt-2 border-t border-border/40">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                <Quote className="h-3.5 w-3.5" /> Field Sources
                                <span className="normal-case text-muted-foreground/60">
                                  (verbatim grounding snippets)
                                </span>
                              </div>
                              <div className="space-y-2">
                                {(["logline", "genre", "doc_type", "synopsis", "themes", "characters"] as const).map((field) => {
                                  const snippets = s.field_sources?.[field] ?? [];
                                  if (snippets.length === 0) return null;
                                  return (
                                    <div key={field} className="rounded-md bg-muted/40 p-2">
                                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                                        {field.replace("_", " ")}
                                      </div>
                                      <ul className="space-y-1">
                                        {snippets.map((src, i) => {
                                          const occurrences = f.extracted_text
                                            ? findAllOccurrences(f.extracted_text, src.snippet)
                                            : [];
                                          // Fall back to server-verified offsets if runtime scan finds nothing.
                                          if (occurrences.length === 0 && src.start != null && src.end != null) {
                                            occurrences.push({ start: src.start, end: src.end });
                                          }
                                          const canHighlight = occurrences.length > 0 && !!f.extracted_text;
                                          const isActive =
                                            canHighlight &&
                                            highlight?.fileId === f.id &&
                                            highlight.snippet === src.snippet;
                                          const activeIdx = isActive ? highlight!.activeIndex : 0;
                                          const activate = (idx: number) => {
                                            if (!canHighlight) return;
                                            const occ = occurrences[idx];
                                            if (!occ) return;
                                            if (f.extracted_text && occ.end > textPreviewLimit) {
                                              setShowFullTextFor(f.id);
                                            }
                                            setHighlight({
                                              fileId: f.id,
                                              snippet: src.snippet,
                                              occurrences,
                                              activeIndex: idx,
                                            });
                                          };
                                          return (
                                            <li key={i} className="text-xs">
                                              <div className="flex gap-1.5">
                                                <span className="text-muted-foreground/50 select-none">“</span>
                                                <button
                                                  type="button"
                                                  disabled={!canHighlight}
                                                  onClick={() => activate(isActive ? activeIdx : 0)}
                                                  className={`flex-1 text-left rounded px-1 -mx-1 transition-colors ${
                                                    canHighlight
                                                      ? "hover:bg-primary/10 cursor-pointer"
                                                      : "cursor-default"
                                                  } ${isActive ? "bg-primary/15 ring-1 ring-primary/40" : ""}`}
                                                  title={canHighlight ? "Click to highlight in extracted text" : undefined}
                                                >
                                                  <span className="text-foreground/85 italic font-mono leading-snug">
                                                    {src.snippet}
                                                  </span>
                                                  <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                                                    {src.verified === false && !canHighlight ? (
                                                      <span
                                                        title="Snippet not found verbatim in source"
                                                        className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-600 dark:text-amber-400"
                                                      >
                                                        <Link2Off className="h-2.5 w-2.5" /> unverified
                                                      </span>
                                                    ) : occurrences.length > 0 ? (
                                                      <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">
                                                        {occurrences.length === 1
                                                          ? `chars ${occurrences[0].start.toLocaleString()}–${occurrences[0].end.toLocaleString()}`
                                                          : `${occurrences.length} matches`}
                                                      </span>
                                                    ) : null}
                                                  </span>
                                                </button>
                                              </div>
                                              {isActive && occurrences.length > 1 && (
                                                <div className="mt-1 ml-3 flex items-center gap-1 text-[10px] text-muted-foreground">
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      activate((activeIdx - 1 + occurrences.length) % occurrences.length)
                                                    }
                                                    className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-accent"
                                                    aria-label="Previous match"
                                                  >
                                                    ‹
                                                  </button>
                                                  <span className="tabular-nums">
                                                    Match {activeIdx + 1} of {occurrences.length}
                                                  </span>
                                                  <button
                                                    type="button"
                                                    onClick={() => activate((activeIdx + 1) % occurrences.length)}
                                                    className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-accent"
                                                    aria-label="Next match"
                                                  >
                                                    ›
                                                  </button>
                                                  <span className="text-muted-foreground/70">
                                                    · char {occurrences[activeIdx].start.toLocaleString()}
                                                  </span>
                                                  <div className="ml-1 flex flex-wrap gap-0.5">
                                                    {occurrences.map((_, oi) => (
                                                      <button
                                                        key={oi}
                                                        type="button"
                                                        onClick={() => activate(oi)}
                                                        aria-label={`Jump to match ${oi + 1}`}
                                                        className={`h-1.5 w-1.5 rounded-full transition-colors ${
                                                          oi === activeIdx
                                                            ? "bg-primary"
                                                            : "bg-primary/30 hover:bg-primary/60"
                                                        }`}
                                                      />
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : f.structured_status === "error" ? (
                        <p className="text-xs text-destructive">Parse error: {f.structured_error}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {f.structured_status === "pending"
                            ? "Structured parsing in progress…"
                            : "No structured data yet. Click Parse to run analysis."}
                        </p>
                      )}

                      {/* Extracted text preview */}
                      {f.extracted_text && (
                        <div className="space-y-1 pt-2 border-t border-border/40">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            <ScrollText className="h-3.5 w-3.5" /> Extracted Text Preview
                            <span className="normal-case text-muted-foreground/60">
                              ({f.extracted_text.length.toLocaleString()} chars)
                            </span>
                          </div>
                          <div
                            ref={(el) => {
                              if (el) previewRefs.current.set(f.id, el);
                              else previewRefs.current.delete(f.id);
                            }}
                            className="rounded-md bg-background/60 p-2 text-xs text-foreground/80 font-mono leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto"
                          >
                            {(() => {
                              const fullText = f.extracted_text!;
                              const shown = showFullText ? fullText : fullText.slice(0, textPreviewLimit);
                              const hl = highlight?.fileId === f.id ? highlight : null;
                              if (!hl) return shown;
                              const visible = hl.occurrences
                                .map((o, i) => ({ ...o, i }))
                                .filter((o) => o.start < shown.length)
                                .sort((a, b) => a.start - b.start);
                              if (visible.length === 0) return shown;
                              const parts: React.ReactNode[] = [];
                              let cursor = 0;
                              visible.forEach((o) => {
                                if (o.start > cursor) parts.push(shown.slice(cursor, o.start));
                                const end = Math.min(o.end, shown.length);
                                const isActive = o.i === hl.activeIndex;
                                parts.push(
                                  <mark
                                    key={`${o.i}-${o.start}`}
                                    ref={(el) => {
                                      const key = `${f.id}:${o.i}`;
                                      if (el) markRefs.current.set(key, el);
                                      else markRefs.current.delete(key);
                                    }}
                                    className={`rounded px-0.5 ${
                                      isActive
                                        ? "bg-primary/40 text-foreground ring-1 ring-primary"
                                        : "bg-primary/15 text-foreground/90"
                                    }`}
                                  >
                                    {shown.slice(o.start, end)}
                                  </mark>,
                                );
                                cursor = end;
                              });
                              if (cursor < shown.length) parts.push(shown.slice(cursor));
                              return <>{parts}</>;
                            })()}
                          </div>
                          {f.extracted_text.length > textPreviewLimit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs gap-1"
                              onClick={() => setShowFullTextFor(showFullText ? null : f.id)}
                            >
                              {showFullText ? (
                                <><ChevronUp className="h-3 w-3" /> Show less</>
                              ) : (
                                <><ChevronDown className="h-3 w-3" /> Show full text</>
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
