import type { SavedDraftRef } from './writing-production.mjs';
export interface ProductionAttachment { schemaVersion: 1; projectId: string; sourceHash: string; status: 'ATTACHED_FOR_PLANNING'; draftRef: SavedDraftRef; planRef: SavedDraftRef; projection: { scenes: { id: string; index: number; heading: string; shots: {id: string; label: string; description: string; plannedDurationMs: number | null}[]; paragraphs: {id: string; type: string; text: string}[] }[]; characters: {id:string; name:string; description:string}[]; cells: []; continuityQuestions: []; prologue: {id:string; type:string; text:string}[] } }
export interface ProductionAttachmentPreview { schemaVersion: 1; projectId: string; planRef: SavedDraftRef; draftRef: SavedDraftRef; sourceHash: string; sceneCount: number; shotCount: number; unplannedSceneIds: string[]; previewSha256: string; attachmentRef: SavedDraftRef | null }
export const PRODUCTION_ATTACHMENT_KIND: 'production-attachment';
export function productionAttachmentId(projectId: string): string;
export function validateProductionPlanRef(ref: unknown): SavedDraftRef;
export function validateProductionAttachmentRequest(operation: 'prepare' | 'attach', input: unknown): unknown;
export function validateProductionAttachment(data: unknown, project?: unknown): ProductionAttachment;
export function buildProductionAttachment(base: unknown, draft: unknown, plan: unknown, hash: (text: string) => string): ProductionAttachment;
export function attachedProductionProject(base: unknown, attachment: unknown): unknown;
