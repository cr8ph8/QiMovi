/**
 * KnowledgePanel — God Mode admin surface for the knowledge graph / research memory system.
 * Supports viewing, creating, and linking knowledge documents and concepts.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DOC_TYPES,
  DOC_STATUSES,
  CONCEPT_TYPES,
  TARGET_SYSTEMS,
  LINK_TYPES,
  docTypeLabel,
  statusLabel,
  statusColor,
  conceptTypeLabel,
  targetSystemLabel,
  type KnowledgeDocument,
  type KnowledgeConcept,
  type KnowledgeLink,
} from "@/lib/knowledge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen, Plus, RefreshCw, Search, FileText, Lightbulb, Link as LinkIcon,
  ExternalLink, X, ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ---- Documents Tab ----

function DocumentsList() {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("knowledge_documents").select("*").order("created_at", { ascending: false }).limit(200);
    if (typeFilter !== "all") q = q.eq("doc_type", typeFilter);
    if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);
    const { data } = await q;
    setDocs((data as KnowledgeDocument[]) || []);
    setLoading(false);
  }, [search, typeFilter]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const [form, setForm] = useState({ title: "", doc_type: "note", source: "", source_url: "", summary: "", tags: "" });

  const handleCreate = async () => {
    if (!form.title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    const { error } = await supabase.from("knowledge_documents").insert({
      title: form.title.trim(),
      doc_type: form.doc_type,
      source: form.source.trim(),
      source_url: form.source_url.trim() || null,
      summary: form.summary.trim(),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      status: "draft",
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Document created" });
    setForm({ title: "", doc_type: "note", source: "", source_url: "", summary: "", tags: "" });
    setShowForm(false);
    fetchDocs();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search documents…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-xs" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowForm((p) => !p)}>
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showForm ? "Cancel" : "Add"}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchDocs} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="text-xs h-8" />
            <Select value={form.doc_type} onValueChange={(v) => setForm({ ...form, doc_type: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Source (e.g. arXiv, internal)" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="text-xs h-8" />
            <Input placeholder="Source URL (optional)" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} className="text-xs h-8" />
          </div>
          <Textarea placeholder="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} className="text-xs min-h-[60px]" />
          <Input placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} className="text-xs h-8" />
          <Button size="sm" onClick={handleCreate} className="text-xs">Create Document</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No knowledge documents yet. Add a paper, note, or citation to get started.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/20">
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Title</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground">Type</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground hidden sm:table-cell">Source</th>
                <th className="text-center py-2 px-3 font-mono text-[10px] text-muted-foreground">Status</th>
                <th className="text-left py-2 px-3 font-mono text-[10px] text-muted-foreground hidden md:table-cell">Tags</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-body truncate max-w-[220px]">{doc.title}</span>
                      {doc.source_url && (
                        <a href={doc.source_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-primary">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {doc.summary && <p className="text-[10px] text-muted-foreground truncate max-w-[280px] mt-0.5">{doc.summary}</p>}
                  </td>
                  <td className="py-2.5 px-3">
                    <Badge variant="outline" className="text-[10px] font-mono">{docTypeLabel(doc.doc_type)}</Badge>
                  </td>
                  <td className="py-2.5 px-3 hidden sm:table-cell text-xs text-muted-foreground truncate max-w-[120px]">{doc.source || "—"}</td>
                  <td className="py-2.5 px-3 text-center">
                    <Badge variant="outline" className={`text-[10px] font-mono ${statusColor(doc.status)}`}>{statusLabel(doc.status)}</Badge>
                  </td>
                  <td className="py-2.5 px-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded bg-muted/40 text-[9px] font-mono text-muted-foreground">{tag}</span>
                      ))}
                      {doc.tags.length > 3 && <span className="text-[9px] text-muted-foreground">+{doc.tags.length - 3}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Concepts Tab ----

function ConceptsList() {
  const [concepts, setConcepts] = useState<(KnowledgeConcept & { document_title?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const [form, setForm] = useState({ title: "", concept_type: "idea", description: "", document_id: "", confidence: "0.5" });

  const fetchConcepts = useCallback(async () => {
    setLoading(true);
    const [{ data: conceptData }, { data: docData }] = await Promise.all([
      supabase.from("knowledge_concepts").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("knowledge_documents").select("id, title").limit(500),
    ]);
    const titleMap = new Map((docData || []).map((d: any) => [d.id, d.title]));
    setConcepts((conceptData || []).map((c: any) => ({ ...c, document_title: titleMap.get(c.document_id) || null })));
    setDocs((docData || []) as { id: string; title: string }[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchConcepts(); }, [fetchConcepts]);

  const handleCreate = async () => {
    if (!form.title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    const { error } = await supabase.from("knowledge_concepts").insert({
      title: form.title.trim(),
      concept_type: form.concept_type,
      description: form.description.trim(),
      document_id: form.document_id || null,
      confidence: parseFloat(form.confidence) || 0.5,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Concept created" });
    setForm({ title: "", concept_type: "idea", description: "", document_id: "", confidence: "0.5" });
    setShowForm(false);
    fetchConcepts();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowForm((p) => !p)}>
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showForm ? "Cancel" : "Add Concept"}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchConcepts} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Concept title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="text-xs h-8" />
            <Select value={form.concept_type} onValueChange={(v) => setForm({ ...form, concept_type: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONCEPT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.document_id} onValueChange={(v) => setForm({ ...form, document_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Link to document (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Confidence (0-1)" value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} className="text-xs h-8" type="number" step="0.1" min="0" max="1" />
          </div>
          <Textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="text-xs min-h-[60px]" />
          <Button size="sm" onClick={handleCreate} className="text-xs">Create Concept</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : concepts.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
          <Lightbulb className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No concepts extracted yet. Add concepts from papers or analysis.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {concepts.map((c) => (
            <div key={c.id} className="rounded-lg border border-border/30 bg-card/60 p-3 flex items-start gap-3">
              <Lightbulb className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{c.title}</span>
                  <Badge variant="outline" className="text-[9px] font-mono">{conceptTypeLabel(c.concept_type)}</Badge>
                  <span className="text-[9px] font-mono text-muted-foreground">conf: {c.confidence}</span>
                </div>
                {c.description && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{c.description}</p>}
                {c.document_title && (
                  <p className="text-[9px] text-muted-foreground mt-1 flex items-center gap-1">
                    <FileText className="h-2.5 w-2.5" /> {c.document_title}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Links Tab ----

function LinksList() {
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [concepts, setConcepts] = useState<{ id: string; title: string }[]>([]);
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const [form, setForm] = useState({ concept_id: "", document_id: "", target_system: "general", link_type: "relates_to", notes: "" });

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    const [{ data: linkData }, { data: conceptData }, { data: docData }] = await Promise.all([
      supabase.from("knowledge_links").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("knowledge_concepts").select("id, title").limit(500),
      supabase.from("knowledge_documents").select("id, title").limit(500),
    ]);
    setLinks((linkData || []) as KnowledgeLink[]);
    setConcepts((conceptData || []) as { id: string; title: string }[]);
    setDocs((docData || []) as { id: string; title: string }[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const conceptMap = new Map(concepts.map((c) => [c.id, c.title]));
  const docMap = new Map(docs.map((d) => [d.id, d.title]));

  const handleCreate = async () => {
    if (!form.concept_id && !form.document_id) { toast({ title: "Link a concept or document", variant: "destructive" }); return; }
    const { error } = await supabase.from("knowledge_links").insert({
      concept_id: form.concept_id || null,
      document_id: form.document_id || null,
      target_system: form.target_system,
      link_type: form.link_type,
      notes: form.notes.trim(),
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Link created" });
    setForm({ concept_id: "", document_id: "", target_system: "general", link_type: "relates_to", notes: "" });
    setShowForm(false);
    fetchLinks();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setShowForm((p) => !p)}>
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showForm ? "Cancel" : "Add Link"}
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={fetchLinks} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border/50 bg-card/80 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={form.concept_id} onValueChange={(v) => setForm({ ...form, concept_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Concept (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {concepts.map((c) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.document_id} onValueChange={(v) => setForm({ ...form, document_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Document (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.target_system} onValueChange={(v) => setForm({ ...form, target_system: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TARGET_SYSTEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.link_type} onValueChange={(v) => setForm({ ...form, link_type: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LINK_TYPES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="text-xs h-8" />
          <Button size="sm" onClick={handleCreate} className="text-xs">Create Link</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/80 p-8 text-center">
          <LinkIcon className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No knowledge links yet. Connect concepts and documents to system areas.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((lnk) => (
            <div key={lnk.id} className="rounded-lg border border-border/30 bg-card/60 p-3 flex items-center gap-3 text-xs">
              <LinkIcon className="h-3.5 w-3.5 text-primary shrink-0" />
              <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                {lnk.concept_id && <Badge variant="outline" className="text-[9px]">📌 {conceptMap.get(lnk.concept_id) || "Concept"}</Badge>}
                {lnk.document_id && <Badge variant="outline" className="text-[9px]">📄 {docMap.get(lnk.document_id) || "Document"}</Badge>}
                <span className="text-muted-foreground">→</span>
                <Badge variant="secondary" className="text-[9px]">{targetSystemLabel(lnk.target_system)}</Badge>
                <span className="text-[9px] text-muted-foreground font-mono">({lnk.link_type})</span>
                {lnk.notes && <span className="text-[9px] text-muted-foreground truncate max-w-[200px]">— {lnk.notes}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main Panel ----

export default function KnowledgePanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <BookOpen className="h-5 w-5 text-primary" />
        <h3 className="font-display text-sm font-bold">Knowledge Graph</h3>
        <span className="text-[10px] text-muted-foreground font-mono ml-auto">Research memory & ingestion</span>
      </div>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList className="bg-muted/30 border border-border/50">
          <TabsTrigger value="documents" className="font-mono text-[10px] gap-1"><FileText className="h-3 w-3" />Documents</TabsTrigger>
          <TabsTrigger value="concepts" className="font-mono text-[10px] gap-1"><Lightbulb className="h-3 w-3" />Concepts</TabsTrigger>
          <TabsTrigger value="links" className="font-mono text-[10px] gap-1"><LinkIcon className="h-3 w-3" />Links</TabsTrigger>
        </TabsList>

        <TabsContent value="documents"><DocumentsList /></TabsContent>
        <TabsContent value="concepts"><ConceptsList /></TabsContent>
        <TabsContent value="links"><LinksList /></TabsContent>
      </Tabs>
    </div>
  );
}
