export type PreservationSourceId = 'DIY' | 'CHECK' | 'RES' | 'FUTURE';
export interface PreservationSourceReference { readonly sourceId: PreservationSourceId; readonly locator: string }
export interface PreservationGuidance { readonly summary: string; readonly evidencePrompts: readonly string[]; readonly sources: readonly PreservationSourceReference[] }
export const FILM_PRESERVATION_CONTEXT: string;
export const FILM_PRESERVATION_SOURCES: Readonly<Record<PreservationSourceId, { readonly title: string; readonly filename: string; readonly pages: number }>>;
export const PRESERVATION_REQUIREMENT_IDS: readonly string[];
export const PRESERVATION_GUIDANCE: Readonly<Record<string, PreservationGuidance>>;
export function preservationGuidanceFor(requirementId: string): PreservationGuidance | null;
export function preservationSourceLabel(reference: PreservationSourceReference): string;
export function preservationGuidanceLines(requirementId: string): string[];
