import { toPng } from "html-to-image";
import JSZip from "jszip";
import type { LineageNode, LineageEdge } from "@/components/LineageGraph";

export async function exportSvgAsPng(
  svg: SVGSVGElement,
  fileName: string,
  pixelRatio = 2
): Promise<void> {
  // html-to-image accepts an HTMLElement; wrap the SVG in a temporary container
  // so its width/height are honored at export time.
  const wrapper = document.createElement("div");
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  // Inline background so dark theme captures look right
  cloned.style.background = "hsl(var(--card))";
  wrapper.style.position = "fixed";
  wrapper.style.top = "-10000px";
  wrapper.style.left = "0";
  wrapper.appendChild(cloned);
  document.body.appendChild(wrapper);
  try {
    const dataUrl = await toPng(wrapper, {
      pixelRatio,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = fileName;
    a.click();
  } finally {
    document.body.removeChild(wrapper);
  }
}

export interface LineageManifest {
  generated_at: string;
  universe_id: string;
  universe_name: string;
  lanes: string[];
  nodes: LineageNode[];
  edges: LineageEdge[];
  content_hash: string;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildLineageManifest(args: {
  universeId: string;
  universeName: string;
  lanes: string[];
  nodes: LineageNode[];
  edges: LineageEdge[];
}): Promise<LineageManifest> {
  const base = {
    generated_at: new Date().toISOString(),
    universe_id: args.universeId,
    universe_name: args.universeName,
    lanes: args.lanes,
    nodes: args.nodes,
    edges: args.edges,
  };
  const content_hash = await sha256Hex(
    JSON.stringify({ nodes: args.nodes, edges: args.edges, lanes: args.lanes })
  );
  return { ...base, content_hash };
}

export function downloadJson(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export type BundleStage =
  | "manifest"
  | "mermaid"
  | "json"
  | "png"
  | "readme"
  | "zip"
  | "done";

export interface BundleProgress {
  stage: BundleStage;
  /** Integer in [0,100] describing overall completion. */
  percent: number;
  /** Short human-readable label for the current step. */
  label: string;
}

export interface InvestorBundleArgs {
  universeId: string;
  universeName: string;
  lanes: string[];
  nodes: LineageNode[];
  edges: LineageEdge[];
  mermaid: string;
  /** Optional SVG element to include a PNG snapshot in the bundle. */
  svg?: SVGSVGElement | null;
  /** Optional progress callback invoked on each stage transition. */
  onProgress?: (p: BundleProgress) => void;
}

function slugify(s: string): string {
  return (s || "universe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "universe";
}

async function svgToPngBlob(svg: SVGSVGElement, pixelRatio = 2): Promise<Blob | null> {
  const wrapper = document.createElement("div");
  const cloned = svg.cloneNode(true) as SVGSVGElement;
  cloned.style.background = "hsl(var(--card))";
  wrapper.style.position = "fixed";
  wrapper.style.top = "-10000px";
  wrapper.style.left = "0";
  wrapper.appendChild(cloned);
  document.body.appendChild(wrapper);
  try {
    const dataUrl = await toPng(wrapper, {
      pixelRatio,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
    });
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  } finally {
    document.body.removeChild(wrapper);
  }
}

async function sha256OfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ExportFileInfo {
  name: string;
  bytes: number;
  sha256: string;
  generated_at: string; // ISO timestamp this specific file was produced
  description: string;
}

export interface InvestorBundleResult {
  blob: Blob;
  files: ExportFileInfo[];
  generated_at: string; // bundle assembly timestamp
  bundle_sha256: string; // checksum of the full zip
  filename: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function buildReadme(
  args: InvestorBundleArgs,
  bundleHash: string,
  generatedAt: string,
  files: ExportFileInfo[],
): string {
  const counts: Record<string, number> = {};
  for (const n of args.nodes) {
    const key = n.lane || "unassigned";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const laneSummary = args.lanes
    .map((l) => `  - ${l}: ${counts[l] ?? 0} node(s)`)
    .join("\n");

  // Render a verifiable integrity table so partners can recompute hashes
  // with: `shasum -a 256 <file>` and confirm nothing was tampered with.
  const integrity = files
    .map(
      (f) =>
        `| ${f.name} | ${formatBytes(f.bytes)} | ${f.generated_at} | \`${f.sha256}\` |`,
    )
    .join("\n");

  return [
    `# Investor Bundle — ${args.universeName || "Universe"}`,
    ``,
    `Bundle generated: ${generatedAt}`,
    `Universe ID: ${args.universeId}`,
    `Bundle SHA-256: \`${bundleHash}\``,
    ``,
    `## Contents`,
    ...files.map((f) => `- ${f.name.padEnd(20)} ${f.description}`),
    ``,
    `## File integrity`,
    ``,
    `Each file below was hashed at generation time. To verify, run`,
    `\`shasum -a 256 <file>\` (macOS/Linux) or \`certutil -hashfile <file> SHA256\``,
    `(Windows) and compare against the value listed here.`,
    ``,
    `| File | Size | Generated (UTC) | SHA-256 |`,
    `|------|------|-----------------|---------|`,
    integrity,
    ``,
    `## Summary`,
    `- Nodes: ${args.nodes.length}`,
    `- Edges: ${args.edges.length}`,
    `- Lanes:`,
    laneSummary,
    ``,
    `## Use`,
    `This bundle is intended for partners, investors, and licensing review.`,
    `The Mermaid file renders in any Markdown viewer that supports Mermaid`,
    `(GitHub, Notion, Obsidian). The JSON snapshot is the canonical machine-`,
    `readable record; the per-file hashes above prove integrity of every`,
    `artifact independently of the surrounding zip.`,
    ``,
  ].join("\n");
}

export async function buildInvestorBundle(
  args: InvestorBundleArgs,
): Promise<InvestorBundleResult> {
  const emit = (stage: BundleStage, percent: number, label: string) => {
    try {
      args.onProgress?.({ stage, percent, label });
    } catch {
      // progress callbacks must never break the export
    }
  };

  emit("manifest", 5, "Collecting nodes, edges and lanes…");
  const manifest = await buildLineageManifest({
    universeId: args.universeId,
    universeName: args.universeName,
    lanes: args.lanes,
    nodes: args.nodes,
    edges: args.edges,
  });

  // Build each file's bytes first so we can hash + size them individually
  // before assembling the README and the final zip.
  const files: ExportFileInfo[] = [];
  const enc = new TextEncoder();

  emit("mermaid", 20, "Writing lineage.mmd…");
  const mmdBytes = enc.encode(args.mermaid);
  const mmdBlob = new Blob([mmdBytes], { type: "text/vnd.mermaid" });
  files.push({
    name: "lineage.mmd",
    bytes: mmdBytes.byteLength,
    sha256: await sha256OfBlob(mmdBlob),
    generated_at: manifest.generated_at,
    description: "Mermaid source for the current lineage view",
  });

  emit("json", 40, "Writing lineage.json…");
  const jsonText = JSON.stringify(manifest, null, 2);
  const jsonBytes = enc.encode(jsonText);
  const jsonBlob = new Blob([jsonBytes], { type: "application/json" });
  files.push({
    name: "lineage.json",
    bytes: jsonBytes.byteLength,
    sha256: await sha256OfBlob(jsonBlob),
    generated_at: manifest.generated_at,
    description: "Formatted JSON snapshot (nodes, edges, lanes, content hash)",
  });

  let pngBlob: Blob | null = null;
  if (args.svg) {
    emit("png", 60, "Rendering lineage.png…");
    pngBlob = await svgToPngBlob(args.svg, 2);
    if (pngBlob) {
      files.push({
        name: "lineage.png",
        bytes: pngBlob.size,
        sha256: await sha256OfBlob(pngBlob),
        generated_at: new Date().toISOString(),
        description: "Static PNG snapshot of the canvas (2× pixel ratio)",
      });
    }
  } else {
    emit("png", 60, "Skipping PNG snapshot (no SVG available)…");
  }

  emit("readme", 78, "Building README.md and checksums…");
  const generatedAt = new Date().toISOString();
  // Bundle hash spans every contained file's hash + the generation timestamp,
  // so any change to a contained artifact invalidates the bundle checksum.
  const bundleHashBasis = JSON.stringify({
    generated_at: generatedAt,
    files: files.map((f) => ({ name: f.name, sha256: f.sha256 })),
  });
  const bundleSha = await sha256Hex(bundleHashBasis);

  // README is appended last so it can reference every other file's hash.
  const readmeFiles: ExportFileInfo[] = [
    ...files,
    {
      name: "README.md",
      bytes: 0, // filled in after we know the README text
      sha256: "(self)",
      generated_at: generatedAt,
      description: "This document — bundle overview and integrity table",
    },
  ];
  const readmeText = buildReadme(args, bundleSha, generatedAt, readmeFiles);
  const readmeBytes = enc.encode(readmeText);
  const readmeBlob = new Blob([readmeBytes], { type: "text/markdown" });
  const readmeSha = await sha256OfBlob(readmeBlob);
  const readmeInfo: ExportFileInfo = {
    name: "README.md",
    bytes: readmeBytes.byteLength,
    sha256: readmeSha,
    generated_at: generatedAt,
    description: "This document — bundle overview and integrity table",
  };

  emit("zip", 90, "Compressing investor bundle…");
  const zip = new JSZip();
  zip.file("README.md", readmeBytes);
  zip.file("lineage.mmd", mmdBytes);
  zip.file("lineage.json", jsonBytes);
  if (pngBlob) zip.file("lineage.png", pngBlob);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });

  const stamp = generatedAt.slice(0, 10);
  const filename = `${slugify(args.universeName)}-investor-bundle-${stamp}.zip`;

  emit("done", 100, "Bundle ready");
  return {
    blob,
    files: [...files, readmeInfo],
    generated_at: generatedAt,
    bundle_sha256: bundleSha,
    filename,
  };
}

export async function downloadInvestorBundle(
  args: InvestorBundleArgs,
): Promise<InvestorBundleResult> {
  const result = await buildInvestorBundle(args);
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  a.click();
  URL.revokeObjectURL(url);
  return result;
}
