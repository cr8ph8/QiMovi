/**
 * Temporary containment boundary for the legacy browser-side submit helper.
 * Re-enable only after the service-owned atomic entry + charge + receipt
 * operation replaces every direct `entries.status` mutation.
 */

import { SUBMISSION_SECURITY_MESSAGE } from "@/lib/securityMaintenance";

export interface SubmitReceipt {
  entryId: string;
  submittedAt: string;
  reason: string;
  receiptHash: string;
  projectId: string | null;
  lifecycleMirrored: boolean;
}

export interface GovernedSubmitInput {
  entryId: string;
  /** Free-form reason recorded in the lifecycle event + audit log. */
  reason: string;
  /**
   * Optional evidence payload folded into the receipt hash (e.g. the
   * qualifying score pair, submission portal step summary).
   */
  evidence?: Record<string, unknown>;
}

export async function governedMarkEntrySubmitted(
  input: GovernedSubmitInput,
): Promise<SubmitReceipt> {
  void input;
  throw new Error(SUBMISSION_SECURITY_MESSAGE);
}
