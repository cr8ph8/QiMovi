import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CanonEditor from "./CanonEditor";
import NarrativeTestRunner from "./NarrativeTestRunner";

interface Props {
  universeId: string;
  userId: string;
  entries: { id: string; title: string }[];
}

export default function CanonicalNarrativeTab({ universeId, userId, entries }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Define the universe's canonical story DNA, then test how each installment expresses it under
        both Western (causal) and Eastern (relational) lenses. See{" "}
        <a className="text-primary hover:underline" href="/framework/narrative-traditions">
          the underlying story math
        </a>.
      </p>
      <Tabs defaultValue="canon">
        <TabsList>
          <TabsTrigger value="canon">Canon</TabsTrigger>
          <TabsTrigger value="test">Test against canon</TabsTrigger>
        </TabsList>
        <TabsContent value="canon" className="pt-4">
          <CanonEditor universeId={universeId} userId={userId} />
        </TabsContent>
        <TabsContent value="test" className="pt-4">
          <NarrativeTestRunner universeId={universeId} entries={entries} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
