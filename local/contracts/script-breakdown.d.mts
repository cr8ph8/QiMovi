export type ProductionElementCategory = 'CAST' | 'EXTRAS' | 'PROPS' | 'WARDROBE' | 'MAKEUP' | 'SET_DRESSING' | 'LOCATIONS' | 'VEHICLES' | 'ANIMALS' | 'STUNTS' | 'SPECIAL_EFFECTS' | 'VFX' | 'SOUND' | 'MUSIC' | 'EQUIPMENT' | 'OTHER';
export interface ProductionElement { id: string; category: ProductionElementCategory; name: string; quantity: number | null; notes: string }
export const PRODUCTION_ELEMENT_CATEGORIES: readonly ProductionElementCategory[];
export const MAX_PRODUCTION_ELEMENTS: 100;
/** Validates the array field without changing the input or any legacy coverage data. */
export function validateProductionElements(value: unknown): ProductionElement[];
export function productionElementBudgetTarget(paragraphId: string, elementId: string): string;
