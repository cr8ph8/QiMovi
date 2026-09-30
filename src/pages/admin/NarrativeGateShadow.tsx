import NarrativeGateShadowPanel from "@/components/admin/NarrativeGateShadowPanel";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function NarrativeGateShadowPage() {
  useDocumentTitle("Narrative Gate · Shadow Mode");
  return (
    <div className="min-h-screen bg-cinema text-foreground">
      <div className="max-w-5xl mx-auto pt-20 pb-12 px-2">
        <NarrativeGateShadowPanel />
      </div>
    </div>
  );
}
