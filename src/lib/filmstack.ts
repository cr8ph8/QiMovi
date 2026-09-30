// ─── FilmStack Intelligence: Document Registry, Dependency Graph & Scoring ───

export type DocStatus = "missing" | "draft" | "in_review" | "approved";

export type FilmStackCategory = "writing" | "development" | "legal" | "production" | "distribution";

export interface FilmStackDocDef {
  id: string;
  title: string;
  category: FilmStackCategory;
  dependencies: string[];
  autoSeedable: boolean;
}

export interface FilmStackDocument {
  id: string;
  title: string;
  category: FilmStackCategory;
  status: DocStatus;
  content: string;
  generated_at: string | null;
  updated_by?: string;
}

// ─── 20-Document Taxonomy ────────────────────────────────────────────────────

export const FILMSTACK_DOCS: FilmStackDocDef[] = [
  // Writing
  { id: "logline_doc", title: "Logline", category: "writing", dependencies: [], autoSeedable: true },
  { id: "synopsis", title: "Synopsis", category: "writing", dependencies: ["logline_doc"], autoSeedable: true },
  { id: "treatment", title: "Treatment", category: "writing", dependencies: ["synopsis"], autoSeedable: false },
  { id: "character_bible", title: "Character Bible", category: "writing", dependencies: ["logline_doc"], autoSeedable: true },
  { id: "world_bible", title: "World Bible", category: "writing", dependencies: ["logline_doc"], autoSeedable: true },
  { id: "beat_sheet", title: "Beat Sheet", category: "writing", dependencies: ["treatment"], autoSeedable: true },
  // Development
  { id: "pitch_deck", title: "Pitch Deck", category: "development", dependencies: ["logline_doc", "synopsis"], autoSeedable: false },
  { id: "film_prd", title: "Film PRD", category: "development", dependencies: ["logline_doc"], autoSeedable: true },
  { id: "budget_top_sheet", title: "Budget Top Sheet", category: "development", dependencies: ["treatment"], autoSeedable: false },
  { id: "production_schedule", title: "Production Schedule", category: "development", dependencies: ["beat_sheet", "budget_top_sheet"], autoSeedable: false },
  // Legal
  { id: "chain_of_title", title: "Chain of Title", category: "legal", dependencies: [], autoSeedable: false },
  { id: "copyright_registration", title: "Copyright Registration", category: "legal", dependencies: [], autoSeedable: false },
  { id: "writer_agreement", title: "Writer Agreement", category: "legal", dependencies: [], autoSeedable: false },
  { id: "option_agreement", title: "Option Agreement", category: "legal", dependencies: ["chain_of_title"], autoSeedable: false },
  { id: "release_forms", title: "Release Forms", category: "legal", dependencies: [], autoSeedable: false },
  // Production
  { id: "call_sheets", title: "Call Sheets", category: "production", dependencies: ["production_schedule"], autoSeedable: false },
  { id: "deliverables", title: "Deliverables List", category: "production", dependencies: ["budget_top_sheet"], autoSeedable: false },
  // Distribution
  { id: "distribution_package", title: "Distribution Package", category: "distribution", dependencies: ["deliverables", "chain_of_title"], autoSeedable: false },
  { id: "festival_package", title: "Festival Package", category: "distribution", dependencies: ["logline_doc", "synopsis", "chain_of_title"], autoSeedable: false },
];

export const FILMSTACK_CATEGORIES: { key: FilmStackCategory; label: string; icon: string }[] = [
  { key: "writing", label: "Writing", icon: "pen-tool" },
  { key: "development", label: "Development", icon: "briefcase" },
  { key: "legal", label: "Legal", icon: "shield" },
  { key: "production", label: "Production", icon: "clapperboard" },
  { key: "distribution", label: "Distribution", icon: "send" },
];

const FILMSTACK_MAP = new Map(FILMSTACK_DOCS.map((d) => [d.id, d]));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_WEIGHT: Record<DocStatus, number> = {
  missing: 0,
  draft: 0.33,
  in_review: 0.66,
  approved: 1,
};

export function getDocDef(id: string): FilmStackDocDef | undefined {
  return FILMSTACK_MAP.get(id);
}

export function isDocBlocked(docId: string, docs: Record<string, FilmStackDocument>): boolean {
  const def = FILMSTACK_MAP.get(docId);
  if (!def) return false;
  return def.dependencies.some((depId) => {
    const dep = docs[depId];
    return !dep || dep.status === "missing";
  });
}

export function getUnblockedDocs(docs: Record<string, FilmStackDocument>): string[] {
  return FILMSTACK_DOCS
    .filter((d) => {
      const doc = docs[d.id];
      if (doc && doc.status !== "missing") return false; // already started
      return !isDocBlocked(d.id, docs);
    })
    .map((d) => d.id);
}

/** Initialize all 20 docs as missing, merging any existing data */
export function initializeFilmStack(existing?: Record<string, any>): Record<string, FilmStackDocument> {
  const result: Record<string, FilmStackDocument> = {};
  for (const def of FILMSTACK_DOCS) {
    const ex = existing?.[def.id];
    if (ex && ex.content) {
      result[def.id] = {
        id: def.id,
        title: ex.title || def.title,
        category: def.category,
        status: ex.status || "draft",
        content: ex.content,
        generated_at: ex.generated_at || null,
        updated_by: ex.updated_by,
      };
    } else {
      result[def.id] = {
        id: def.id,
        title: def.title,
        category: def.category,
        status: "missing",
        content: "",
        generated_at: null,
      };
    }
  }
  return result;
}

// ─── Readiness Scoring ───────────────────────────────────────────────────────

const STORY_DOC_IDS = ["logline_doc", "synopsis", "treatment", "character_bible", "world_bible", "beat_sheet"];
const PRODUCTION_DOC_IDS = ["budget_top_sheet", "production_schedule", "call_sheets", "deliverables"];
const LEGAL_DOC_IDS = ["chain_of_title", "copyright_registration", "writer_agreement", "option_agreement", "release_forms"];

export interface ReadinessScores {
  completeness: number;
  competition: number;
  production: number;
  legal: number;
}

export function computeReadinessScores(docs: Record<string, FilmStackDocument>): ReadinessScores {
  const allDocs = Object.values(docs);
  const total = allDocs.length || 1;

  // Document Completeness: % not missing
  const completeness = Math.round((allDocs.filter((d) => d.status !== "missing").length / total) * 100);

  // Competition Readiness: weighted avg of story docs
  const competition = computeGroupScore(docs, STORY_DOC_IDS);

  // Production Readiness
  const production = computeGroupScore(docs, PRODUCTION_DOC_IDS);

  // Legal Readiness: % of legal docs approved
  const legalDocs = LEGAL_DOC_IDS.map((id) => docs[id]).filter(Boolean);
  const legalTotal = legalDocs.length || 1;
  const legal = Math.round((legalDocs.filter((d) => d.status === "approved").length / legalTotal) * 100);

  return { completeness, competition, production, legal };
}

function computeGroupScore(docs: Record<string, FilmStackDocument>, ids: string[]): number {
  const groupDocs = ids.map((id) => docs[id]).filter(Boolean);
  if (groupDocs.length === 0) return 0;
  const sum = groupDocs.reduce((acc, d) => acc + STATUS_WEIGHT[d.status], 0);
  return Math.round((sum / groupDocs.length) * 100);
}

// ─── Dependency Completion Alerts ────────────────────────────────────────────

export interface CompletionAlert {
  completedDoc: string;
  unblockedDocs: string[];
}

export function checkNewCompletions(
  oldDocs: Record<string, FilmStackDocument>,
  newDocs: Record<string, FilmStackDocument>,
): CompletionAlert[] {
  const alerts: CompletionAlert[] = [];

  for (const def of FILMSTACK_DOCS) {
    const oldStatus = oldDocs[def.id]?.status;
    const newStatus = newDocs[def.id]?.status;

    // Doc just became non-missing (or upgraded to approved)
    if (oldStatus !== newStatus && newStatus && newStatus !== "missing") {
      // Find downstream docs that were blocked before but are now unblocked
      const downstream = FILMSTACK_DOCS.filter((d) => d.dependencies.includes(def.id));
      const newlyUnblocked = downstream.filter(
        (d) => isDocBlocked(d.id, oldDocs) && !isDocBlocked(d.id, newDocs),
      );
      if (newlyUnblocked.length > 0) {
        alerts.push({
          completedDoc: def.title,
          unblockedDocs: newlyUnblocked.map((d) => d.title),
        });
      }
    }
  }

  return alerts;
}
