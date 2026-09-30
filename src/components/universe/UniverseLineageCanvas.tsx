import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import LineageGraph, { LineageNode, LineageEdge, LaneMeta } from "@/components/LineageGraph";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Plus,
  Minus,
  Search,
  Sparkles,
  GitBranch,
  AlertTriangle,
  FileJson,
  ImageDown,
  FileCode2,
  Pencil,
  Trash2,
  Link2,
  Save,
  X,
  Package,
  ChevronDown,
} from "lucide-react";

import { lineageToMermaid, lineageToSubgraphMermaid } from "@/lib/lineageToMermaid";
import {
  buildLineageManifest,
  downloadJson,
  exportSvgAsPng,
  downloadInvestorBundle,
  type InvestorBundleResult,
  type BundleProgress,
} from "@/lib/lineageExport";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface UniverseMember {
  entry_id: string;
  title: string;
}

interface Props {
  universeId: string;
  universeName: string;
  members: UniverseMember[];
}

const LANES = ["source", "core", "consensus", "deliverable"] as const;
type Lane = (typeof LANES)[number];

const LANE_META: Record<Lane, LaneMeta> = {
  source: { label: "Source", caption: "Where this universe came from", glyph: "◇" },
  core: { label: "Core", caption: "The creative assets you're building", glyph: "◆" },
  consensus: { label: "Consensus", caption: "What the system locks in as canon", glyph: "✦" },
  deliverable: { label: "Deliverable", caption: "What you can hand to investors, partners, fans", glyph: "▣" },
};

function laneFor(nodeType: string): Lane {
  const t = nodeType.toLowerCase();
  if (/(brain_dump|brief|ingest|parse|draft|source|upload)/.test(t)) return "source";
  if (/(character|scene|asset|location|set|prop|beat|arc|rewrite|ai_generation|creative_direction|voice|visual)/.test(t))
    return "core";
  if (/(gate|canonical|consensus|entry|universe|alias)/.test(t)) return "consensus";
  if (/(artifact|score|package|deliverable|governance|evaluation|paperwork|pitch|parity|budget|burn)/.test(t))
    return "deliverable";
  return "core";
}

interface LoadState {
  status: "loading" | "ready" | "error";
  error?: string;
}

// Compact base64url codec for the "?v=" short-link payload. We keep the
// payload as a tiny JSON object with one-letter keys so the encoded string
// stays short enough to share over chat/email without truncation.
type ShortView = {
  q?: string;
  l?: string; // lanes joined by ","
  d?: "c"; // compact density
  s?: string; // selected node id
  x?: number;
  y?: number;
  z?: number; // scale (zoom)
};

function b64urlEncode(s: string): string {
  // unescape(encodeURIComponent(s)) handles UTF-8 safely before btoa.
  const b64 = typeof window !== "undefined"
    ? window.btoa(unescape(encodeURIComponent(s)))
    : Buffer.from(s, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const raw = typeof window !== "undefined"
      ? window.atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
    return decodeURIComponent(escape(raw));
  } catch {
    return null;
  }
}

function decodeShortView(v: string): ShortView | null {
  const json = b64urlDecode(v);
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as ShortView) : null;
  } catch {
    return null;
  }
}

export default function UniverseLineageCanvas({ universeId, universeName, members }: Props) {
  // ---- Read initial view state from URL so permalinks reproduce a view. ----
  // Supports both the long form (?q=&lanes=&x=&y=&scale=&sel=&density=) and
  // the compact short form (?v=<base64url(json)>). The short form wins when
  // present so freshly-shared short links remain authoritative.
  const initialUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const vParam = sp.get("v");
    if (vParam) {
      const sv = decodeShortView(vParam);
      if (sv) {
        const lanes = sv.l
          ? (sv.l.split(",").filter((l) => (LANES as readonly string[]).includes(l)) as Lane[])
          : null;
        return {
          q: sv.q ?? "",
          lanes: lanes && lanes.length ? new Set(lanes) : null,
          density: sv.d === "c" ? ("compact" as const) : null,
          sel: sv.s ?? null,
          x: typeof sv.x === "number" ? sv.x : null,
          y: typeof sv.y === "number" ? sv.y : null,
          scale: typeof sv.z === "number" ? sv.z : null,
        };
      }
    }
    const lanesParam = sp.get("lanes");
    const lanes = lanesParam
      ? (lanesParam.split(",").filter((l) => (LANES as readonly string[]).includes(l)) as Lane[])
      : null;
    return {
      q: sp.get("q") ?? "",
      lanes: lanes && lanes.length ? new Set(lanes) : null,
      density: sp.get("density") === "compact" ? ("compact" as const) : null,
      sel: sp.get("sel"),
      x: sp.get("x") ? Number(sp.get("x")) : null,
      y: sp.get("y") ? Number(sp.get("y")) : null,
      scale: sp.get("scale") ? Number(sp.get("scale")) : null,
    };
  }, []);

  const [nodes, setNodes] = useState<LineageNode[]>([]);
  const [edges, setEdges] = useState<LineageEdge[]>([]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<LineageNode | null>(null);
  const [hovered, setHovered] = useState<LineageNode | null>(null);
  const [focusLocked, setFocusLocked] = useState<string | null>(null);
  // Ancestry hop selection — see LineageGraph highlightedEdge prop.
  const [highlightedHop, setHighlightedHop] = useState<{
    from: string;
    to: string;
  } | null>(null);
  // Per-hop expansion for the "full custody record" drawer inside the
  // Ancestry tab. Only one hop is expanded at a time so the drawer stays
  // readable. Keyed by the parent node id (which is unique per hop).
  const [expandedHopNodeId, setExpandedHopNodeId] = useState<string | null>(
    null,
  );
  // Lazy-loaded attestation rows, keyed by entry_id. `undefined` means
  // "not yet fetched", `[]` means "fetched and none exist".
  type HopAttestation = {
    id: string;
    entry_id: string;
    user_id: string | null;
    is_sole_author: boolean | null;
    has_rights: boolean | null;
    acknowledged_terms: boolean | null;
    attestation_text: string | null;
    created_at: string | null;
  };
  const [attestationsByEntry, setAttestationsByEntry] = useState<
    Map<string, HopAttestation[] | "loading">
  >(new Map());


  const [query, setQuery] = useState(initialUrl?.q ?? "");
  const [activeLanes, setActiveLanes] = useState<Set<Lane>>(
    () => initialUrl?.lanes ?? new Set(LANES),
  );
  const [density, setDensity] = useState<"comfortable" | "compact">(
    initialUrl?.density ?? "comfortable",
  );
  const svgRef = useRef<SVGSVGElement | null>(null);
  const transformRef = useRef<any>(null);
  // Live pan/zoom snapshot for permalink generation (no re-render needed).
  const transformStateRef = useRef<{ x: number; y: number; scale: number }>({
    x: initialUrl?.x ?? 0,
    y: initialUrl?.y ?? 0,
    scale: initialUrl?.scale ?? 1,
  });
  // Restore selection from URL once nodes are available (one-shot).
  const restoredSelectionRef = useRef(false);
  // DB metadata for inline editing — only real provenance rows are editable
  const [nodeMeta, setNodeMeta] = useState<Map<string, { entry_id: string }>>(new Map());
  const [edgeMeta, setEdgeMeta] = useState<Map<string, { id: string; entry_id: string }>>(new Map());
  const edgeKeyOf = (from: string, to: string, type: string) => `${from}→${to}::${type}`;
  // Inline edit form state
  const [labelDraft, setLabelDraft] = useState("");
  const [editingLabel, setEditingLabel] = useState(false);
  const [newEdgeTarget, setNewEdgeTarget] = useState<string>("");
  const [newEdgeType, setNewEdgeType] = useState<string>("rel");
  const [busy, setBusy] = useState(false);
  // Tracks the most recent bundle export so the UI can show per-file
  // checksums and timestamps for verification.
  const [lastBundle, setLastBundle] = useState<InvestorBundleResult | null>(null);
  const [bundleDialogOpen, setBundleDialogOpen] = useState(false);
  const [bundleProgress, setBundleProgress] = useState<BundleProgress | null>(null);

  // ---------------- Load lineage ----------------
  const loadLineage = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const entryIds = members.map((m) => m.entry_id);

      const [pnRes, peRes, legRes, parityRes] = await Promise.all([
        entryIds.length
          ? supabase
              .from("provenance_nodes")
              .select("id, label, node_type, entry_id, created_at")
              .in("entry_id", entryIds)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [] as any[], error: null }),
        entryIds.length
          ? supabase
              .from("provenance_edges")
              .select("id, from_node_id, to_node_id, edge_type, entry_id")
              .in("entry_id", entryIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        entryIds.length
          ? supabase
              .from("project_legacy_map")
              .select("project_id, source_id, source_table")
              .in("source_table", ["entries", "screenplay_drafts"])
              .in("source_id", entryIds)
          : Promise.resolve({ data: [] as any[], error: null }),
        (supabase as any)
          .from("parity_deals")
          .select("id, deal_name, universe_id")
          .eq("universe_id", universeId),
      ]);

      if ((pnRes as any).error) throw (pnRes as any).error;
      if ((peRes as any).error) throw (peRes as any).error;

      const pnData = ((pnRes as any).data ?? []) as any[];
      const peData = ((peRes as any).data ?? []) as any[];
      const legacyRows = ((legRes as any).data ?? []) as any[];
      const entryToProject = new Map<string, string>();
      for (const r of legacyRows) entryToProject.set(r.source_id, r.project_id);
      const projectIds = [...new Set(legacyRows.map((r) => r.project_id))].slice(0, 200);

      const paRes = projectIds.length
        ? await supabase
            .from("project_artifacts")
            .select("id, project_id, artifact_type, is_current, created_at")
            .in("project_id", projectIds)
            .eq("is_current", true)
        : { data: [] as any[] };

      const outNodes: LineageNode[] = [];
      const outEdges: LineageEdge[] = [];
      const edgeKeys = new Set<string>();
      const pushEdge = (from: string, to: string, type: string) => {
        const key = `${from}→${to}::${type}`;
        if (edgeKeys.has(key)) return;
        edgeKeys.add(key);
        outEdges.push({ from_node_id: from, to_node_id: to, edge_type: type });
      };

      // Universe consensus root
      const universeNodeId = `universe:${universeId}`;
      outNodes.push({
        id: universeNodeId,
        label: universeName || "Universe",
        node_type: "universe",
        lane: "consensus",
      });

      // Entry consensus nodes
      const validEntryIds = new Set(members.map((m) => m.entry_id));
      for (const m of members) {
        const entryNodeId = `entry:${m.entry_id}`;
        outNodes.push({
          id: entryNodeId,
          label: m.title,
          node_type: "entry",
          lane: "consensus",
        });
        pushEdge(entryNodeId, universeNodeId, "member_of");
      }

      // Track which nodes/edges are real DB rows (editable)
      const nMeta = new Map<string, { entry_id: string }>();
      const eMeta = new Map<string, { id: string; entry_id: string }>();

      // Provenance nodes — direction matches lane
      for (const n of pnData) {
        const lane = laneFor(n.node_type);
        outNodes.push({
          id: n.id,
          label: n.label ?? n.node_type,
          node_type: n.node_type,
          lane,
          created_at: n.created_at,
        });
        nMeta.set(n.id, { entry_id: n.entry_id });
        if (!validEntryIds.has(n.entry_id)) {
          pushEdge(universeNodeId, n.id, "orphan");
          continue;
        }
        const entryNodeId = `entry:${n.entry_id}`;
        if (lane === "deliverable") {
          pushEdge(entryNodeId, n.id, "produces");
        } else if (lane === "source") {
          pushEdge(n.id, entryNodeId, "feeds");
        } else {
          pushEdge(n.id, entryNodeId, "feeds");
        }
      }

      // Real provenance edges between provenance nodes
      const nodeIdSet = new Set(outNodes.map((n) => n.id));
      for (const e of peData) {
        if (!nodeIdSet.has(e.from_node_id) || !nodeIdSet.has(e.to_node_id)) continue;
        const type = e.edge_type ?? "rel";
        pushEdge(e.from_node_id, e.to_node_id, type);
        eMeta.set(edgeKeyOf(e.from_node_id, e.to_node_id, type), {
          id: e.id,
          entry_id: e.entry_id,
        });
      }

      // Project artifacts as deliverables
      const projectToEntry = new Map<string, string>();
      for (const [eid, pid] of entryToProject.entries()) projectToEntry.set(pid, eid);
      for (const a of (((paRes as any).data ?? []) as any[])) {
        const entryId = projectToEntry.get(a.project_id);
        const id = `artifact:${a.id}`;
        outNodes.push({
          id,
          label: a.artifact_type,
          node_type: `artifact_${a.artifact_type}`,
          lane: "deliverable",
          created_at: a.created_at,
        });
        const from = entryId ? `entry:${entryId}` : universeNodeId;
        pushEdge(from, id, "produces");
      }

      // Parity deals
      for (const p of (((parityRes as any).data ?? []) as any[])) {
        const id = `parity:${p.id}`;
        outNodes.push({
          id,
          label: p.deal_name || "Parity Deal",
          node_type: "parity_deal",
          lane: "deliverable",
        });
        pushEdge(universeNodeId, id, "deal");
      }

      setNodes(outNodes);
      setEdges(outEdges);
      setNodeMeta(nMeta);
      setEdgeMeta(eMeta);
      setState({ status: "ready" });
    } catch (err: any) {
      console.error("[lineage] load error", err);
      setState({ status: "error", error: err?.message ?? "Failed to load lineage" });
    }
  }, [universeId, universeName, members]);

  useEffect(() => {
    loadLineage();
  }, [loadLineage]);

  // ---------------- Filtering ----------------
  const visibleNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      const laneOk = !n.lane || activeLanes.has(n.lane as Lane);
      const matchOk =
        !q ||
        n.label.toLowerCase().includes(q) ||
        n.node_type.toLowerCase().includes(q);
      return laneOk && matchOk;
    });
  }, [nodes, query, activeLanes]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => ids.has(e.from_node_id) && ids.has(e.to_node_id));
  }, [edges, visibleNodes]);

  const focusedId = focusLocked ?? hovered?.id ?? null;

  // ---------------- Export ----------------
  const mermaid = useMemo(
    () => lineageToMermaid(visibleNodes, visibleEdges, [...LANES]),
    [visibleNodes, visibleEdges]
  );

  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(mermaid);
      toast.success("Copied Mermaid diagram");
    } catch {
      toast.error("Copy blocked by browser");
    }
  };

  const downloadMermaid = () => {
    const blob = new Blob([mermaid], { type: "text/vnd.mermaid" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${universeName || "universe"}-lineage.mmd`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded .mmd");
  };

  const downloadPng = async () => {
    if (!svgRef.current) return;
    try {
      await exportSvgAsPng(svgRef.current, `${universeName || "universe"}-lineage.png`, 2);
      toast.success("Exported PNG");
    } catch (err: any) {
      toast.error(`PNG export failed: ${err?.message ?? "unknown"}`);
    }
  };

  const downloadManifest = async () => {
    const manifest = await buildLineageManifest({
      universeId,
      universeName,
      lanes: [...LANES],
      nodes: visibleNodes,
      edges: visibleEdges,
    });
    downloadJson(`${universeName || "universe"}-lineage.json`, manifest);
    toast.success("Downloaded manifest");
  };

  const downloadBundle = async () => {
    try {
      setBundleProgress({ stage: "manifest", percent: 1, label: "Starting investor bundle…" });
      toast.loading("Packaging investor bundle…", { id: "investor-bundle" });
      const result = await downloadInvestorBundle({
        universeId,
        universeName,
        lanes: [...LANES],
        nodes: visibleNodes,
        edges: visibleEdges,
        mermaid,
        svg: svgRef.current,
        onProgress: (p) => {
          setBundleProgress(p);
          toast.loading(`${p.label} (${p.percent}%)`, { id: "investor-bundle" });
        },
      });
      setLastBundle(result);
      setBundleDialogOpen(true);
      toast.success("Investor bundle downloaded — integrity details available", {
        id: "investor-bundle",
        action: { label: "View checksums", onClick: () => setBundleDialogOpen(true) },
      });
    } catch (err: any) {
      toast.error(`Bundle failed: ${err?.message ?? "unknown"}`, { id: "investor-bundle" });
    } finally {
      // Keep the completed indicator visible briefly so users see the 100% state.
      setTimeout(() => setBundleProgress(null), 1200);
    }
  };

  const copySubgraphMermaid = async (seedId: string) => {
    const sub = lineageToSubgraphMermaid(visibleNodes, visibleEdges, [...LANES], seedId);
    try {
      await navigator.clipboard.writeText(sub);
      toast.success("Copied subgraph Mermaid");
    } catch {
      toast.error("Copy blocked");
    }
  };

  // ---------------- Permalink ----------------
  // Restore selected node from `?sel=` once nodes have loaded. One-shot.
  useEffect(() => {
    if (restoredSelectionRef.current) return;
    if (state.status !== "ready") return;
    const targetId = initialUrl?.sel;
    if (!targetId) {
      restoredSelectionRef.current = true;
      return;
    }
    const match = nodes.find((n) => n.id === targetId);
    if (match) setSelected(match);
    restoredSelectionRef.current = true;
  }, [state.status, nodes, initialUrl]);

  // Build a permalink that captures filters, search, pan/zoom, and selection,
  // then copy it to the clipboard and update the browser URL in place.
  const copyPermalink = async () => {
    const sp = new URLSearchParams();
    if (query.trim()) sp.set("q", query.trim());
    if (activeLanes.size !== LANES.length) sp.set("lanes", [...activeLanes].join(","));
    if (density !== "comfortable") sp.set("density", density);
    if (selected?.id) sp.set("sel", selected.id);
    const t = transformStateRef.current;
    if (Math.abs(t.scale - 1) > 0.001) sp.set("scale", t.scale.toFixed(3));
    if (Math.round(t.x) !== 0) sp.set("x", String(Math.round(t.x)));
    if (Math.round(t.y) !== 0) sp.set("y", String(Math.round(t.y)));
    const qs = sp.toString();
    const url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
    try {
      window.history.replaceState(null, "", url);
      await navigator.clipboard.writeText(url);
      toast.success("Permalink copied — preserves filters, view, and selection.");
    } catch {
      toast.error("Couldn't copy permalink");
    }
  };

  // Compact variant: encode the whole view-state object as a single base64url
  // token under ?v=. Much shorter than the long form, so it survives chat
  // clients, SMS, and email line-wrapping without breaking.
  const copyShortPermalink = async () => {
    const t = transformStateRef.current;
    const payload: ShortView = {};
    if (query.trim()) payload.q = query.trim();
    if (activeLanes.size !== LANES.length) payload.l = [...activeLanes].join(",");
    if (density === "compact") payload.d = "c";
    if (selected?.id) payload.s = selected.id;
    if (Math.abs(t.scale - 1) > 0.001) payload.z = Number(t.scale.toFixed(3));
    if (Math.round(t.x) !== 0) payload.x = Math.round(t.x);
    if (Math.round(t.y) !== 0) payload.y = Math.round(t.y);
    const hasAny = Object.keys(payload).length > 0;
    const token = hasAny ? b64urlEncode(JSON.stringify(payload)) : "";
    const url = `${window.location.origin}${window.location.pathname}${token ? `?v=${token}` : ""}`;
    try {
      window.history.replaceState(null, "", url);
      await navigator.clipboard.writeText(url);
      toast.success(`Short link copied (${url.length} chars).`);
    } catch {
      toast.error("Couldn't copy short link");
    }
  };

  // ---------------- Interaction ----------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") {
        setFocusLocked(null);
        setSelected(null);
      } else if (e.key === "f" || e.key === "F") {
        transformRef.current?.resetTransform?.();
      } else if (e.key === "+" || e.key === "=") {
        transformRef.current?.zoomIn?.();
      } else if (e.key === "-") {
        transformRef.current?.zoomOut?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleNodeClick = (n: LineageNode) => {
    setSelected(n);
    setFocusLocked(n.id);
    setLabelDraft(n.label);
    setEditingLabel(false);
    setNewEdgeTarget("");
    setNewEdgeType("rel");
    // Direct canvas / picker clicks are not hop selections, so clear any
    // previously pulsed ancestry edge.
    setHighlightedHop(null);
  };


  // ---------------- Inline editing ----------------
  const isEditableNode = (id?: string | null) => !!id && nodeMeta.has(id);
  const editableTargets = useMemo(
    () =>
      [...nodeMeta.keys()]
        .filter((id) => id !== selected?.id)
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is LineageNode => !!n),
    [nodeMeta, selected, nodes]
  );

  const saveLabel = async () => {
    if (!selected || !isEditableNode(selected.id)) return;
    const label = labelDraft.trim();
    if (!label || label === selected.label) {
      setEditingLabel(false);
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("provenance_nodes")
      .update({ label })
      .eq("id", selected.id);
    setBusy(false);
    if (error) {
      toast.error(`Rename failed: ${error.message}`);
      return;
    }
    setNodes((prev) => prev.map((n) => (n.id === selected.id ? { ...n, label } : n)));
    setSelected({ ...selected, label });
    setEditingLabel(false);
    toast.success("Renamed");
  };

  const deleteNode = async () => {
    if (!selected || !isEditableNode(selected.id)) return;
    if (!confirm(`Delete "${selected.label}" and its relationships?`)) return;
    setBusy(true);
    // Delete adjacent DB edges first (RLS allows owner)
    const adjacent = [...edgeMeta.entries()].filter(
      ([key]) => key.startsWith(`${selected.id}→`) || key.includes(`→${selected.id}::`)
    );
    if (adjacent.length) {
      const ids = adjacent.map(([, v]) => v.id);
      const { error: delEdgeErr } = await supabase
        .from("provenance_edges")
        .delete()
        .in("id", ids);
      if (delEdgeErr) {
        setBusy(false);
        toast.error(`Edge cleanup failed: ${delEdgeErr.message}`);
        return;
      }
    }
    const { error } = await supabase
      .from("provenance_nodes")
      .delete()
      .eq("id", selected.id);
    setBusy(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    setNodes((prev) => prev.filter((n) => n.id !== selected.id));
    setEdges((prev) =>
      prev.filter((e) => e.from_node_id !== selected.id && e.to_node_id !== selected.id)
    );
    setNodeMeta((prev) => {
      const next = new Map(prev);
      next.delete(selected.id);
      return next;
    });
    setEdgeMeta((prev) => {
      const next = new Map(prev);
      for (const [k] of adjacent) next.delete(k);
      return next;
    });
    setSelected(null);
    setFocusLocked(null);
    toast.success("Deleted node");
  };

  const deleteEdge = async (from: string, to: string, type: string) => {
    const key = edgeKeyOf(from, to, type);
    const meta = edgeMeta.get(key);
    if (!meta) {
      toast.error("This relationship is derived and can't be edited here.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("provenance_edges")
      .delete()
      .eq("id", meta.id);
    setBusy(false);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    setEdges((prev) =>
      prev.filter(
        (e) => !(e.from_node_id === from && e.to_node_id === to && e.edge_type === type)
      )
    );
    setEdgeMeta((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    toast.success("Relationship removed");
  };

  const updateEdgeType = async (from: string, to: string, type: string, nextType: string) => {
    const trimmed = nextType.trim();
    if (!trimmed || trimmed === type) return;
    const key = edgeKeyOf(from, to, type);
    const meta = edgeMeta.get(key);
    if (!meta) {
      toast.error("Derived relationship — not editable.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("provenance_edges")
      .update({ edge_type: trimmed })
      .eq("id", meta.id);
    setBusy(false);
    if (error) {
      toast.error(`Update failed: ${error.message}`);
      return;
    }
    setEdges((prev) =>
      prev.map((e) =>
        e.from_node_id === from && e.to_node_id === to && e.edge_type === type
          ? { ...e, edge_type: trimmed }
          : e
      )
    );
    setEdgeMeta((prev) => {
      const next = new Map(prev);
      next.delete(key);
      next.set(edgeKeyOf(from, to, trimmed), meta);
      return next;
    });
    toast.success("Updated relationship");
  };

  const addEdge = async () => {
    if (!selected || !isEditableNode(selected.id) || !newEdgeTarget) return;
    const targetMeta = nodeMeta.get(newEdgeTarget);
    const srcMeta = nodeMeta.get(selected.id);
    if (!srcMeta || !targetMeta) return;
    if (srcMeta.entry_id !== targetMeta.entry_id) {
      toast.error("Both nodes must belong to the same entry.");
      return;
    }
    const type = (newEdgeType || "rel").trim();
    setBusy(true);
    const { data, error } = await supabase
      .from("provenance_edges")
      .insert({
        entry_id: srcMeta.entry_id,
        from_node_id: selected.id,
        to_node_id: newEdgeTarget,
        edge_type: type,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      toast.error(`Add failed: ${error.message}`);
      return;
    }
    setEdges((prev) => [
      ...prev,
      { from_node_id: selected.id, to_node_id: newEdgeTarget, edge_type: type },
    ]);
    setEdgeMeta((prev) => {
      const next = new Map(prev);
      next.set(edgeKeyOf(selected.id, newEdgeTarget, type), {
        id: data!.id,
        entry_id: srcMeta.entry_id,
      });
      return next;
    });
    setNewEdgeTarget("");
    setNewEdgeType("rel");
    toast.success("Relationship added");
  };


  const drawerHref = useMemo(() => {
    if (!selected) return null;
    if (selected.id.startsWith("entry:")) return `/entry/${selected.id.slice(6)}`;
    if (selected.node_type === "universe") return `/universe/${universeId}`;
    if (selected.node_type === "parity_deal")
      return `/universe/${universeId}?tab=parity&deal=${selected.id.slice(7)}`;
    if (selected.node_type.startsWith("artifact_")) {
      // resolve entry by walking edges
      const parent = edges.find((e) => e.to_node_id === selected.id);
      if (parent?.from_node_id?.startsWith("entry:"))
        return `/entry/${parent.from_node_id.slice(6)}?artifact=${selected.id.slice(9)}`;
      return null;
    }
    // generic provenance — link to parent entry if known
    const parent = edges.find(
      (e) => e.to_node_id?.startsWith("entry:") && e.from_node_id === selected.id
    );
    if (parent) return `/entry/${parent.to_node_id.slice(6)}`;
    return null;
  }, [selected, edges, universeId]);

  const provenanceTrail = useMemo(() => {
    if (!selected) return [];
    return edges
      .filter((e) => e.to_node_id === selected.id || e.from_node_id === selected.id)
      .slice(0, 8);
  }, [selected, edges]);

  // ---------------- Ancestor path ----------------
  // Walk incoming edges (parent → selected) upward, hop by hop, until we
  // reach a universe node or run out of parents. Each step captures the
  // custody hand-off: which edge_type carried the artifact, when the
  // parent was created, and the parent's stable provenance id so
  // operators can cross-reference the attestation in the receipt log.
  interface AncestorStep {
    node: LineageNode;
    edgeType: string | null; // edge from `node` down to the child (null for the clicked node itself)
    childId: string | null;
    entryId: string | null;
    isRoot: boolean;
  }
  const ancestorPath = useMemo<AncestorStep[]>(() => {
    if (!selected) return [];
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    // Group incoming edges by their child (to_node_id) for O(1) parent lookup.
    const parentsByChild = new Map<string, LineageEdge[]>();
    for (const e of edges) {
      const arr = parentsByChild.get(e.to_node_id) ?? [];
      arr.push(e);
      parentsByChild.set(e.to_node_id, arr);
    }
    const steps: AncestorStep[] = [];
    const visited = new Set<string>();
    let current: LineageNode | undefined = selected;
    let downstreamEdgeType: string | null = null;
    let downstreamChildId: string | null = null;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const meta = nodeMeta.get(current.id);
      steps.push({
        node: current,
        edgeType: downstreamEdgeType,
        childId: downstreamChildId,
        entryId: meta?.entry_id ?? null,
        isRoot: current.node_type === "universe",
      });
      if (current.node_type === "universe") break;
      const parents = parentsByChild.get(current.id) ?? [];
      // Prefer the oldest parent — that's the canonical upstream custody
      // holder. Ties fall back to insertion order.
      const parent = parents
        .map((e) => ({ e, n: nodeById.get(e.from_node_id) }))
        .filter((p) => p.n && !visited.has(p.n.id))
        .sort((a, b) => {
          const ta = a.n?.created_at ? Date.parse(a.n.created_at) : Infinity;
          const tb = b.n?.created_at ? Date.parse(b.n.created_at) : Infinity;
          return ta - tb;
        })[0];
      if (!parent || !parent.n) break;
      downstreamEdgeType = parent.e.edge_type;
      downstreamChildId = current.id;
      current = parent.n;
    }
    return steps;
  }, [selected, edges, nodes, nodeMeta]);

  // Toggle a hop's expanded custody drawer. Lazily fetches the
  // submission_attestations rows for the hop's entry the first time it is
  // opened; subsequent opens reuse the cached result. Passing `null`
  // collapses whichever hop is currently open.
  const toggleHopDetails = useCallback(
    async (nodeId: string, entryId: string | null) => {
      setExpandedHopNodeId((prev) => (prev === nodeId ? null : nodeId));
      if (!entryId) return;
      const cached = attestationsByEntry.get(entryId);
      if (cached !== undefined) return;
      setAttestationsByEntry((prev) => {
        const next = new Map(prev);
        next.set(entryId, "loading");
        return next;
      });
      const { data, error } = await supabase
        .from("submission_attestations")
        .select(
          "id, entry_id, user_id, is_sole_author, has_rights, acknowledged_terms, attestation_text, created_at",
        )
        .eq("entry_id", entryId)
        .order("created_at", { ascending: false });
      setAttestationsByEntry((prev) => {
        const next = new Map(prev);
        next.set(entryId, error ? [] : ((data ?? []) as HopAttestation[]));
        return next;
      });
    },
    [attestationsByEntry],
  );

  // Reset expansion whenever the selected node changes — a fresh hop
  // list should start collapsed.
  useEffect(() => {
    setExpandedHopNodeId(null);
  }, [selected?.id]);




  const counts = useMemo(() => {
    const c: Record<Lane, number> = { source: 0, core: 0, consensus: 0, deliverable: 0 };
    for (const n of nodes) if (n.lane && c[n.lane as Lane] !== undefined) c[n.lane as Lane]++;
    return c;
  }, [nodes]);

  // ---------------- Render ----------------
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center justify-between gap-3"
        role="toolbar"
        aria-label="Lineage canvas toolbar"
      >
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Search and lane filters">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes…"
              aria-label="Search lineage nodes"
              className="pl-8 h-8 w-56 text-xs"
            />
          </div>
          {LANES.map((ln) => {
            const on = activeLanes.has(ln);
            return (
              <button
                key={ln}
                onClick={() => {
                  setActiveLanes((prev) => {
                    const next = new Set(prev);
                    if (next.has(ln)) next.delete(ln);
                    else next.add(ln);
                    return next.size ? next : new Set(LANES);
                  });
                }}
                aria-pressed={on}
                aria-label={`Toggle ${LANE_META[ln].label} lane (${counts[ln]} nodes)`}
                className={`text-[10px] font-mono uppercase tracking-wide px-2 py-1 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
                  on
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {LANE_META[ln].glyph} {LANE_META[ln].label}
                <span className="ml-1 opacity-60">{counts[ln]}</span>
              </button>
            );
          })}
          <button
            onClick={() => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"))}
            aria-label={`Switch to ${density === "comfortable" ? "compact" : "comfortable"} layout`}
            className="text-[10px] font-mono uppercase tracking-wide px-2 py-1 rounded-md border border-border/60 text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            {density === "comfortable" ? "Compact" : "Comfortable"}
          </button>
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="View, zoom, and export">
          <Button
            variant="outline"
            size="sm"
            onClick={() => transformRef.current?.zoomOut?.()}
            aria-label="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => transformRef.current?.zoomIn?.()}
            aria-label="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => transformRef.current?.resetTransform?.()}
            aria-label="Fit graph to view"
          >
            <Maximize2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Fit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={copyPermalink}
            aria-label="Copy shareable permalink"
            title="Copy a link that reproduces this exact view (filters, search, zoom, selection)"
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Share view
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={copyShortPermalink}
            aria-label="Copy compact short link"
            title="Copy a compact ?v= short link that encodes the same view in fewer characters"
          >
            <Link2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Short link
          </Button>
          <DropdownMenu modal>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label="Open export menu" aria-haspopup="menu">
                <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Export
              </Button>
            </DropdownMenuTrigger>
            {/* modal + Radix Menu trap Tab/Shift+Tab inside the menu and
                restore focus to the trigger on Escape or outside click. */}
            {/* `modal` + Radix Menu trap Tab/Shift+Tab inside the menu and
                restore focus to the trigger on Escape or outside click.
                `loop` keeps arrow-key navigation cycling within the menu. */}
            <DropdownMenuContent align="end" className="w-56" loop>
              <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                Snapshot
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={downloadPng}>
                <ImageDown className="h-3.5 w-3.5 mr-2" /> PNG (2×)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadManifest}>
                <FileJson className="h-3.5 w-3.5 mr-2" /> Lineage manifest (JSON)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                Mermaid
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={copyMermaid}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy to clipboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadMermaid}>
                <FileCode2 className="h-3.5 w-3.5 mr-2" /> Download .mmd
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                Partner-ready
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={downloadBundle}>
                <Package className="h-3.5 w-3.5 mr-2" /> Investor bundle (.zip)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.2em]">
        Source → Core → Consensus → Deliverable
      </p>

      {/* Canvas surface */}
      <div className="relative rounded-xl border border-border/60 bg-gradient-to-b from-card to-card/70 overflow-hidden">
        {/* Film-grain vignette */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 55%, hsl(var(--background) / 0.7) 100%)",
          }}
        />
        {state.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Tracing lineage…
          </div>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive opacity-70" />
            <p className="text-sm">{state.error}</p>
            <Button variant="outline" size="sm" onClick={loadLineage}>
              Retry
            </Button>
          </div>
        )}
        {state.status === "ready" && !members.length && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Sparkles className="h-8 w-8 text-primary opacity-70" />
            <p className="text-sm">This universe has no entries yet.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/submit">Add an entry</Link>
            </Button>
          </div>
        )}
        {state.status === "ready" && members.length > 0 && visibleNodes.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <GitBranch className="h-8 w-8 text-muted-foreground opacity-50" />
            <p className="text-sm">No nodes match your filters.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setActiveLanes(new Set(LANES));
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
        {state.status === "ready" && visibleNodes.length > 0 && (
          <TransformWrapper
            ref={transformRef as any}
            minScale={0.4}
            maxScale={2}
            initialScale={initialUrl?.scale ?? 1}
            initialPositionX={initialUrl?.x ?? 0}
            initialPositionY={initialUrl?.y ?? 0}
            wheel={{ step: 0.08 }}
            doubleClick={{ disabled: true }}
            panning={{ velocityDisabled: true, excluded: ["BUTTON", "INPUT", "TEXTAREA"] }}
            onTransform={(_ref, s) => {
              transformStateRef.current = {
                x: s.positionX,
                y: s.positionY,
                scale: s.scale,
              };
            }}
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: 620 }}
              contentStyle={{ width: "max-content", height: "max-content" }}
            >
              <LineageGraph
                ref={svgRef}
                nodes={visibleNodes}
                edges={visibleEdges}
                lanes={[...LANES]}
                laneMeta={LANE_META as any}
                density={density}
                focusedId={focusedId}
                highlightedNodeId={highlightedHop?.from ?? null}
                highlightedEdge={highlightedHop}
                onNodeClick={handleNodeClick}
                onNodeHover={(n) => setHovered(n)}
              />

            </TransformComponent>
          </TransformWrapper>
        )}
        {/* Keyboard hint */}
        {state.status === "ready" && visibleNodes.length > 0 && (
          <div className="absolute bottom-2 right-3 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
            scroll • drag • <kbd className="px-1 border border-border/40 rounded">F</kbd> fit ·{" "}
            <kbd className="px-1 border border-border/40 rounded">Esc</kbd> clear
          </div>
        )}
      </div>

      {/* Drawer — Sheet wraps Radix Dialog, which traps Tab/Shift+Tab inside
          SheetContent, intercepts Escape, blocks outside scroll, and restores
          focus to the previously focused element on close. `modal` is the
          default; declaring it keeps the trap from regressing if shadcn
          changes its defaults. */}
      <Sheet
        modal
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setFocusLocked(null);
            setHighlightedHop(null);
          }
        }}

      >
        <SheetContent
          className="w-[420px] sm:w-[540px] overflow-y-auto"
          aria-label="Lineage node details"
          onEscapeKeyDown={() => {
            setSelected(null);
            setFocusLocked(null);
          }}
        >
          <SheetHeader>
            <SheetTitle className="font-display text-xl flex items-center gap-2">
              {editingLabel && isEditableNode(selected?.id) ? (
                <>
                  <Input
                    autoFocus
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveLabel();
                      if (e.key === "Escape") setEditingLabel(false);
                    }}
                    className="h-8 text-base"
                  />
                  <Button size="icon" variant="ghost" disabled={busy} onClick={saveLabel} aria-label="Save">
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditingLabel(false);
                      setLabelDraft(selected?.label ?? "");
                    }}
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="truncate">{selected?.label}</span>
                  {isEditableNode(selected?.id) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setEditingLabel(true)}
                      aria-label="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </SheetTitle>
            <SheetDescription className="font-mono text-[11px] uppercase tracking-[0.18em]">
              {selected?.node_type.replace(/_/g, " ")}
              {selected?.lane && (
                <Badge variant="outline" className="ml-2 text-[9px]">
                  {LANE_META[selected.lane as Lane]?.label ?? selected.lane}
                </Badge>
              )}
              {!isEditableNode(selected?.id) && selected && (
                <Badge variant="secondary" className="ml-2 text-[9px]">derived</Badge>
              )}
            </SheetDescription>
          </SheetHeader>

          <Tabs defaultValue="overview" className="mt-6">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="ancestry">Ancestry</TabsTrigger>
              <TabsTrigger value="trail">Trail</TabsTrigger>
              <TabsTrigger value="edit" disabled={!isEditableNode(selected?.id)}>
                Edit
              </TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-3 text-sm">
              {selected?.created_at && (
                <p className="text-muted-foreground">
                  Created {new Date(selected.created_at).toLocaleString()}
                </p>
              )}
              {drawerHref ? (
                <Button asChild size="sm">
                  <Link to={drawerHref}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open
                  </Link>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Derived node — open the parent entry to edit upstream sources.
                </p>
              )}
            </TabsContent>

            {/* Ancestor path — step-by-step custody / attestation hand-off
                from the clicked artifact up to the universe root. Each row
                shows the parent node, the edge_type that carried the
                artifact into its child, when custody was recorded, and the
                stable provenance id operators can quote in an audit. */}
            <TabsContent value="ancestry" className="mt-4 space-y-2">
              {ancestorPath.length === 0 ? (
                <p className="text-xs text-muted-foreground">No ancestor path.</p>
              ) : (
                <ol className="space-y-1.5" aria-label="Ancestor custody path from selected node to universe root">
                  {ancestorPath.map((step, i) => {
                    const isSelected = i === 0;
                    const rootReached = step.isRoot;
                    const hopLabel = isSelected
                      ? "This node"
                      : rootReached
                      ? "Universe root"
                      : `Hop ${i}`;
                    const hop =
                      step.childId
                        ? { from: step.node.id, to: step.childId }
                        : null;
                    const isHopActive =
                      !!hop &&
                      highlightedHop?.from === hop.from &&
                      highlightedHop?.to === hop.to;
                    const selectHop = () => {
                      // Select the parent node (opens its drawer detail) and
                      // simultaneously pulse the parent → child edge on the
                      // canvas so the list row and the graph agree.
                      setSelected(step.node);
                      setFocusLocked(step.node.id);
                      setLabelDraft(step.node.label);
                      setEditingLabel(false);
                      setNewEdgeTarget("");
                      setNewEdgeType("rel");
                      setHighlightedHop(hop);
                    };
                    const isExpanded = expandedHopNodeId === step.node.id;
                    const attest = step.entryId
                      ? attestationsByEntry.get(step.entryId)
                      : undefined;
                    const attestLoading = attest === "loading";
                    const attestRows = Array.isArray(attest) ? attest : [];
                    // Find the underlying provenance_edges row for the
                    // custody hand-off (parent → child) so we can show the
                    // stable edge id operators can quote in an audit.
                    const custodyEdge =
                      step.childId
                        ? edges.find(
                            (e) =>
                              e.from_node_id === step.node.id &&
                              e.to_node_id === step.childId,
                          )
                        : null;
                    const custodyEdgeMeta =
                      custodyEdge && (edgeMeta as any).get
                        ? (edgeMeta as Map<string, { id: string; entry_id: string }>).get(
                            `${custodyEdge.from_node_id}|${custodyEdge.to_node_id}|${custodyEdge.edge_type}`,
                          )
                        : undefined;
                    return (
                      <li
                        key={step.node.id}
                        className={cn(
                          "rounded border text-xs transition-colors",
                          isHopActive
                            ? "border-primary bg-primary/10"
                            : isSelected
                            ? "border-primary/60 bg-primary/5"
                            : rootReached
                            ? "border-primary/40 bg-primary/[0.03]"
                            : "border-border/40",
                        )}
                      >
                        <div className="flex items-start">
                          <button
                            type="button"
                            onClick={selectHop}
                            aria-pressed={isHopActive}
                            aria-label={`${hopLabel}: ${step.node.label}${hop ? " — highlight edge to child" : ""}`}
                            className="flex-1 text-left px-2.5 py-2 space-y-1.5 rounded-l hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground shrink-0">
                                {String(i).padStart(2, "0")}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[9px] font-mono uppercase tracking-wide"
                              >
                                {hopLabel}
                              </Badge>
                              {step.node.lane && (
                                <Badge variant="secondary" className="text-[9px] font-mono uppercase">
                                  {LANE_META[step.node.lane as Lane]?.label ?? step.node.lane}
                                </Badge>
                              )}
                              <span className="truncate flex-1 font-medium">
                                {step.node.label}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground pl-1">
                              <span>
                                <span className="uppercase tracking-wider">type</span>{" "}
                                <span className="text-foreground/80">
                                  {step.node.node_type.replace(/_/g, " ")}
                                </span>
                              </span>
                              {step.node.created_at && (
                                <span>
                                  <span className="uppercase tracking-wider">at</span>{" "}
                                  <span className="text-foreground/80">
                                    {new Date(step.node.created_at).toLocaleString()}
                                  </span>
                                </span>
                              )}
                              {step.entryId && (
                                <span>
                                  <span className="uppercase tracking-wider">entry</span>{" "}
                                  <span className="text-foreground/80">
                                    {step.entryId.slice(0, 8)}…
                                  </span>
                                </span>
                              )}
                              <span title={step.node.id}>
                                <span className="uppercase tracking-wider">node</span>{" "}
                                <span className="text-foreground/80">
                                  {step.node.id.slice(0, 10)}…
                                </span>
                              </span>
                            </div>
                            {step.edgeType && step.childId && (
                              <div className="flex items-center gap-1.5 pl-1 pt-0.5 text-[10px] font-mono text-muted-foreground border-t border-border/30 mt-1">
                                <span aria-hidden="true">↓</span>
                                <span className="uppercase tracking-wider">custody via</span>
                                <span className="text-primary">{step.edgeType}</span>
                                <span className="uppercase tracking-wider">→</span>
                                <span className="text-foreground/80 truncate">
                                  {nodes.find((n) => n.id === step.childId)?.label ??
                                    step.childId.slice(0, 10) + "…"}
                                </span>
                              </div>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              toggleHopDetails(step.node.id, step.entryId)
                            }
                            aria-expanded={isExpanded}
                            aria-controls={`hop-details-${step.node.id}`}
                            aria-label={
                              isExpanded
                                ? `Collapse full custody record for ${step.node.label}`
                                : `Expand full custody record for ${step.node.label}`
                            }
                            className="shrink-0 px-2 py-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r border-l border-border/40"
                          >
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform",
                                isExpanded && "rotate-180",
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                        {isExpanded && (
                          <div
                            id={`hop-details-${step.node.id}`}
                            role="region"
                            aria-label={`Full custody record for ${step.node.label}`}
                            className="border-t border-border/40 px-2.5 py-2 space-y-3 bg-muted/10"
                          >
                            <section className="space-y-1">
                              <h5 className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                                Node record
                              </h5>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono">
                                <dt className="text-muted-foreground uppercase tracking-wider">id</dt>
                                <dd className="text-foreground/90 break-all">{step.node.id}</dd>
                                <dt className="text-muted-foreground uppercase tracking-wider">label</dt>
                                <dd className="text-foreground/90 break-all">{step.node.label}</dd>
                                <dt className="text-muted-foreground uppercase tracking-wider">type</dt>
                                <dd className="text-foreground/90">{step.node.node_type}</dd>
                                {step.node.lane && (
                                  <>
                                    <dt className="text-muted-foreground uppercase tracking-wider">lane</dt>
                                    <dd className="text-foreground/90">{step.node.lane}</dd>
                                  </>
                                )}
                                {step.node.created_at && (
                                  <>
                                    <dt className="text-muted-foreground uppercase tracking-wider">created</dt>
                                    <dd className="text-foreground/90">
                                      {new Date(step.node.created_at).toISOString()}
                                    </dd>
                                  </>
                                )}
                                {step.entryId && (
                                  <>
                                    <dt className="text-muted-foreground uppercase tracking-wider">entry</dt>
                                    <dd className="text-foreground/90 break-all">{step.entryId}</dd>
                                  </>
                                )}
                              </dl>
                            </section>

                            {custodyEdge && (
                              <section className="space-y-1">
                                <h5 className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                                  Custody edge
                                </h5>
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono">
                                  <dt className="text-muted-foreground uppercase tracking-wider">type</dt>
                                  <dd className="text-foreground/90">{custodyEdge.edge_type}</dd>
                                  <dt className="text-muted-foreground uppercase tracking-wider">from</dt>
                                  <dd className="text-foreground/90 break-all">{custodyEdge.from_node_id}</dd>
                                  <dt className="text-muted-foreground uppercase tracking-wider">to</dt>
                                  <dd className="text-foreground/90 break-all">{custodyEdge.to_node_id}</dd>
                                  {custodyEdgeMeta?.id && (
                                    <>
                                      <dt className="text-muted-foreground uppercase tracking-wider">edge id</dt>
                                      <dd className="text-foreground/90 break-all">{custodyEdgeMeta.id}</dd>
                                    </>
                                  )}
                                </dl>
                              </section>
                            )}

                            <section className="space-y-1">
                              <h5 className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                                Attestations
                              </h5>
                              {!step.entryId ? (
                                <p className="text-[10px] text-muted-foreground italic">
                                  No entry linked — attestations are recorded per submission.
                                </p>
                              ) : attestLoading ? (
                                <p className="text-[10px] text-muted-foreground italic flex items-center gap-1.5">
                                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                  Loading attestation records…
                                </p>
                              ) : attestRows.length === 0 ? (
                                <p className="text-[10px] text-muted-foreground italic">
                                  No attestations recorded for this entry.
                                </p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {attestRows.map((a) => (
                                    <li
                                      key={a.id}
                                      className="rounded border border-border/40 bg-background/40 px-2 py-1.5 space-y-0.5"
                                    >
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono">
                                        <Badge
                                          variant={a.is_sole_author ? "default" : "outline"}
                                          className="text-[9px] uppercase"
                                        >
                                          {a.is_sole_author ? "sole author" : "co-author"}
                                        </Badge>
                                        <Badge
                                          variant={a.has_rights ? "default" : "outline"}
                                          className="text-[9px] uppercase"
                                        >
                                          {a.has_rights ? "rights ✓" : "rights ✗"}
                                        </Badge>
                                        <Badge
                                          variant={a.acknowledged_terms ? "default" : "outline"}
                                          className="text-[9px] uppercase"
                                        >
                                          {a.acknowledged_terms ? "terms ✓" : "terms ✗"}
                                        </Badge>
                                        {a.created_at && (
                                          <span className="text-muted-foreground">
                                            {new Date(a.created_at).toLocaleString()}
                                          </span>
                                        )}
                                      </div>
                                      {a.attestation_text && (
                                        <p className="text-[10px] text-foreground/80 whitespace-pre-wrap">
                                          {a.attestation_text}
                                        </p>
                                      )}
                                      <p className="text-[9px] font-mono text-muted-foreground break-all">
                                        id {a.id}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}

              {ancestorPath.length > 0 &&
                !ancestorPath[ancestorPath.length - 1].isRoot && (
                  <p className="text-[10px] text-muted-foreground italic pt-1">
                    Path ended before reaching a universe root — upstream custody
                    edges may not be recorded in this universe.
                  </p>
                )}
            </TabsContent>

            <TabsContent value="trail" className="mt-4 space-y-2">
              {provenanceTrail.length === 0 ? (
                <p className="text-xs text-muted-foreground">No connected edges.</p>
              ) : (
                provenanceTrail.map((e, i) => {
                  const otherId = e.from_node_id === selected?.id ? e.to_node_id : e.from_node_id;
                  const other = nodes.find((n) => n.id === otherId);
                  const direction = e.from_node_id === selected?.id ? "→" : "←";
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-border/40 hover:bg-muted/40 cursor-pointer"
                      onClick={() => other && handleNodeClick(other)}
                    >
                      <span className="font-mono text-muted-foreground">{direction}</span>
                      <span className="font-mono text-[10px] text-primary uppercase tracking-wide">
                        {e.edge_type}
                      </span>
                      <span className="truncate">{other?.label ?? otherId}</span>
                    </div>
                  );
                })
              )}
            </TabsContent>

            <TabsContent value="edit" className="mt-4 space-y-5">
              {!isEditableNode(selected?.id) ? (
                <p className="text-xs text-muted-foreground">
                  This node is derived from another system surface and isn't editable from the canvas.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                      Label
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        className="h-8 text-sm"
                      />
                      <Button size="sm" disabled={busy} onClick={saveLabel}>
                        <Save className="h-3.5 w-3.5 mr-1.5" /> Save
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                      Relationships
                    </Label>
                    <div className="space-y-1.5">
                      {edges
                        .filter(
                          (e) =>
                            (e.from_node_id === selected?.id || e.to_node_id === selected?.id) &&
                            edgeMeta.has(edgeKeyOf(e.from_node_id, e.to_node_id, e.edge_type))
                        )
                        .map((e, i) => {
                          const otherId =
                            e.from_node_id === selected?.id ? e.to_node_id : e.from_node_id;
                          const other = nodes.find((n) => n.id === otherId);
                          const dir = e.from_node_id === selected?.id ? "→" : "←";
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-2 px-2 py-1.5 rounded border border-border/40"
                            >
                              <span className="font-mono text-muted-foreground">{dir}</span>
                              <Input
                                defaultValue={e.edge_type}
                                onBlur={(ev) =>
                                  updateEdgeType(
                                    e.from_node_id,
                                    e.to_node_id,
                                    e.edge_type,
                                    ev.target.value
                                  )
                                }
                                className="h-7 text-xs font-mono w-28"
                              />
                              <span className="truncate text-xs flex-1">{other?.label ?? otherId}</span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive"
                                disabled={busy}
                                onClick={() =>
                                  deleteEdge(e.from_node_id, e.to_node_id, e.edge_type)
                                }
                                aria-label="Delete relationship"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })}
                      {edges.filter(
                        (e) =>
                          (e.from_node_id === selected?.id || e.to_node_id === selected?.id) &&
                          edgeMeta.has(edgeKeyOf(e.from_node_id, e.to_node_id, e.edge_type))
                      ).length === 0 && (
                        <p className="text-[11px] text-muted-foreground italic">
                          No editable relationships yet.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/40 pt-4">
                    <Label className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                      Add relationship (from this node)
                    </Label>
                    <Select value={newEdgeTarget} onValueChange={setNewEdgeTarget}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Target node…" />
                      </SelectTrigger>
                      <SelectContent>
                        {editableTargets
                          .filter((n) => {
                            const srcEntry = nodeMeta.get(selected!.id)?.entry_id;
                            return nodeMeta.get(n.id)?.entry_id === srcEntry;
                          })
                          .map((n) => (
                            <SelectItem key={n.id} value={n.id}>
                              {n.label}{" "}
                              <span className="text-muted-foreground ml-1 text-[10px]">
                                · {n.node_type}
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Input
                        value={newEdgeType}
                        onChange={(e) => setNewEdgeType(e.target.value)}
                        placeholder="edge_type (e.g. appears_in)"
                        className="h-8 text-xs font-mono"
                      />
                      <Button
                        size="sm"
                        disabled={busy || !newEdgeTarget}
                        onClick={addEdge}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1.5" /> Add
                      </Button>
                    </div>
                  </div>

                  <div className="border-t border-border/40 pt-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      disabled={busy}
                      onClick={deleteNode}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete node
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="actions" className="mt-4 space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => selected && copySubgraphMermaid(selected.id)}
              >
                <Copy className="h-3.5 w-3.5 mr-2" /> Copy subgraph Mermaid
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => setFocusLocked(selected?.id ?? null)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-2" /> Focus on this node
              </Button>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Floating progress indicator surfaced while the investor bundle is
          being assembled — stays mounted briefly after completion so users
          see the final 100% state before it fades. */}
      {bundleProgress && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 w-80 rounded-md border border-border bg-card/95 backdrop-blur p-4 shadow-lg"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium font-display">Investor bundle</div>
            <div className="text-xs text-muted-foreground font-mono">
              {bundleProgress.percent}%
            </div>
          </div>
          <Progress value={bundleProgress.percent} className="h-1.5" />
          <div className="mt-2 text-xs text-muted-foreground truncate">
            {bundleProgress.label}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Stage: {bundleProgress.stage}
          </div>
        </div>
      )}

      {/* Investor-bundle integrity dialog: shows per-file SHA-256 + timestamps
          so a partner can verify the download matches what the UI generated. */}
      <Dialog open={bundleDialogOpen} onOpenChange={setBundleDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display">Investor bundle — integrity</DialogTitle>
            <DialogDescription>
              {lastBundle ? (
                <>
                  {lastBundle.filename} · Generated{" "}
                  {new Date(lastBundle.generated_at).toLocaleString()} ·{" "}
                  <span className="font-mono">SHA-256 {lastBundle.bundle_sha256.slice(0, 12)}…</span>
                </>
              ) : (
                "Export a bundle to see file checksums."
              )}
            </DialogDescription>
          </DialogHeader>
          {lastBundle && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">File</th>
                    <th className="py-1.5 pr-3 font-medium">Generated (UTC)</th>
                    <th className="py-1.5 pr-3 font-medium">SHA-256</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {lastBundle.files.map((f) => (
                    <tr key={f.name} className="border-t border-border/50 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{f.name}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {f.generated_at}
                      </td>
                      <td className="py-2 pr-3 break-all">
                        <button
                          type="button"
                          className="text-left hover:text-primary transition-colors"
                          onClick={() => {
                            navigator.clipboard.writeText(f.sha256).then(
                              () => toast.success(`Copied SHA-256 for ${f.name}`),
                              () => toast.error("Couldn't copy"),
                            );
                          }}
                          aria-label={`Copy SHA-256 for ${f.name}`}
                          title="Click to copy"
                        >
                          {f.sha256}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter className="gap-2">
            {lastBundle && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const lines = [
                    `Bundle: ${lastBundle.filename}`,
                    `Generated: ${lastBundle.generated_at}`,
                    `Bundle SHA-256: ${lastBundle.bundle_sha256}`,
                    ``,
                    ...lastBundle.files.map(
                      (f) => `${f.sha256}  ${f.name}  (${f.generated_at})`,
                    ),
                  ].join("\n");
                  navigator.clipboard.writeText(lines).then(
                    () => toast.success("Copied integrity report"),
                    () => toast.error("Couldn't copy"),
                  );
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy report
              </Button>
            )}
            <Button size="sm" onClick={() => setBundleDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
