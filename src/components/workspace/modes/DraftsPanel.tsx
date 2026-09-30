import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const MyDrafts = lazy(() => import("@/pages/MyDrafts"));

/**
 * Drafts mode panel. Delegates to legacy MyDrafts. Cross-navigation to
 * `/entry/:projectId` (when unified lifecycle is on) is handled inside the
 * panel rows themselves in a later pass; for now the legacy navigation is
 * preserved end-to-end.
 */
export default function DraftsPanel() {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <MyDrafts />
    </Suspense>
  );
}
