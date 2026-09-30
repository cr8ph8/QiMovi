export const HIGGSFIELD_RESOURCES = ['models', 'workflows', 'voices', 'animation-actions'] as const;
export type HiggsfieldDesktopResource = typeof HIGGSFIELD_RESOURCES[number];
export const HIGGSFIELD_DESKTOP_STATES = ['NOT_INSTALLED', 'LOCAL_CLI_FOUND', 'LOCAL_CLI_DETECTED', 'VERSION_UNRECOGNIZED', 'LOCAL_CLI_UNAVAILABLE', 'BUNDLED_RUNTIME_INVALID', 'DISCOVERY_AVAILABLE', 'DISCOVERY_FORMAT_UNRECOGNIZED', 'DISCOVERY_UNAVAILABLE'] as const;
export type HiggsfieldDesktopStatus = typeof HIGGSFIELD_DESKTOP_STATES[number];
export const HIGGSFIELD_AUTH_STATES = ['NOT_CHECKED', 'SIGN_IN_REQUIRED', 'NEEDS_WORKSPACE', 'CONNECTED', 'UNAVAILABLE', 'SIGNING_IN', 'SIGN_IN_CANCELLED', 'SIGN_IN_FAILED', 'SIGN_IN_TIMED_OUT'] as const;
export type HiggsfieldAuthStatus = typeof HIGGSFIELD_AUTH_STATES[number];
export interface HiggsfieldDiscoveryItem { id: string; name: string; description?: string; outputType?: string }
export interface HiggsfieldDesktopObservation {
  schema: 'caniscreenwrite-higgsfield-desktop/v1'; status: HiggsfieldDesktopStatus; checkedAt: string | null; cliVersion: string | null;
  executionEnabled: false; accountVerified: boolean; resources: HiggsfieldDesktopResource[];
  runtimeQualified?: boolean; selectedWorkspaceId?: string | null;
  authentication?: { status: HiggsfieldAuthStatus; checkedAt: string | null };
  workspaces?: { id: string; name: string }[];
  resource?: HiggsfieldDesktopResource; items?: HiggsfieldDiscoveryItem[]; observationSha256?: string;
  completeness?: 'RESPONSE_PAGE_ONLY'; transport?: 'HIGGSFIELD_CLI';
}
export interface HiggsfieldDesktopApi {
  status(signal?: AbortSignal): Promise<HiggsfieldDesktopObservation>;
  check(): Promise<HiggsfieldDesktopObservation>;
  discover(resource: HiggsfieldDesktopResource): Promise<HiggsfieldDesktopObservation>;
  checkAccount(): Promise<HiggsfieldDesktopObservation>;
  signIn(): Promise<HiggsfieldDesktopObservation>;
  cancelSignIn(): Promise<HiggsfieldDesktopObservation>;
  workspaces(): Promise<HiggsfieldDesktopObservation>;
  selectWorkspace(workspaceId: string): Promise<HiggsfieldDesktopObservation>;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 4000 && ![...value].some(character => character.charCodeAt(0) < 32);
const date = (value: unknown): boolean => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
function assert(value: unknown): asserts value { if (!value) throw new Error('The local Higgsfield connection did not return a matching observation.'); }
function validate(value: unknown, resource?: HiggsfieldDesktopResource): asserts value is HiggsfieldDesktopObservation {
  assert(object(value) && value.schema === 'caniscreenwrite-higgsfield-desktop/v1' && value.executionEnabled === false && typeof value.accountVerified === 'boolean');
  assert(HIGGSFIELD_DESKTOP_STATES.includes(value.status as HiggsfieldDesktopStatus) && date(value.checkedAt));
  if (value.runtimeQualified !== undefined) assert(typeof value.runtimeQualified === 'boolean');
  if (value.selectedWorkspaceId !== undefined) assert(value.selectedWorkspaceId === null || identifier(value.selectedWorkspaceId));
  assert(value.cliVersion === null || typeof value.cliVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.cliVersion));
  assert(Array.isArray(value.resources) && value.resources.every(item => HIGGSFIELD_RESOURCES.includes(item)) && new Set(value.resources).size === value.resources.length);
  if (value.authentication !== undefined) assert(object(value.authentication) && HIGGSFIELD_AUTH_STATES.includes(value.authentication.status as HiggsfieldAuthStatus) && date(value.authentication.checkedAt));
  if (value.accountVerified) assert(object(value.authentication) && value.authentication.status === 'CONNECTED');
  if (value.workspaces !== undefined) {
    assert(Array.isArray(value.workspaces) && value.workspaces.length <= 500 && value.workspaces.every(item => object(item) && identifier(item.id) && text(item.name) && Boolean(item.name)));
    assert(new Set(value.workspaces.map(item => item.id)).size === value.workspaces.length);
  }
  if (resource !== undefined) assert(value.resource === resource);
  if (value.resource !== undefined) assert(HIGGSFIELD_RESOURCES.includes(value.resource as HiggsfieldDesktopResource));
  if (value.observationSha256 !== undefined) assert(typeof value.observationSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.observationSha256));
  if (value.completeness !== undefined) assert(value.completeness === 'RESPONSE_PAGE_ONLY');
  if (value.transport !== undefined) assert(value.transport === 'HIGGSFIELD_CLI');
  if (value.items !== undefined) {
    assert(Array.isArray(value.items) && value.items.length <= 2000);
    const items = value.items;
    assert(items.every(item => object(item) && text(item.id) && Boolean(item.id) && text(item.name) && Boolean(item.name) && (item.description === undefined || text(item.description)) && (item.outputType === undefined || text(item.outputType))));
    assert(new Set(items.map(item => item.id)).size === items.length);
  }
  if (value.status === 'DISCOVERY_AVAILABLE') assert(value.resource !== undefined && Array.isArray(value.items));
}
async function call(route: string, body?: object, signal?: AbortSignal): Promise<HiggsfieldDesktopObservation> {
  const response = await fetch(`/api/higgsfield/desktop${route}`, { credentials: 'same-origin', redirect: 'error', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(object(value) && value.error === 'HIGGSFIELD_DESKTOP_BUSY' ? 'A connection check is already in progress. Your received results are retained.' : 'The local connection request was not confirmed. Your received results are retained.');
  validate(value, route === '/discover' ? (body as { resource: HiggsfieldDesktopResource }).resource : undefined);
  return value;
}
export const higgsfieldDesktopApi: HiggsfieldDesktopApi = {
  status: signal => call('', undefined, signal), check: () => call('/check', {}), discover: resource => call('/discover', { resource }),
  checkAccount: () => call('/account/check', {}), signIn: () => call('/sign-in', {}), cancelSignIn: () => call('/sign-in/cancel', {}),
  workspaces: () => call('/workspaces', {}), selectWorkspace: workspaceId => { assert(identifier(workspaceId)); return call('/workspace/select', { workspaceId }); },
};
