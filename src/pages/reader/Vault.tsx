import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Image as ImageIcon, Video, Music, Layers,
  Search, Star, Lock, AlertTriangle, X, Upload, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReaderLayout } from "@/components/reader/ReaderLayout";
import { StatusPill } from "@/components/reader/StatusPill";
import { QiSecScoreBar } from "@/components/reader/vault/QiSecScoreBar";
import { RoleBadge } from "@/components/reader/RoleBadge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useHashTab } from "@/hooks/useHashTab";
import {
  DEMO_ASSETS, computeDocQiSec, computeAssetQiSec,
  type ReaderDoc, type ReaderAsset,
} from "@/lib/reader/types";
import { useEntry, useEntryArtifacts } from "@/lib/reader/queries";
import { useReaderRole, filterDocsForRole, filterAssetsForRole, type ReaderCapabilities } from "@/lib/reader/roles";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const typeIcon: Record<ReaderAsset["type"], typeof ImageIcon> = {
  Image: ImageIcon, Video, Audio: Music, Design: Layers,
};

export default function Vault() {
  const { entryId } = useParams();
  const { entry } = useEntry(entryId);
  const { docs: rawDocs } = useEntryArtifacts(entryId, entry?.visibility);
  const caps = useReaderRole(entry);

  const tabs = useMemo(
    () => (caps.canUpload ? ["documents", "assets", "upload", "search"] : ["documents", "assets", "search"]),
    [caps.canUpload],
  );
  const [tab, setTab] = useHashTab(tabs, "documents");

  const docs = useMemo(() => filterDocsForRole(rawDocs, caps), [rawDocs, caps]);
  const assets = useMemo(() => filterAssetsForRole(DEMO_ASSETS, caps), [caps]);
  const hiddenDocs = rawDocs.length - docs.length;
  const hiddenAssets = DEMO_ASSETS.length - assets.length;
  useDocumentTitle("Vault · Reader");

  return (
    <ReaderLayout>
      <header className="mb-6 space-y-1">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-primary">
            <FileText className="w-3.5 h-3.5" /> Vault
          </div>
          <RoleBadge role={caps.role} />
        </div>
        <h1 className="font-display text-2xl text-foreground">Documents, assets & search</h1>
        <p className="text-sm text-muted-foreground">Everything attached to {entry?.title ?? "this script"}.</p>
        {(hiddenDocs > 0 || hiddenAssets > 0) && (
          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/80 mt-1">
            <EyeOff className="w-3 h-3" />
            {hiddenDocs > 0 && <span>{hiddenDocs} document{hiddenDocs === 1 ? "" : "s"} hidden</span>}
            {hiddenDocs > 0 && hiddenAssets > 0 && <span>·</span>}
            {hiddenAssets > 0 && <span>{hiddenAssets} asset{hiddenAssets === 1 ? "" : "s"} hidden</span>}
            <span>by your reader role.</span>
          </p>
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="documents" className="gap-1.5 text-xs"><FileText className="w-3.5 h-3.5" /> Documents</TabsTrigger>
          <TabsTrigger value="assets" className="gap-1.5 text-xs"><ImageIcon className="w-3.5 h-3.5" /> Assets</TabsTrigger>
          {caps.canUpload && (
            <TabsTrigger value="upload" className="gap-1.5 text-xs"><Upload className="w-3.5 h-3.5" /> Upload</TabsTrigger>
          )}
          <TabsTrigger value="search" className="gap-1.5 text-xs"><Search className="w-3.5 h-3.5" /> Search</TabsTrigger>
        </TabsList>

        <TabsContent value="documents"><DocumentList docs={docs} caps={caps} /></TabsContent>
        <TabsContent value="assets"><AssetList assets={assets} /></TabsContent>
        {caps.canUpload && (
          <TabsContent value="upload"><UploadStub /></TabsContent>
        )}
        <TabsContent value="search"><SearchStub docs={docs} assets={assets} /></TabsContent>
      </Tabs>
    </ReaderLayout>
  );
}

function DocumentList({ docs, caps }: { docs: ReaderDoc[]; caps: ReaderCapabilities }) {
  const [selected, setSelected] = useState<ReaderDoc | null>(null);
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6">
      <div className="bg-card border border-border/60 rounded-xl divide-y divide-border/40">
        {docs.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelected(d)}
            className={cn(
              "w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-secondary/50 transition-colors",
              selected?.id === d.id && "bg-secondary/60"
            )}
          >
            <FileText className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground truncate flex items-center gap-1.5">
                {d.title}
                {d.is_canonical && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
              </p>
              <p className="text-[10px] text-muted-foreground">{d.category} · v{d.version}</p>
            </div>
            <StatusPill status={d.status} size="sm" />
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {selected ? (
          <motion.aside
            key={selected.id}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-card border border-border/60 rounded-xl p-5 space-y-4 h-fit"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-lg text-foreground">{selected.title}</h3>
                <p className="text-[11px] text-muted-foreground">{selected.category} · v{selected.version}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={selected.status} />
              <span className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono border",
                selected.confidentiality === "Confidential" ? "bg-destructive/10 text-destructive border-destructive/20"
                  : selected.confidentiality === "Internal" ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              )}>
                {selected.confidentiality === "Confidential" && <Lock className="w-2.5 h-2.5" />}
                {selected.confidentiality}
              </span>
            </div>
            {selected.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{selected.description}</p>
            )}
            <QiSecScoreBar scores={computeDocQiSec(selected)} compact />
          </motion.aside>
        ) : (
          <div className="bg-card border border-border/60 rounded-xl p-6 text-center text-xs text-muted-foreground h-fit">
            Select a document to inspect it.
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssetList({ assets }: { assets: ReaderAsset[] }) {
  const [selected, setSelected] = useState<ReaderAsset | null>(null);
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {assets.map((a) => {
          const Icon = typeIcon[a.type];
          const expired = !!a.usage_rights && new Date(a.usage_rights.expires_at) < new Date();
          return (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className={cn(
                "group text-left bg-card border border-border/60 rounded-xl overflow-hidden hover:border-primary/40 transition-colors",
                selected?.id === a.id && "border-primary/60"
              )}
            >
              <div className="aspect-video bg-gradient-to-br from-secondary to-background flex items-center justify-center relative">
                <Icon className="w-8 h-8 text-muted-foreground/40" />
                {expired && (
                  <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-destructive/20 text-destructive text-[9px]">
                    <AlertTriangle className="w-2.5 h-2.5" /> Expired
                  </span>
                )}
              </div>
              <div className="p-3 space-y-1.5">
                <p className="text-xs text-foreground truncate">{a.title}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{a.type}</span>
                  <StatusPill status={a.status} size="sm" />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {selected ? (
          <motion.aside
            key={selected.id}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="bg-card border border-border/60 rounded-xl p-5 space-y-4 h-fit"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-lg text-foreground">{selected.title}</h3>
                <p className="text-[11px] text-muted-foreground">{selected.type}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <StatusPill status={selected.status} />
            {selected.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{selected.description}</p>
            )}
            <QiSecScoreBar scores={computeAssetQiSec(selected)} compact />
          </motion.aside>
        ) : (
          <div className="bg-card border border-border/60 rounded-xl p-6 text-center text-xs text-muted-foreground h-fit">
            Select an asset to inspect it.
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UploadStub() {
  return (
    <div className="mt-6 bg-card border border-dashed border-border/60 rounded-xl p-12 text-center space-y-3">
      <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto" />
      <p className="text-sm text-foreground">Upload assets</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        Phase B will wire this to your existing screenplay storage and asset registry.
      </p>
      <Button variant="outline" size="sm" disabled>Choose files</Button>
    </div>
  );
}

function SearchStub({ docs, assets }: { docs: ReaderDoc[]; assets: ReaderAsset[] }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const t = q.toLowerCase();
    return [
      ...docs.filter((d) => d.title.toLowerCase().includes(t) || d.description?.toLowerCase().includes(t)).map((d) => ({ kind: "doc" as const, item: d })),
      ...assets.filter((a) => a.title.toLowerCase().includes(t) || a.description?.toLowerCase().includes(t)).map((a) => ({ kind: "asset" as const, item: a })),
    ];
  }, [q, docs, assets]);
  return (
    <div className="mt-6 space-y-4">
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents and assets…" className="pl-9" />
      </div>
      {q.trim() === "" ? (
        <p className="text-xs text-muted-foreground italic">Phase A: client-side fuzzy match. Phase B will use semantic search.</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-muted-foreground">No matches.</p>
      ) : (
        <div className="bg-card border border-border/60 rounded-xl divide-y divide-border/40">
          {results.map((r) => (
            <div key={r.item.id} className="px-4 py-3 flex items-center gap-3">
              {r.kind === "doc" ? <FileText className="w-4 h-4 text-primary" /> : <ImageIcon className="w-4 h-4 text-emerald-400" />}
              <span className="text-sm text-foreground flex-1 truncate">{r.item.title}</span>
              <StatusPill status={r.item.status} size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
