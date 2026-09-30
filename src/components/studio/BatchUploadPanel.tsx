import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileText, Loader2, Play, X, CheckCircle2,
  AlertCircle, Clock, Zap, FolderOpen, Settings2,
} from "lucide-react";
import { format } from "date-fns";

const ITEM_STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  queued: { icon: Clock, color: "text-muted-foreground", label: "Queued" },
  uploading: { icon: Upload, color: "text-blue-500", label: "Uploading" },
  parsing: { icon: FileText, color: "text-amber-500", label: "Parsing" },
  scoring: { icon: Zap, color: "text-primary", label: "Scoring" },
  completed: { icon: CheckCircle2, color: "text-emerald-500", label: "Done" },
  error: { icon: AlertCircle, color: "text-destructive", label: "Error" },
};

const JOB_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: "bg-muted text-muted-foreground", label: "Pending" },
  processing: { color: "bg-amber-500/10 text-amber-600 border-amber-500/20", label: "Processing" },
  completed: { color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", label: "Completed" },
  failed: { color: "bg-destructive/10 text-destructive border-destructive/20", label: "Failed" },
  cancelled: { color: "bg-muted text-muted-foreground", label: "Cancelled" },
};

const BATCH_PROCESSING_ON_HOLD = true;

interface PendingFile {
  file: File;
  title: string;
  author: string;
}

interface BatchJob {
  id: string;
  job_type: string;
  status: string;
  total_items: number;
  processed_items: number;
  failed_items: number;
  config_json: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

interface BatchItem {
  id: string;
  batch_job_id: string;
  title: string;
  author: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

type Competition = { id: string; name: string };

interface BatchUploadPanelProps {
  competitions: Competition[];
  mode?: "studio" | "festival";
  festivalId?: string;
  onJobSelected?: (jobId: string | null) => void;
}

export default function BatchUploadPanel({ competitions, mode = "studio", festivalId, onJobSelected }: BatchUploadPanelProps) {

  const { user } = useAuth();
  const { balance } = useWallet();
  const { toast } = useToast();

  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [jobType, setJobType] = useState<string>(mode === "festival" ? "festival_intake" : "catalog_profile");
  const [competitionId, setCompetitionId] = useState<string>("");
  const [sensitivity, setSensitivity] = useState<string>("standard");
  const [submitting, setSubmitting] = useState(false);

  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [activeItems, setActiveItems] = useState<BatchItem[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Load existing jobs
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoadingJobs(true);
      const { data } = await (supabase
        .from("batch_jobs") as any)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setJobs((data as BatchJob[]) || []);
      setLoadingJobs(false);
    };
    load();
  }, [user]);

  // Poll batch_jobs (removed from realtime for security)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      const { data } = await (supabase.from("batch_jobs") as any)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setJobs(data as BatchJob[]);
    }, 5_000);
    return () => clearInterval(interval);
  }, [user]);

  // Poll batch_items for expanded job (removed from realtime for security)
  useEffect(() => {
    if (!expandedJobId) { setActiveItems([]); return; }

    const loadItems = async () => {
      const { data } = await (supabase
        .from("batch_items") as any)
        .select("*")
        .eq("batch_job_id", expandedJobId)
        .order("created_at");
      setActiveItems((data as BatchItem[]) || []);
    };
    loadItems();

    const interval = setInterval(loadItems, 5_000);
    return () => clearInterval(interval);
  }, [expandedJobId]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === "application/pdf");
    if (files.length === 0) {
      toast({ title: "PDF only", description: "Please drop PDF files.", variant: "destructive" });
      return;
    }
    const newPending = files.slice(0, 50 - pendingFiles.length).map(f => ({
      file: f,
      title: f.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " "),
      author: "",
    }));
    setPendingFiles(prev => [...prev, ...newPending]);
  }, [pendingFiles.length, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type === "application/pdf");
    const newPending = files.slice(0, 50 - pendingFiles.length).map(f => ({
      file: f,
      title: f.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " "),
      author: "",
    }));
    setPendingFiles(prev => [...prev, ...newPending]);
    e.target.value = "";
  }, [pendingFiles.length]);

  const removePending = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const updatePending = (idx: number, field: "title" | "author", value: string) => {
    setPendingFiles(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const handleSubmitBatch = async () => {
    if (!user || pendingFiles.length === 0) return;

    if (BATCH_PROCESSING_ON_HOLD) {
      toast({
        title: "Batch processing temporarily unavailable",
        description: "We are applying a security upgrade. Your files have not been uploaded or charged.",
      });
      return;
    }

    // Token cost estimate: 25 tokens per item (same as ai-judge single)
    const costPerItem = 25;
    const totalCost = pendingFiles.length * costPerItem;
    if (balance !== null && balance < totalCost) {
      toast({
        title: "Insufficient tokens",
        description: `This batch of ${pendingFiles.length} screenplays costs ${totalCost} ⊘. You have ${balance} ⊘.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      // 1. Create batch job
      const configJson: Record<string, unknown> = {
        sensitivity,
        cost_per_item: costPerItem,
      };
      if (competitionId) configJson.competition_id = competitionId;
      if (festivalId) configJson.festival_id = festivalId;

      const { data: job, error: jobErr } = await supabase
        .from("batch_jobs")
        .insert({
          user_id: user.id,
          job_type: jobType,
          status: "pending",
          total_items: pendingFiles.length,
          config_json: configJson,
        } as any)
        .select()
        .single();

      if (jobErr || !job) throw new Error(jobErr?.message || "Failed to create batch job");

      // 2. Upload PDFs and create batch items
      for (const pf of pendingFiles) {
        const filePath = `${user.id}/batch-${job.id}/${Date.now()}-${pf.file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from("screenplays")
          .upload(filePath, pf.file, { contentType: "application/pdf" });

        if (uploadErr) {
          console.error("Upload failed:", uploadErr);
          continue;
        }

        const { data: signedData } = await supabase.storage.from("screenplays").createSignedUrl(filePath, 86400);

        await (supabase.from("batch_items") as any).insert({
          batch_job_id: job.id,
          title: pf.title.slice(0, 120),
          author: pf.author || null,
          source_pdf_url: signedData?.signedUrl || filePath,
          status: "queued",
        });
      }

      // 3. Trigger processing
      await supabase.functions.invoke("process-batch", {
        body: { batch_job_id: job.id },
      });

      toast({
        title: "Batch submitted",
        description: `${pendingFiles.length} screenplays queued for profiling.`,
      });

      setPendingFiles([]);
      setExpandedJobId(job.id);
      onJobSelected?.(job.id);

    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const progressPercent = (job: BatchJob) =>
    job.total_items > 0 ? Math.round(((job.processed_items + job.failed_items) / job.total_items) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border/50 bg-card p-6 space-y-5"
      >
        {BATCH_PROCESSING_ON_HOLD && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Batch processing is temporarily paused while we complete a security upgrade.</span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Upload className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold">
              {mode === "festival" ? "Bulk Competition Intake" : "Catalog Profiling"}
            </h3>
            <p className="text-xs text-muted-foreground font-body">
              Upload up to 50 PDFs per batch • 25 ⊘ per screenplay
            </p>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          className="border-2 border-dashed border-border/60 rounded-lg p-8 text-center hover:border-primary/40 transition-colors cursor-pointer"
          onClick={() => document.getElementById("batch-file-input")?.click()}
        >
          <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground font-body">
            Drag & drop PDF screenplays here, or click to browse
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">PDF files only • Max 50 per batch</p>
          <input
            id="batch-file-input"
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Pending files list */}
        <AnimatePresence>
          {pendingFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-body font-medium">
                  {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""} ready
                </span>
                <Button variant="ghost" size="sm" onClick={() => setPendingFiles([])}>
                  Clear all
                </Button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {pendingFiles.map((pf, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={pf.title}
                      onChange={(e) => updatePending(idx, "title", e.target.value)}
                      className="h-7 text-xs flex-1 min-w-0"
                      placeholder="Title"
                      maxLength={120}
                    />
                    <Input
                      value={pf.author}
                      onChange={(e) => updatePending(idx, "author", e.target.value)}
                      className="h-7 text-xs w-32"
                      placeholder="Author"
                      maxLength={100}
                    />
                    <button onClick={() => removePending(idx)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Config */}
        {pendingFiles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-border/30">
            <div className="space-y-1.5">
              <label className="text-xs font-body text-muted-foreground flex items-center gap-1">
                <Settings2 className="h-3 w-3" /> Job Type
              </label>
              <Select value={jobType} onValueChange={setJobType}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="catalog_profile">Catalog Profile</SelectItem>
                  <SelectItem value="festival_intake">Festival Intake</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {jobType === "festival_intake" && competitions.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-body text-muted-foreground">Target Competition</label>
                <Select value={competitionId} onValueChange={setCompetitionId}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {competitions.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-body text-muted-foreground">Sensitivity</label>
              <Select value={sensitivity} onValueChange={setSensitivity}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="confidential">Confidential</SelectItem>
                  <SelectItem value="nda_protected">NDA Protected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Submit */}
        {pendingFiles.length > 0 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs font-mono text-muted-foreground">
              Estimated cost: <span className="text-foreground font-semibold">{pendingFiles.length * 25} ⊘</span>
              {balance !== null && (
                <> • Balance: <span className={balance < pendingFiles.length * 25 ? "text-destructive" : "text-emerald-500"}>{balance} ⊘</span></>
              )}
            </span>
            <Button onClick={handleSubmitBatch} disabled={submitting || BATCH_PROCESSING_ON_HOLD} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {BATCH_PROCESSING_ON_HOLD ? "Temporarily Paused" : "Start Profiling"}
            </Button>
          </div>
        )}
      </motion.div>

      {/* Job History */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/30 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">Batch Jobs</h3>
          {loadingJobs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {jobs.length === 0 && !loadingJobs ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground font-body">
            No batch jobs yet. Upload screenplays above to get started.
          </p>
        ) : (
          <div className="divide-y divide-border/30">
            {jobs.map(job => {
              const pct = progressPercent(job);
              const cfg = JOB_STATUS_CONFIG[job.status] || JOB_STATUS_CONFIG.pending;
              const isExpanded = expandedJobId === job.id;

              return (
                <div key={job.id}>
                  <button
                    onClick={() => {
                      const next = isExpanded ? null : job.id;
                      setExpandedJobId(next);
                      onJobSelected?.(next);
                    }}
                    className="w-full px-5 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors text-left"
                  >

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-body text-sm font-medium capitalize">
                          {job.job_type.replace(/_/g, " ")}
                        </span>
                        <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>{cfg.label}</Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                        <span>{job.total_items} items</span>
                        <span>{job.processed_items} done</span>
                        {job.failed_items > 0 && <span className="text-destructive">{job.failed_items} failed</span>}
                        <span>{format(new Date(job.created_at), "MMM d, HH:mm")}</span>
                      </div>
                    </div>
                    <div className="w-24">
                      <Progress value={pct} className="h-1.5" />
                      <span className="text-[10px] font-mono text-muted-foreground">{pct}%</span>
                    </div>
                  </button>

                  {/* Expanded items */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-t border-border/20 bg-muted/10"
                      >
                        {activeItems.length === 0 ? (
                          <div className="px-5 py-4 text-center">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="font-body text-xs">Title</TableHead>
                                <TableHead className="font-body text-xs">Author</TableHead>
                                <TableHead className="font-body text-xs">Status</TableHead>
                                <TableHead className="font-body text-xs">Details</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {activeItems.map(item => {
                                const sc = ITEM_STATUS_CONFIG[item.status] || ITEM_STATUS_CONFIG.queued;
                                const Icon = sc.icon;
                                return (
                                  <TableRow key={item.id}>
                                    <TableCell className="font-body text-sm">{item.title}</TableCell>
                                    <TableCell className="font-body text-sm text-muted-foreground">{item.author || "—"}</TableCell>
                                    <TableCell>
                                      <span className={`flex items-center gap-1.5 text-xs font-mono ${sc.color}`}>
                                        <Icon className="h-3 w-3" /> {sc.label}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground font-body max-w-[200px] truncate">
                                      {item.error_message || (item.completed_at ? format(new Date(item.completed_at), "HH:mm:ss") : "—")}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
