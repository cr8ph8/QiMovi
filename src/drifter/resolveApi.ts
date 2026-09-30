export interface ResolveStatus {
  schema: 'qimovi-resolve-status/v1';
  state: 'NOT_CHECKED' | 'NOT_INSTALLED' | 'RUNTIME_UNAVAILABLE' | 'CONNECTED' | 'BLOCKED' | 'ERROR';
  transport: 'BUNDLED_STDIO';
  installed: { found: boolean; appPath: string | null; version: string | null; productName: string | null; sdkAvailable: boolean; pythonAvailable: boolean };
  mcpReady: boolean; resolveAvailable: boolean; checkedAt: string | null; reason: string | null;
  tools: { name: string; title: string; readOnly: true }[]; readOnly: true;
}
export interface ResolveProject {
  id: string; name: string; timelineCount: number;
  currentTimeline: { id: string; name: string } | null;
  timelines: { id: string; name: string; index: number }[]; timelinesTruncated: boolean;
}
export interface ResolveTimeline {
  id: string; name: string; startFrame: number; endFrame: number; startTimecode: string;
  frameRate: string; width: string; height: string;
  tracks: { type: string; index: number; name: string; itemCount: number; items: { name: string; startFrame: number; endFrame: number; durationFrames: number }[]; itemsTruncated: boolean }[];
  tracksTruncated: boolean;
}
export interface ResolveInspection {
  schema: 'qimovi-resolve-inspection/v1'; scope: 'project' | 'timeline'; observedAt: string; readOnly: true;
  result: { project: ResolveProject | { id: string; name: string }; timeline?: ResolveTimeline };
}
export interface ResolveApi {
  status(): Promise<ResolveStatus>; discover(): Promise<ResolveStatus>;
  inspect(input: { scope: 'project' } | { scope: 'timeline'; expectedProjectId: string; expectedTimelineId: string }): Promise<ResolveInspection>;
}
const failureMessages: Record<string, string> = {
  RESOLVE_NOT_CONNECTED: 'Check the Resolve connection before inspecting a project.',
  RESOLVE_MCP_BUSY: 'Another Resolve check is still running. Try again when it finishes.',
  RESOLVE_PROJECT_CHANGED: 'The open Resolve project changed. Read the project again.',
  RESOLVE_TIMELINE_CHANGED: 'The current Resolve timeline changed. Read the project again.',
  RESOLVE_NO_CURRENT_PROJECT: 'Open a project in Resolve, then read the project again.',
  RESOLVE_NO_CURRENT_TIMELINE: 'Open a timeline in Resolve, then read the project again.',
  RESOLVE_MCP_TIMEOUT: 'Resolve did not respond in time. Check the connection again.',
};
async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/resolve/${path}`, { credentials: 'same-origin', redirect: 'error', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw new Error('Restore your QiMovi session, then check Resolve again.');
    throw new Error(failureMessages[data?.error] ?? 'Resolve did not return a confirmed response. Check the connection and try again.');
  }
  return data as T;
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 16384;
const optionalText = (value: unknown) => value === null || text(value);
const flag = (value: unknown) => typeof value === 'boolean';
const timestamp = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const identity = (value: { id?: unknown; name?: unknown } | null | undefined) => value && text(value.id) && value.id.length > 0 && text(value.name);
function status(value: ResolveStatus): ResolveStatus {
  if (value?.schema !== 'qimovi-resolve-status/v1' || value.readOnly !== true || value.transport !== 'BUNDLED_STDIO'
    || !['NOT_CHECKED', 'NOT_INSTALLED', 'RUNTIME_UNAVAILABLE', 'CONNECTED', 'BLOCKED', 'ERROR'].includes(value.state)
    || !value.installed || ![value.installed.found, value.installed.sdkAvailable, value.installed.pythonAvailable, value.mcpReady, value.resolveAvailable].every(flag)
    || ![value.installed.appPath, value.installed.version, value.installed.productName, value.reason].every(optionalText)
    || value.checkedAt !== null && !timestamp(value.checkedAt) || !Array.isArray(value.tools) || value.tools.length > 20
    || value.tools.some(tool => tool?.readOnly !== true || !text(tool.name) || !text(tool.title))
    || value.state === 'CONNECTED' && (!value.mcpReady || !value.resolveAvailable)) throw new Error('The local Resolve connection returned an invalid status.');
  return value;
}
export const resolveApi: ResolveApi = {
  status: async () => status(await request<ResolveStatus>('status')),
  discover: async () => status(await request<ResolveStatus>('discover', {})),
  inspect: async input => {
    const value = await request<ResolveInspection>('inspect', input);
    if (value?.schema !== 'qimovi-resolve-inspection/v1' || value.readOnly !== true || value.scope !== input.scope || !timestamp(value.observedAt) || !identity(value.result?.project)) throw new Error('The Resolve inspection was not confirmed.');
    if (input.scope === 'project') {
      const project = value.result.project as ResolveProject;
      if (!count(project.timelineCount) || !flag(project.timelinesTruncated) || project.currentTimeline !== null && !identity(project.currentTimeline)
        || !Array.isArray(project.timelines) || project.timelines.length > 500 || project.timelines.some(row => !identity(row) || !count(row.index))) throw new Error('Resolve returned an invalid timeline list.');
    } else {
      const timeline = value.result.timeline;
      if (value.result.project.id !== input.expectedProjectId || timeline?.id !== input.expectedTimelineId) throw new Error('The active Resolve project or timeline changed. Read the project again.');
      if (!identity(timeline) || ![timeline.startFrame, timeline.endFrame].every(Number.isFinite) || ![timeline.startTimecode, timeline.frameRate, timeline.width, timeline.height].every(text)
        || !flag(timeline.tracksTruncated) || !Array.isArray(timeline.tracks) || timeline.tracks.length > 1000
        || timeline.tracks.some(track => !track || !text(track.name) || !text(track.type) || !count(track.index) || !count(track.itemCount) || !flag(track.itemsTruncated)
          || !Array.isArray(track.items) || track.items.length > 10000 || track.items.some(item => !item || !text(item.name) || ![item.startFrame, item.endFrame, item.durationFrames].every(Number.isFinite)))) throw new Error('Resolve returned invalid timeline details.');
    }
    return value;
  },
};
