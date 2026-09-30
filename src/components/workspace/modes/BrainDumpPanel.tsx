import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const BrainDump = lazy(() => import("@/pages/BrainDump"));

export default function BrainDumpPanel() {
  return (
    <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
      <BrainDump />
    </Suspense>
  );
}
