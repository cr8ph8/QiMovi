export const STORY_ROOM_PREVIEW_PATH = "/story/preview";

export type StoryRoomWorkspaceKind = "draft" | "entry";

export interface StoryRoomWorkspaceContext {
  projectId: string;
  subjectId: string;
  kind: StoryRoomWorkspaceKind;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

/**
 * Builds the Stage B navigation handoff. These identifiers provide route
 * context only; they never bind, admit, or mutate story-room source material.
 */
export function buildStoryRoomPreviewHref(
  context: StoryRoomWorkspaceContext | null,
): string {
  if (
    !context ||
    !isUuid(context.projectId) ||
    !isUuid(context.subjectId) ||
    (context.kind !== "draft" && context.kind !== "entry")
  ) {
    return STORY_ROOM_PREVIEW_PATH;
  }

  const query = new URLSearchParams({
    project_id: context.projectId,
    subject_id: context.subjectId,
    kind: context.kind,
    from: "stage_b",
  });
  return `${STORY_ROOM_PREVIEW_PATH}?${query.toString()}`;
}

/**
 * Parses a complete, bounded Stage B handoff. Partial or malformed query
 * strings fail closed to null so URL text cannot become project authority.
 */
export function parseStoryRoomWorkspaceContext(
  query: URLSearchParams,
): StoryRoomWorkspaceContext | null {
  if (query.get("from") !== "stage_b") return null;

  const projectId = query.get("project_id");
  const subjectId = query.get("subject_id");
  const kind = query.get("kind");
  if (
    !isUuid(projectId) ||
    !isUuid(subjectId) ||
    (kind !== "draft" && kind !== "entry")
  ) {
    return null;
  }

  return { projectId, subjectId, kind };
}

export function compactStoryRoomWorkspaceId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
