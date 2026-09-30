import type { WorkbenchMode } from './workbenchModel';

type StudioToolGroup = { name: string; modes: WorkbenchMode[] } & ({ action: 'mode'; start: WorkbenchMode } | { action: 'generation' });

export const TOOL_GROUPS: StudioToolGroup[] = [
  { name: 'Universe', action: 'mode', start: 'library', modes: ['library', 'lore', 'knowledge'] },
  { name: 'Story', action: 'mode', start: 'write', modes: ['write', 'braindump', 'plan', 'drafts', 'templates', 'insights', 'creative', 'continuity'] },
  { name: 'Movie', action: 'mode', start: 'nodes', modes: ['nodes', 'scenes'] },
  { name: 'Deliver', action: 'mode', start: 'submit', modes: ['collaborate', 'pitch', 'bundle', 'submit'] },
];

export function workspaceForMode(mode: WorkbenchMode) { return TOOL_GROUPS.find(group => group.modes.includes(mode)); }
