/**
 * Knowledge layer — canonical types, constants, and utilities for the
 * research memory / knowledge graph system.
 */

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

export const DOC_TYPES = [
  { value: "paper", label: "Paper" },
  { value: "note", label: "Note" },
  { value: "citation", label: "Citation" },
  { value: "url", label: "URL / Link" },
  { value: "method", label: "Method" },
  { value: "risk", label: "Risk" },
  { value: "metric", label: "Metric" },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["value"];

export const DOC_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "ingested", label: "Ingested" },
  { value: "reviewed", label: "Reviewed" },
  { value: "archived", label: "Archived" },
] as const;

export type DocStatus = (typeof DOC_STATUSES)[number]["value"];

// ---------------------------------------------------------------------------
// Concept types
// ---------------------------------------------------------------------------

export const CONCEPT_TYPES = [
  { value: "idea", label: "Idea" },
  { value: "method", label: "Method" },
  { value: "risk", label: "Risk" },
  { value: "metric", label: "Metric" },
  { value: "reference", label: "Reference" },
  { value: "pattern", label: "Pattern" },
] as const;

export type ConceptType = (typeof CONCEPT_TYPES)[number]["value"];

// ---------------------------------------------------------------------------
// Target systems (for knowledge_links)
// ---------------------------------------------------------------------------

export const TARGET_SYSTEMS = [
  { value: "judging", label: "Judging" },
  { value: "governance", label: "Governance" },
  { value: "screenplay_analysis", label: "Screenplay Analysis" },
  { value: "character_voice", label: "Character & Voice" },
  { value: "stability", label: "Stability Metrics" },
  { value: "provenance", label: "Provenance" },
  { value: "general", label: "General" },
] as const;

export type TargetSystem = (typeof TARGET_SYSTEMS)[number]["value"];

export const LINK_TYPES = [
  { value: "relates_to", label: "Relates to" },
  { value: "informs", label: "Informs" },
  { value: "validates", label: "Validates" },
  { value: "challenges", label: "Challenges" },
  { value: "extends", label: "Extends" },
] as const;

// ---------------------------------------------------------------------------
// Interfaces (matching DB schema)
// ---------------------------------------------------------------------------

export interface KnowledgeDocument {
  id: string;
  title: string;
  doc_type: string;
  source: string;
  source_url: string | null;
  summary: string;
  content: string;
  status: string;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeConcept {
  id: string;
  document_id: string | null;
  title: string;
  concept_type: string;
  description: string;
  confidence: number;
  created_at: string;
}

export interface KnowledgeLink {
  id: string;
  concept_id: string | null;
  document_id: string | null;
  target_system: string;
  target_id: string | null;
  link_type: string;
  notes: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function docTypeLabel(type: string): string {
  return DOC_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function conceptTypeLabel(type: string): string {
  return CONCEPT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export function targetSystemLabel(system: string): string {
  return TARGET_SYSTEMS.find((s) => s.value === system)?.label ?? system;
}

export function statusLabel(status: string): string {
  return DOC_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function statusColor(status: string): string {
  switch (status) {
    case "reviewed": return "text-emerald-500";
    case "ingested": return "text-primary";
    case "draft": return "text-muted-foreground";
    case "archived": return "text-muted-foreground/60";
    default: return "text-foreground";
  }
}
