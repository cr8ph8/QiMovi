import type { CellRole } from './types';

/** Presentation terms shared by the storyboard and production views.
 * Stored cell IDs and role enums are retained for project compatibility. */
export const STORYBOARD_FRAME_ROLE: Record<CellRole, string> = {
  START: 'Scene opening',
  MOMENT: 'Action moment',
  END: 'Ending',
};
