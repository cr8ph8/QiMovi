import { lazy, Suspense } from "react";
import { Send } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidenceCard } from "@/components/evidence/EvidenceCard";
import { WhatYouSeePreview } from "@/components/evidence/WhatYouSeePreview";
import { PrivateVsPublicDiff } from "@/components/evidence/PrivateVsPublicDiff";
import { WaiverQualificationPanel } from "@/components/submission/WaiverQualificationPanel";

const SubmissionPortal = lazy(() => import("@/pages/SubmissionPortal"));

interface Props {
  sourceEntryId?: string | null;
}

/**
 * Submit mode panel. Wraps the SubmissionPortal stepper. Unified-project
 * mirroring already runs inside the portal behind `project_lifecycle_v2`.
 * The evidence banner uses the shared EvidenceCard so submission proofs
 * present the same way as Insights, Shield, and Rollback.
 */
export default function SubmitPanel({ sourceEntryId }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      {sourceEntryId && (
        <div className="px-4 pt-3 pb-1">
          <EvidenceCard
            title="Submission evidence"
            icon={Send}
            tone="gold"
            subtitle="A signed receipt is generated at each step"
            facts={[
              { label: "Source draft", value: sourceEntryId, hash: true },
              { label: "Receipt hash", value: "computed on Details step", mono: true },
            ]}
            details={{
              triggerLabel: "Trail",
              drawerTitle: "Submission evidence trail",
              drawerDescription:
                "Receipts emitted by the submission portal, plus disclosure status and linked references.",
              disclosure: {
                label: "AI disclosure captured on Details step",
                tone: "default",
                note: "Writers confirm AI assistance level before advancing past the Details step. The captured disclosure is embedded in every receipt hash.",
              },
              receipts: [
                {
                  id: `source-${sourceEntryId}`,
                  title: "Source draft attached",
                  badges: [{ label: "source", tone: "primary" as const }],
                  correlationId: sourceEntryId,
                },
                {
                  id: "receipt-placeholder",
                  title: "Receipt will land here after Details step",
                  notes: "Historical receipts appear in the MyDrafts receipts timeline once emitted.",
                },
              ],
              links: [
                {
                  label: "submission-gates spec",
                  url: "/.lovable/memory/features/submission-gates.md",
                  kind: "spec",
                },
                {
                  label: "submission-portal reference",
                  url: "/.lovable/memory/features/submission-portal.md",
                  kind: "doc",
                },
              ],
            }}
          />
        </div>
      )}
      {sourceEntryId && (
        <div className="px-4 pt-2 pb-1">
          <WaiverQualificationPanel entryId={sourceEntryId} />
        </div>
      )}
      {sourceEntryId && (
        <div className="px-4 pt-2 pb-1">
          <WhatYouSeePreview entryId={sourceEntryId} />
        </div>
      )}
      {sourceEntryId && (
        <div className="px-4 pt-2 pb-1">
          <PrivateVsPublicDiff entryId={sourceEntryId} />
        </div>
      )}
      <SubmissionPortal sourceEntryId={sourceEntryId ?? null} />
    </Suspense>
  );
}
