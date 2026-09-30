import KnowledgePanel from "@/components/admin/KnowledgePanel";

/**
 * Knowledge mode panel — surfaces the documents/concepts/links graph
 * inside the writer workspace. Previously only reachable from God Mode.
 */
export default function KnowledgeWorkspacePanel() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <KnowledgePanel />
    </div>
  );
}
