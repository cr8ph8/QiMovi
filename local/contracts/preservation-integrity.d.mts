export type PreservationItemStatus = 'MATCH' | 'MISMATCH' | 'MISSING' | 'UNREADABLE' | 'CHANGED_DURING_CHECK';
export type PreservationJobStatus = 'RUNNING' | 'INTERRUPTED' | 'CANCELLED' | 'COMPLETED';
export interface PreservationInventoryItem { sha256: string; byteLength: number; mimeType: string; filenameHints: string[]; referenceCount: number }
export interface PreservationCheckResult { sha256: string; expectedByteLength: number; status: PreservationItemStatus; startedAt: string; checkedAt: string; observedSha256: string | null; observedByteLength: number | null; reason: string | null }
export interface PreservationSummary { total: number; checked: number; match: number; mismatch: number; missing: number; unreadable: number; changedDuringCheck: number }
export interface PreservationJobSummary { jobId: string; projectId: string; requestId: string; status: PreservationJobStatus; createdAt: string; updatedAt: string; completedAt: string | null; summary: PreservationSummary; evidencePath: string }
export interface PreservationCheckManifest extends PreservationJobSummary { schemaVersion: 'qimovi-preservation-check/v1'; items: PreservationInventoryItem[]; results: PreservationCheckResult[]; scope: string; sha256: string }
export interface PreservationLimits { inventoryItems: number; jobItems: number; fileBytes: number; jobBytes: number; jobs: number; receiptBytes: number; filenameHints: number }
export interface PreservationCatalog { schemaVersion: 'qimovi-preservation-catalog/v1'; projectId: string; scope: string; limits: PreservationLimits; items: PreservationInventoryItem[]; jobs: PreservationJobSummary[] }
export interface PreservationStartInput { projectId: string; requestId: string; hashes: string[] }
export interface PreservationJobInput { projectId: string; jobId: string }
export const PRESERVATION_SCOPE: string;
export const PRESERVATION_LIMITS: Readonly<PreservationLimits>;
export const PRESERVATION_ITEM_STATUSES: readonly PreservationItemStatus[];
export const PRESERVATION_JOB_STATUSES: readonly PreservationJobStatus[];
export function validatePreservationRequest(action: 'start', input: unknown): PreservationStartInput;
export function validatePreservationRequest(action: 'get' | 'resume' | 'cancel', input: unknown): PreservationJobInput;
export function validatePreservationInventoryItem(input: unknown): PreservationInventoryItem;
export function preservationSummary(items: PreservationInventoryItem[], results: PreservationCheckResult[]): PreservationSummary;
export function validatePreservationManifest(input: unknown): PreservationCheckManifest;
