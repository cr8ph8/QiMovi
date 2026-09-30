import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Image as ImageIcon, Star, Lock, Link2, GitBranch, X, AlertTriangle, Eye, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ReaderLayout } from "@/components/reader/ReaderLayout";
import { StatusPill } from "@/components/reader/StatusPill";
import { QiSecScoreBar } from "@/components/reader/vault/QiSecScoreBar";
import { LineageGraph } from "@/components/reader/vault/LineageGraph";
import { RoleBadge } from "@/components/reader/RoleBadge";
import {
  DEMO_ASSETS,
  computeDocQiSec,
  computeAssetQiSec,
  type ReaderDoc,
  type ReaderAsset,
} from "@/lib/reader/types";
import { useEntry, useEntryArtifacts } from "@/lib/reader/queries";
import { useReaderRole, filterDocsForRole, filterAssetsForRole } from "@/lib/reader/roles";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

interface GraphNode {
  id: string;
  label: string;
  kind: "doc" | "asset";
  status: string;
  x: number;
  y: number;
  isCanonical?: boolean;
}
interface GraphEdge {
  from: string;
  to: string;
  type: "link" | "derivative";
}

function buildGraph(docs: ReaderDoc[], assets: ReaderAsset[]) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const set = new Set<string>();
  const docX = 120, assetX = 480, startY = 40, gap = 70;

  docs.forEach((d, i) => {
    nodes.push({ id: d.id, label: d.title.slice(0, 24), kind: "doc", status: d.status, x: docX, y: startY + i * gap, isCanonical: d.is_canonical });
    set.add(d.id);
  });
  assets.forEach((a, i) => {
    nodes.push({ id: a.id, label: a.title.slice(0, 24), kind: "asset", status: a.status, x: assetX, y: startY + i * gap });
    set.add(a.id);
  });
  docs.forEach((d) => (d.linked_asset_ids || []).forEach((aid) => set.has(aid) && edges.push({ from: d.id, to: aid, type: "link" })));
  assets.forEach((a) => a.parent_asset_id && set.has(a.parent_asset_id) && edges.push({ from: a.parent_asset_id, to: a.id, type: "derivative" }));
  return { nodes, edges };
}

type Selected = { type: "doc"; item: ReaderDoc } | { type: "asset"; item: ReaderAsset };

export default function ProjectHub() {
  const { entryId } = useParams();
  const navigate = useNavigate();
  useDocumentTitle("Project Hub · Reader");

  const { entry } = useEntry(entryId);
  const { docs: rawDocs } = useEntryArtifacts(entryId, entry?.visibility);
  const caps = useReaderRole(entry);
  const docs = useMemo(() => filterDocsForRole(rawDocs, caps), [rawDocs, caps]);
  const assets = useMemo(() => filterAssetsForRole(DEMO_ASSETS, caps), [caps]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => buildGraph(docs, assets), [docs, assets]);
  const svgH = Math.max(nodes.length * 70 + 60, 400);

  const stats = useMemo(() => {
    const approvedDocs = docs.filter((d) => d.status === "Approved" || d.status === "Locked").length;
    const canonical = docs.filter((d) => d.is_canonical).length;
    const approvedAssets = assets.filter((a) => a.status === "Approved").length;
    const links = edges.filter((e) => e.type === "link").length;
    const derivs = edges.filter((e) => e.type === "derivative").length;
    const expired = assets.filter((a) => a.usage_rights && new Date(a.usage_rights.expires_at) < new Date()).length;
    return { approvedDocs, canonical, approvedAssets, links, derivs, expired };
  }, [docs, assets, edges]);

  const connectedEdges = useMemo(() => {
    if (!hovered) return new Set<number>();
    const s = new Set<number>();
    edges.forEach((e, i) => (e.from === hovered || e.to === hovered) && s.add(i));
    return s;
  }, [hovered, edges]);

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <ReaderLayout>
      <div className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-primary">
              <Link2 className="w-3.5 h-3.5" /> Project Hub
            </div>
            <RoleBadge role={caps.role} />
          </div>
          <h1 className="font-display text-2xl text-foreground">{entry?.title ?? "Project Hub"}</h1>
          <p className="text-sm text-muted-foreground">Linked documents, media assets, and their relationships.</p>
        </header>

        <div className={cn("grid grid-cols-2 sm:grid-cols-3 gap-3", caps.canSeeOperatorStats ? "lg:grid-cols-6" : "lg:grid-cols-4")}>
          {[
            { label: "Documents", v: docs.length, sub: `${stats.approvedDocs} approved`, show: true },
            { label: "Canonical", v: stats.canonical, sub: "source of truth", show: true },
            { label: "Assets", v: assets.length, sub: `${stats.approvedAssets} approved`, show: true },
            { label: "Links", v: stats.links, sub: "doc ↔ asset", show: true },
            { label: "Derivatives", v: stats.derivs, sub: "asset chains", show: caps.canSeeOperatorStats },
            { label: "Expired Rights", v: stats.expired, sub: stats.expired ? "action needed" : "all clear", warn: stats.expired > 0, show: caps.canSeeOperatorStats },
          ].filter((s) => s.show).map((s) => (
            <div key={s.label} className="bg-card rounded-xl p-4 border border-border/60">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{s.label}</p>
              <p className={cn("text-2xl font-bold font-mono", s.warn ? "text-destructive" : "text-foreground")}>{s.v}</p>
              <p className={cn("text-[10px]", s.warn ? "text-destructive" : "text-muted-foreground")}>{s.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          <div className="bg-card rounded-xl border border-border/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-border/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">Relationship Graph</span>
              </div>
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> Documents</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Assets</span>
                <span className="flex items-center gap-1"><span className="w-4 border-t border-dashed border-amber-500" /> Derivative</span>
              </div>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 520 }}>
              <svg viewBox={`0 0 600 ${svgH}`} className="w-full" style={{ minHeight: 400 }}>
                <text x={120} y={20} textAnchor="middle" className="text-[10px] fill-muted-foreground font-mono uppercase">Documents</text>
                <text x={480} y={20} textAnchor="middle" className="text-[10px] fill-muted-foreground font-mono uppercase">Assets</text>

                {edges.map((edge, i) => {
                  const f = nodeMap.get(edge.from), t = nodeMap.get(edge.to);
                  if (!f || !t) return null;
                  const hl = connectedEdges.has(i);
                  const deriv = edge.type === "derivative";
                  return (
                    <line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                      stroke={deriv ? "hsl(38 95% 55%)" : "hsl(var(--border))"}
                      strokeWidth={hl ? 2 : 1}
                      strokeDasharray={deriv ? "4 3" : undefined}
                      opacity={hovered ? (hl ? 1 : 0.15) : 0.6}
                      className="transition-opacity duration-200" />
                  );
                })}

                {nodes.map((n) => {
                  const hov = hovered === n.id;
                  const conn = hovered ? connectedEdges.size > 0 && edges.some((e, i) => connectedEdges.has(i) && (e.from === n.id || e.to === n.id)) : true;
                  const isDoc = n.kind === "doc";
                  const r = hov ? 10 : 7;
                  return (
                    <g key={n.id} className="cursor-pointer"
                      onMouseEnter={() => setHovered(n.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => {
                        if (isDoc) {
                          const d = docs.find((x) => x.id === n.id);
                          if (d) setSelected({ type: "doc", item: d });
                        } else {
                          const a = assets.find((x) => x.id === n.id);
                          if (a) setSelected({ type: "asset", item: a });
                        }
                      }}>
                      <circle cx={n.x} cy={n.y} r={r}
                        fill={isDoc ? "hsl(var(--primary))" : "hsl(142 70% 45%)"}
                        opacity={hovered ? (conn || hov ? 1 : 0.2) : 0.85}
                        className="transition-all duration-200" />
                      {n.isCanonical && (
                        <text x={n.x} y={n.y + 3} textAnchor="middle" className="text-[8px] fill-primary-foreground font-bold">★</text>
                      )}
                      <text x={isDoc ? n.x - 14 : n.x + 14} y={n.y + 4}
                        textAnchor={isDoc ? "end" : "start"}
                        className={cn("text-[9px] font-mono transition-opacity duration-200",
                          hov ? "fill-foreground font-medium" : "fill-muted-foreground",
                          hovered && !conn && !hov ? "opacity-20" : "")}>
                        {n.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <div className="space-y-4">
            <AnimatePresence mode="wait">
              {selected ? (
                <motion.div key={selected.item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="bg-card rounded-xl border border-border/60">
                  {selected.type === "doc"
                    ? <DocDetail doc={selected.item} onClose={() => setSelected(null)} onOpen={() => navigate(`/reader/${entryId}/vault#documents`)} />
                    : <AssetDetail asset={selected.item} onClose={() => setSelected(null)} onOpen={() => navigate(`/reader/${entryId}/vault#assets`)} />}
                </motion.div>
              ) : (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="bg-card rounded-xl border border-border/60 p-6 text-center">
                  <Eye className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Click a node to inspect it</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Hover to highlight connections</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="bg-card rounded-xl border border-border/60 p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">All Documents</p>
              {docs.map((d) => (
                <button key={d.id} onClick={() => setSelected({ type: "doc", item: d })}
                  onMouseEnter={() => setHovered(d.id)} onMouseLeave={() => setHovered(null)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary transition-colors text-left">
                  <FileText className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-xs text-foreground truncate flex-1">{d.title}</span>
                  {d.is_canonical && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                  <StatusPill status={d.status} size="sm" />
                </button>
              ))}
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium pt-2">All Assets</p>
              {assets.map((a) => (
                <button key={a.id} onClick={() => setSelected({ type: "asset", item: a })}
                  onMouseEnter={() => setHovered(a.id)} onMouseLeave={() => setHovered(null)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary transition-colors text-left">
                  <ImageIcon className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="text-xs text-foreground truncate flex-1">{a.title}</span>
                  {a.parent_asset_id && <GitBranch className="w-2.5 h-2.5 text-muted-foreground shrink-0" />}
                  <StatusPill status={a.status} size="sm" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ReaderLayout>
  );
}

function DocDetail({ doc, onClose, onOpen }: { doc: ReaderDoc; onClose: () => void; onOpen: () => void }) {
  const scores = computeDocQiSec(doc);
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{doc.title}</h3>
            <p className="text-[10px] text-muted-foreground">{doc.category} · v{doc.version}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill status={doc.status} />
        {doc.is_canonical && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[9px] font-mono font-medium">
            <Star className="w-2.5 h-2.5 fill-amber-400" /> Canonical
          </span>
        )}
        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-medium border",
          doc.confidentiality === "Confidential" ? "bg-destructive/10 text-destructive border-destructive/20"
            : doc.confidentiality === "Internal" ? "bg-primary/10 text-primary border-primary/20"
            : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")}>
          {doc.confidentiality === "Confidential" && <Lock className="w-2.5 h-2.5" />}
          {doc.confidentiality}
        </span>
      </div>
      {doc.status === "Deprecated" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
          <span className="text-[10px] text-destructive">Deprecated — should not be referenced</span>
        </div>
      )}
      {doc.description && <p className="text-xs text-muted-foreground line-clamp-3">{doc.description}</p>}
      <QiSecScoreBar scores={scores} compact />
      <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs" onClick={onOpen}>
        <ArrowRight className="w-3 h-3" /> Open in Vault
      </Button>
    </div>
  );
}

function AssetDetail({ asset, onClose, onOpen }: { asset: ReaderAsset; onClose: () => void; onOpen: () => void }) {
  const scores = computeAssetQiSec(asset);
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{asset.title}</h3>
            <p className="text-[10px] text-muted-foreground">{asset.type}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <StatusPill status={asset.status} />
      {asset.description && <p className="text-xs text-muted-foreground line-clamp-3">{asset.description}</p>}
      <LineageGraph
        current={{ id: asset.id, label: asset.title.slice(0, 16), kind: "asset" }}
        parents={asset.parent_asset_id ? [{ id: asset.parent_asset_id, label: "Parent", kind: "asset" }] : []}
      />
      <QiSecScoreBar scores={scores} compact />
      <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs" onClick={onOpen}>
        <ArrowRight className="w-3 h-3" /> Open in Vault
      </Button>
    </div>
  );
}
