/**
 * Cinema Aurea PDF smoke test.
 *
 * For every real exporter in the app, this script instantiates a jsPDF
 * document, invokes the shared `renderTitleBand()` cover + `drawFooter()`
 * on every page using the same title/subtitle/eyebrow spec the exporter
 * uses in production, writes the PDF to /mnt/documents/, and then inspects
 * each page's raw content stream to prove:
 *
 *   1. The band background rectangle (near-black fill) is painted on every page.
 *   2. The gold hairline is stroked at the band's bottom edge.
 *   3. The footer's brand string is present on every page.
 *
 * If any assertion fails the script exits non-zero and prints which
 * exporter/page/invariant broke.
 *
 * Usage:
 *   bunx tsx scripts/pdfSmoke.ts
 *
 * Flags (all optional, repeatable / comma-separated):
 *   --only <names>       Run only these exporters (comma-separated slugs or
 *                        substring matches). Ex: --only submissionReceipt,parity
 *   --skip <names>       Skip these exporters (same matching rules).
 *   --pages <spec>       Override page counts. Either a single number applied
 *                        to every selected exporter (`--pages 1`) or per-name
 *                        pairs (`--pages submissionReceipt=1,exportOutline=2`).
 *   --max-pages <n>      Cap every exporter's page count at <n> (fastest way
 *                        to iterate on cover/footer changes).
 *   --list               Print the available exporter slugs and exit.
 *   --help, -h           Print usage and exit.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { jsPDF } from "jspdf";
import {
  drawFooter,
  drawRule,
  drawSectionHeading,
  getCinemaAureaSettings,
  ptToUnit,
  renderTitleBand,
  resetCinemaAureaSettings,
} from "../src/lib/pdf/pdfRenderer";

interface ExporterSample {
  /** Slug used in the output filename. */
  name: string;
  /** Which real exporter this stand-in mirrors. */
  source: string;
  unit: "pt" | "in" | "mm";
  format: "letter" | "a4";
  bandSpec: { title: string; subtitle?: string; eyebrow?: string };
  /** Number of body pages to synthesize (>=1). */
  pageCount: number;
  /** Optional right-side footer text; falls back to `Page N`. */
  footerRight?: (page: number, total: number) => string;
}

const OUT_DIR = "/mnt/documents/pdf-smoke";
mkdirSync(OUT_DIR, { recursive: true });

/**
 * Each entry mirrors the real exporter's cover parameters. When an
 * exporter changes its title/subtitle vocabulary this table must be
 * updated so the smoke test stays representative.
 */
const SAMPLES: ExporterSample[] = [
  {
    name: "submissionReceipt",
    source: "src/lib/submissionReceipt.ts",
    unit: "in",
    format: "letter",
    bandSpec: {
      eyebrow: "Cinema Aurea",
      title: "Submission Receipt",
      subtitle: "Entry #DEMO-0001 · Competition: Vertical Films Vol.1",
    },
    pageCount: 2,
    footerRight: (p, t) => `Page ${p} of ${t}`,
  },
  {
    name: "exportOutline",
    source: "src/lib/exportOutline.ts",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Story Outline",
      title: "The Long Way Home",
      subtitle: "Feature · Drama · 112 pages",
    },
    pageCount: 3,
    footerRight: (p, t) => `Page ${p} of ${t}`,
  },
  {
    name: "exportEvidencePDF",
    source: "src/lib/export/exportEvidencePDF.ts",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Evidence Bundle · v1",
      title: "Authorship Provenance Certificate",
      subtitle: "SHA-256 · a1b2c3d4e5f6…",
    },
    pageCount: 2,
  },
  {
    name: "parityAgreement",
    source: "src/components/parity/ParityAgreementExport.tsx",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Cinema Aurea · Parity Deal",
      title: "Sing Sing Profit Participation",
      subtitle: "Universe: Northern Lights · v2026-07",
    },
    pageCount: 2,
  },
  {
    name: "rubricImpact",
    source: "src/components/admin/RubricImpactPanel.tsx",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Rubric Impact Report",
      title: "Standard v1 → Standard v2",
      subtitle: "12 entries · 34 score deltas · 2026-07-04",
    },
    pageCount: 3,
  },
  {
    name: "activityLog",
    source: "src/components/admin/ActivityLogPanel.tsx",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Activity Log",
      title: "Admin Actions — Last 30 Days",
      subtitle: "127 events across 8 admins",
    },
    pageCount: 2,
  },
  {
    name: "walletDataDeletion",
    source: "src/components/wallet/WalletDataDeletion.tsx",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Data Deletion Receipt",
      title: "Wallet #W-4821 — Purge Confirmation",
      subtitle: "Requested 2026-07-04 · Fulfilled 2026-07-04",
    },
    pageCount: 1,
  },
  {
    name: "adminEconomicsAudit",
    source: "src/lib/adminEconomicsAudit.ts",
    unit: "pt",
    format: "letter",
    bandSpec: {
      eyebrow: "Economics Change Log",
      title: "Feature Pricing — Rewrite MICRO",
      subtitle: "cost 50 → 65 · updated by ops-admin",
    },
    pageCount: 1,
  },
];

// ─── Structural verifiers ──────────────────────────────────────────────────

/**
 * jsPDF encodes non-grayscale RGB as `r g b rg` / `RG` with 2-decimal
 * precision; when r == g == b it collapses to a single-channel grayscale
 * `x g` (fill) or `x G` (stroke) with 3-decimal precision.
 */
function pdfColorFragment(
  rgb: readonly [number, number, number],
  kind: "fill" | "stroke",
): string {
  const [r, g, b] = rgb;
  if (r === g && g === b) {
    const v = (r / 255).toFixed(3);
    return `${v} ${kind === "fill" ? "g" : "G"}`;
  }
  const fmt = (n: number) => (Math.round((n / 255) * 100) / 100).toFixed(2);
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} ${kind === "fill" ? "rg" : "RG"}`;
}

function pageContent(doc: jsPDF, pageNum: number): string {
  const pages = (doc.internal as unknown as { pages: string[][] }).pages;
  const stream = pages[pageNum];
  if (!stream) throw new Error(`No content stream for page ${pageNum}`);
  return Array.isArray(stream) ? stream.join("\n") : String(stream);
}

interface Assertion {
  label: string;
  ok: boolean;
  detail?: string;
}

function verify(doc: jsPDF, sample: ExporterSample): Assertion[] {
  const s = getCinemaAureaSettings();
  const bandFill = pdfColorFragment(s.palette.bandBg, "fill");
  const goldStroke = pdfColorFragment(s.palette.gold, "stroke");
  const mutedText = pdfColorFragment(s.palette.muted, "fill");
  // jsPDF PDF streams are always in points regardless of user unit.
  // Letter = 612×792 pt; the band is drawn from (0, pageHeight) with
  // negative height, so the rect operator is: `0. <pageH>. <pageW>. -<bandH>. re\nf`.
  const pageWPt = 612;
  const pageHPt = 792;
  const bandHPt = s.metrics.bandHeightPt;
  const bandRectPattern = new RegExp(
    `0\\. ${pageHPt}\\. ${pageWPt}\\. -${bandHPt}\\. re\\s*\\n\\s*f\\b`,
  );

  const results: Assertion[] = [];

  const total = doc.getNumberOfPages();
  results.push({
    label: "page count matches request",
    ok: total === sample.pageCount,
    detail: `expected=${sample.pageCount} got=${total}`,
  });

  for (let p = 1; p <= total; p++) {
    const stream = pageContent(doc, p);

    results.push({
      label: `p${p}: band background painted`,
      ok: stream.includes(bandFill) && bandRectPattern.test(stream),
      detail: `fill=${bandFill} rect=${bandRectPattern}`,
    });
    results.push({
      label: `p${p}: gold hairline stroked`,
      ok: stream.includes(goldStroke),
      detail: goldStroke,
    });
    results.push({
      label: `p${p}: footer brand string present`,
      ok: /\(Generated by Can I Screenwrite/.test(stream),
    });
    results.push({
      label: `p${p}: footer uses muted text color`,
      ok: stream.includes(mutedText),
      detail: mutedText,
    });
    const rightExpected = sample.footerRight
      ? sample.footerRight(p, total)
      : `Page ${p}`;
    results.push({
      label: `p${p}: footer right text "${rightExpected}"`,
      ok: stream.includes(`(${rightExpected})`),
    });
  }

  return results;
}


// ─── Sample generator ──────────────────────────────────────────────────────

function buildSample(sample: ExporterSample): jsPDF {
  const doc = new jsPDF({ unit: sample.unit, format: sample.format });
  const s = getCinemaAureaSettings();

  for (let p = 1; p <= sample.pageCount; p++) {
    if (p > 1) doc.addPage();
    const { nextY } = renderTitleBand(doc, sample.bandSpec);

    // Some representative body content so the exporter's pages aren't blank.
    const marginU = ptToUnit(doc, s.metrics.marginPt);
    let y = drawSectionHeading(doc, `Section ${p}`, marginU, nextY);
    doc.setFontSize(s.typography.bodySizePt);
    doc.text(
      `This is sample body copy for ${sample.name} page ${p} of ${sample.pageCount}.`,
      marginU,
      y,
    );
    y += ptToUnit(doc, 14);
    drawRule(doc, y);

    const rightText = sample.footerRight
      ? sample.footerRight(p, sample.pageCount)
      : undefined;
    drawFooter(doc, { pageNum: p, rightText });
  }

  return doc;
}

// ─── CLI parsing ───────────────────────────────────────────────────────────

interface CliOptions {
  only: string[];
  skip: string[];
  pageOverrides: Map<string, number>;
  pageOverrideAll: number | null;
  maxPages: number | null;
  list: boolean;
  help: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    only: [],
    skip: [],
    pageOverrides: new Map(),
    pageOverrideAll: null,
    maxPages: null,
    list: false,
    help: false,
  };
  const splitList = (v: string) =>
    v.split(",").map((s) => s.trim()).filter(Boolean);

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const takeValue = (): string => {
      const eq = a.indexOf("=");
      if (eq !== -1) return a.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${a}`);
      return next;
    };
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--list") opts.list = true;
    else if (a.startsWith("--only")) opts.only.push(...splitList(takeValue()));
    else if (a.startsWith("--skip")) opts.skip.push(...splitList(takeValue()));
    else if (a.startsWith("--max-pages")) {
      const n = Number(takeValue());
      if (!Number.isFinite(n) || n < 1) throw new Error(`--max-pages needs a positive integer`);
      opts.maxPages = Math.floor(n);
    } else if (a.startsWith("--pages")) {
      const raw = takeValue();
      const asNum = Number(raw);
      if (Number.isFinite(asNum) && !raw.includes("=") && !raw.includes(",")) {
        if (asNum < 1) throw new Error(`--pages needs a positive integer`);
        opts.pageOverrideAll = Math.floor(asNum);
      } else {
        for (const pair of splitList(raw)) {
          const [name, val] = pair.split("=");
          const n = Number(val);
          if (!name || !Number.isFinite(n) || n < 1) {
            throw new Error(`--pages entry "${pair}" must look like name=<positive int>`);
          }
          opts.pageOverrides.set(name, Math.floor(n));
        }
      }
    } else {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Cinema Aurea PDF smoke test

Usage: bunx tsx scripts/pdfSmoke.ts [flags]

Flags:
  --only <names>       Comma-separated slugs or substrings to include.
  --skip <names>       Comma-separated slugs or substrings to exclude.
  --pages <spec>       Either a single number applied to every selected
                       exporter, or name=<n>[,name=<n>...] pairs.
  --max-pages <n>      Cap each exporter's page count at <n>.
  --list               List available exporter slugs and exit.
  --help, -h           Show this help.

Available exporters:
${SAMPLES.map((s) => `  - ${s.name}  (${s.pageCount}p, ${s.source})`).join("\n")}
`);
}

function matchName(sample: ExporterSample, needles: string[]): boolean {
  return needles.some(
    (n) => sample.name === n || sample.name.toLowerCase().includes(n.toLowerCase()),
  );
}

let cli: CliOptions;
try {
  cli = parseCli(process.argv.slice(2));
} catch (err) {
  console.error((err as Error).message);
  console.error(`Run with --help for usage.`);
  process.exit(2);
}

if (cli.help) {
  printHelp();
  process.exit(0);
}
if (cli.list) {
  for (const s of SAMPLES) console.log(`${s.name}\t${s.pageCount}p\t${s.source}`);
  process.exit(0);
}

const selected: ExporterSample[] = SAMPLES
  .filter((s) => (cli.only.length === 0 ? true : matchName(s, cli.only)))
  .filter((s) => (cli.skip.length === 0 ? true : !matchName(s, cli.skip)))
  .map((s) => {
    let pageCount = s.pageCount;
    if (cli.pageOverrideAll != null) pageCount = cli.pageOverrideAll;
    const perName = cli.pageOverrides.get(s.name);
    if (perName != null) pageCount = perName;
    if (cli.maxPages != null) pageCount = Math.min(pageCount, cli.maxPages);
    return pageCount === s.pageCount ? s : { ...s, pageCount };
  });

if (selected.length === 0) {
  console.error(
    `No exporters matched (--only=${cli.only.join(",") || "∅"} --skip=${cli.skip.join(",") || "∅"}).`,
  );
  console.error(`Run with --list to see available slugs.`);
  process.exit(2);
}

// ─── Run ───────────────────────────────────────────────────────────────────

resetCinemaAureaSettings();

let failed = 0;
const summary: Array<{ name: string; passed: number; failed: number }> = [];

console.log(
  `Running ${selected.length} of ${SAMPLES.length} exporter(s)` +
    (cli.only.length ? ` (--only ${cli.only.join(",")})` : "") +
    (cli.skip.length ? ` (--skip ${cli.skip.join(",")})` : "") +
    (cli.maxPages != null ? ` (--max-pages ${cli.maxPages})` : "") +
    (cli.pageOverrideAll != null ? ` (--pages ${cli.pageOverrideAll})` : ""),
);

for (const sample of selected) {

  console.log(`\n▶ ${sample.name}  (${sample.source})`);
  const doc = buildSample(sample);
  const bytes = doc.output("arraybuffer");
  const outPath = resolve(OUT_DIR, `${sample.name}.pdf`);
  writeFileSync(outPath, Buffer.from(bytes));
  console.log(`  saved: ${outPath}  (${bytes.byteLength} bytes)`);

  const assertions = verify(doc, sample);
  let passed = 0;
  let localFail = 0;
  for (const a of assertions) {
    if (a.ok) {
      passed++;
    } else {
      localFail++;
      failed++;
      console.log(`  ✗ ${a.label}${a.detail ? `  [${a.detail}]` : ""}`);
    }
  }
  console.log(`  ${passed} passed, ${localFail} failed`);
  summary.push({ name: sample.name, passed, failed: localFail });
}

console.log("\n─── Summary ────────────────────────────────────────────────");
for (const row of summary) {
  const flag = row.failed === 0 ? "✓" : "✗";
  console.log(`  ${flag} ${row.name.padEnd(24)}  ${row.passed} passed / ${row.failed} failed`);
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed — Cinema Aurea band/footer regressed.`);
  process.exit(1);
}
console.log(
  `\nAll ${selected.length} selected exporter(s) render the Cinema Aurea band + footer on every page.`,
);

