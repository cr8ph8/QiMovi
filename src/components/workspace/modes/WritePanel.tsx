import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const ScreenplayWriter = lazy(() => import("@/pages/ScreenplayWriter"));

interface Props {
  draftId?: string | null;
}

/**
 * Write mode panel. Wraps the legacy ScreenplayWriter; the parent shell keeps
 * the `?draft=` search param synced with the active draft id so the embedded
 * editor opens the right document.
 */
export default function WritePanel(_props: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <ScreenplayWriter />
    </Suspense>
  );
}
