/** Authored production planning attached to an exact retained source passage. */
export const PRODUCTION_ELEMENT_CATEGORIES = Object.freeze([
  'CAST', 'EXTRAS', 'PROPS', 'WARDROBE', 'MAKEUP', 'SET_DRESSING', 'LOCATIONS', 'VEHICLES',
  'ANIMALS', 'STUNTS', 'SPECIAL_EFFECTS', 'VFX', 'SOUND', 'MUSIC', 'EQUIPMENT', 'OTHER',
]);
export const MAX_PRODUCTION_ELEMENTS = 100;
const reject = message => { throw Object.assign(new Error(message), { code: 'INVALID_PRODUCTION_ELEMENTS', status: 422 }); };
const need = (value, message) => { if (!value) reject(message); };
const fields = ['id', 'category', 'name', 'quantity', 'notes'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\uD800-\uDFFF]/u.test(value);

/** Validate only this optional field, without normalizing or mutating authored text. */
export function validateProductionElements(value) {
  need(Array.isArray(value) && value.length <= MAX_PRODUCTION_ELEMENTS, 'Use at most 100 production elements per passage.');
  const ids = new Set();
  for (const element of value) {
    need(object(element) && Reflect.ownKeys(element).length === fields.length && fields.every(key => Object.hasOwn(element, key)), 'Production elements require only id, category, name, quantity and notes.');
    need(text(element.id, 120) && element.id.trim().length > 0 && element.id === element.id.trim() && !/[\x00-\x1f\x7f]/.test(element.id), 'A production element needs a nonblank id of at most 120 characters without surrounding whitespace.');
    need(!ids.has(element.id), 'Production element ids must be unique within the passage.'); ids.add(element.id);
    need(PRODUCTION_ELEMENT_CATEGORIES.includes(element.category), 'Choose a supported production element category.');
    need(text(element.name, 240) && element.name.trim().length > 0, 'A production element needs a name of at most 240 characters.');
    need(element.quantity === null || Number.isInteger(element.quantity) && element.quantity >= 1 && element.quantity <= 10000, 'Production quantity must be unknown or a whole number from 1 to 10000.');
    need(text(element.notes, 2000), 'Production element notes must contain at most 2000 characters.');
  }
  return value;
}

/** Length-prefixing keeps paragraph/element pairs distinct, including ids containing colons. */
export const productionElementBudgetTarget = (paragraphId, elementId) => `breakdown:${paragraphId.length}:${paragraphId}:${elementId}`;
