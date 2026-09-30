// Client-side exporters that convert a preproduction_pack payload into
// storyboard-ready downloads for each mode (live action, animation, AI gen).

import JSZip from "jszip";
import type { PrepPack } from "@/lib/preproductionPack";

export type { PrepPack } from "@/lib/preproductionPack";

// ---------- helpers ----------

function csvEscape(v: unknown): string {
  const raw = v == null ? "" : String(v);
  // Spreadsheet programs may execute string cells beginning with a formula
  // prefix. Preserve numeric values, but force suspicious text to remain text.
  const s = typeof v === "string" && /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number | undefined | null)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Live Action ----------

export function buildLiveActionCsv(pack: PrepPack): string {
  const rows: (string | number | undefined)[][] = [
    ["scene_index", "slug", "page_estimate", "intent", "shot", "framing", "lens_mm", "movement", "description", "beat"],
  ];
  for (const sc of pack.live_action?.scenes ?? []) {
    for (const s of sc.shots ?? []) {
      rows.push([
        sc.scene_index, sc.slug, sc.page_estimate ?? "", sc.intent ?? "",
        s.shot, s.framing, s.lens_mm ?? "", s.movement ?? "", s.description, s.beat ?? "",
      ]);
    }
  }
  return toCsv(rows);
}

export function buildLiveActionMarkdown(pack: PrepPack): string {
  const la = pack.live_action;
  if (!la) return "# Live Action\n\n_No live-action track in this pack._\n";
  const lines: string[] = ["# Live Action Breakdown", ""];
  if (pack.summary?.logline) lines.push(`> ${pack.summary.logline}`, "");
  if (la.crew_notes) lines.push(`**Crew notes:** ${la.crew_notes}`, "");
  if (la.locations?.length) {
    lines.push("## Locations", "");
    for (const loc of la.locations) {
      lines.push(`- **${loc.name}**${loc.type ? ` _(${loc.type})_` : ""} — scenes ${loc.scenes.join(", ")}${loc.notes ? ` — ${loc.notes}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Scene-by-scene shot list", "");
  for (const sc of la.scenes ?? []) {
    lines.push(`### #${sc.scene_index} · ${sc.slug}${sc.page_estimate != null ? ` _(~${sc.page_estimate}p)_` : ""}`);
    if (sc.intent) lines.push(`_${sc.intent}_`, "");
    lines.push("| Shot | Framing | Lens | Movement | Description | Beat |");
    lines.push("|------|---------|------|----------|-------------|------|");
    for (const s of sc.shots ?? []) {
      lines.push(`| ${s.shot} | ${s.framing} | ${s.lens_mm ?? "—"} | ${s.movement ?? "—"} | ${s.description.replace(/\|/g, "\\|")} | ${s.beat ?? "—"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- Animation ----------

export function buildAnimationMarkdown(pack: PrepPack): string {
  const an = pack.animation;
  if (!an) return "# Animation\n\n_No animation track in this pack._\n";
  const lines: string[] = ["# Animation Storyboard Pack", ""];
  if (an.style_target) lines.push(`**Style target:** ${an.style_target}`, "");
  if (an.character_sheets?.length) {
    lines.push("## Character sheets", "");
    for (const c of an.character_sheets) {
      lines.push(`### ${c.name}`);
      if (c.silhouette) lines.push(`- Silhouette: ${c.silhouette}`);
      if (c.palette?.length) lines.push(`- Palette: ${c.palette.join(", ")}`);
      if (c.expression_range?.length) lines.push(`- Expressions: ${c.expression_range.join(", ")}`);
      lines.push("");
    }
  }
  if (an.key_frames?.length) {
    lines.push("## Key frames", "");
    for (const k of an.key_frames) {
      lines.push(`- **${k.frame}**${k.scene_index != null ? ` _(scene ${k.scene_index})_` : ""} — ${k.description}${k.staging ? ` · staging: ${k.staging}` : ""}`);
    }
    lines.push("");
  }
  if (an.pipeline_notes) lines.push("## Pipeline notes", "", an.pipeline_notes, "");
  return lines.join("\n");
}

// ---------- AI Generation ----------

export function buildAiPromptsCsv(pack: PrepPack): string {
  const ai = pack.ai_generation;
  const rows: (string | number | undefined)[][] = [
    ["scene_index", "shot", "style_prompt", "image_prompt", "motion_prompt", "negative_prompt", "aspect_ratio", "seed_hint"],
  ];
  if (!ai) return toCsv(rows);
  for (const sp of ai.shot_prompts ?? []) {
    rows.push([
      sp.scene_index, sp.shot, ai.style_prompt, sp.image_prompt, sp.motion_prompt ?? "",
      ai.negative_prompt ?? "", ai.aspect_ratio ?? "", sp.seed_hint ?? "",
    ]);
  }
  return toCsv(rows);
}

export function buildAiPromptsText(pack: PrepPack): string {
  const ai = pack.ai_generation;
  if (!ai) return "# AI Generation\n\n(No AI-generation track in this pack.)\n";
  const lines: string[] = [
    "# AI Generation Prompts",
    "",
    `Style: ${ai.style_prompt}`,
    ai.negative_prompt ? `Negative: ${ai.negative_prompt}` : "",
    ai.aspect_ratio ? `Aspect ratio: ${ai.aspect_ratio}` : "",
    "",
  ].filter(Boolean);
  if (ai.continuity_tokens?.length) {
    lines.push("Continuity tokens:");
    for (const t of ai.continuity_tokens) {
      lines.push(`  ${t.token} = ${t.refers_to}${t.description ? ` — ${t.description}` : ""}`);
    }
    lines.push("");
  }
  lines.push("---", "");
  for (const sp of ai.shot_prompts ?? []) {
    lines.push(`## #${sp.scene_index} · ${sp.shot}`);
    if (sp.seed_hint) lines.push(`seed: ${sp.seed_hint}`);
    lines.push("");
    lines.push("IMAGE:");
    lines.push(sp.image_prompt);
    if (sp.motion_prompt) {
      lines.push("", "MOTION:");
      lines.push(sp.motion_prompt);
    }
    lines.push("", "---", "");
  }
  return lines.join("\n");
}

// ---------- Per-mode + bundle exports ----------

export function exportLiveAction(pack: PrepPack, version: number) {
  downloadBlob(new Blob([buildLiveActionCsv(pack)], { type: "text/csv" }),
    `live-action-shotlist-v${version}.csv`);
  downloadBlob(new Blob([buildLiveActionMarkdown(pack)], { type: "text/markdown" }),
    `live-action-breakdown-v${version}.md`);
}

export function exportAnimation(pack: PrepPack, version: number) {
  downloadBlob(new Blob([buildAnimationMarkdown(pack)], { type: "text/markdown" }),
    `animation-storyboard-v${version}.md`);
}

export function exportAiGeneration(pack: PrepPack, version: number) {
  downloadBlob(new Blob([buildAiPromptsCsv(pack)], { type: "text/csv" }),
    `ai-prompts-v${version}.csv`);
  downloadBlob(new Blob([buildAiPromptsText(pack)], { type: "text/plain" }),
    `ai-prompts-v${version}.txt`);
}

export async function exportPreproductionZip(pack: PrepPack, version: number, canonicalText?: string) {
  const zip = new JSZip();
  const root = zip.folder(`preproduction-v${version}`)!;

  // README
  const readmeLines = [
    `# Preproduction Pack v${version}`,
    "",
    pack.summary?.logline ? `> ${pack.summary.logline}` : "",
    "",
    pack._meta?.generated_at ? `Generated: ${pack._meta.generated_at}` : "",
    pack._meta?.model ? `Model: ${pack._meta.model}` : "",
    pack._meta?.context_hash ? `Context bundle: ${pack._meta.context_hash}` : "",
    "",
    "## Contents",
    pack.live_action ? "- `live-action/` — shot list (CSV) + scene breakdown (MD)" : "",
    pack.animation ? "- `animation/` — storyboard pack (MD) with character sheets and key frames" : "",
    pack.ai_generation ? "- `ai-generation/` — prompt sheet (CSV) + human-readable brief (TXT)" : "",
    "- `pack.json` — full structured payload",
    "",
  ].filter(Boolean);
  root.file("README.md", readmeLines.join("\n"));
  root.file("pack.json", canonicalText ?? JSON.stringify(pack, null, 2));

  if (pack.live_action) {
    const la = root.folder("live-action")!;
    la.file("shotlist.csv", buildLiveActionCsv(pack));
    la.file("breakdown.md", buildLiveActionMarkdown(pack));
  }
  if (pack.animation) {
    const an = root.folder("animation")!;
    an.file("storyboard.md", buildAnimationMarkdown(pack));
  }
  if (pack.ai_generation) {
    const ai = root.folder("ai-generation")!;
    ai.file("prompts.csv", buildAiPromptsCsv(pack));
    ai.file("prompts.txt", buildAiPromptsText(pack));
  }
  if (pack.open_questions?.length) {
    root.file("open-questions.md",
      ["# Open questions", "", ...pack.open_questions.map((q) => `- ${q}`)].join("\n"));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `preproduction-v${version}.zip`);
}
