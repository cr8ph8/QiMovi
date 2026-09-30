import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FileText, Scale, AlertCircle } from "lucide-react";
import { useParityDeal } from "@/hooks/useParityDeal";
import ParityDealEditor from "./ParityDealEditor";
import ParityParticipants from "./ParityParticipants";
import ParityScenarioModeler from "./ParityScenarioModeler";
import ParityAgreementExport from "./ParityAgreementExport";

interface Props {
  universeId?: string;
  entryId?: string;
  contextLabel?: string;
  isOverride?: boolean;
}

export default function ParityDealPanel({ universeId, entryId, contextLabel, isOverride }: Props) {
  const {
    deal, participants, loading, saving,
    create, update, toggleReservedRight,
    addParticipant, updateParticipant, removeParticipant,
  } = useParityDeal({ universeId, entryId });
  const [enabledTab, setEnabledTab] = useState("terms");

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading parity deal…
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-border/40 bg-background/30 p-4">
          <Scale className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <div>
              <div className="font-medium">Parity Profit Participation</div>
              <p className="text-xs text-muted-foreground mt-1">
                Opt into a Sing Sing-style deal: flat day rate for everyone, then a transparent waterfall with investor / creator-IP / contributor pools.
                {isOverride && " This override only applies to this entry."}
              </p>
            </div>
            <Button size="sm" onClick={create} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Enable Parity Model
            </Button>
          </div>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
          <AlertCircle className="h-3 w-3" /> Modeler only — no payouts. Always have an entertainment attorney review your final deal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Scale className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium flex items-center gap-2">
              Parity Profit Participation
              {isOverride && <Badge variant="outline" className="text-[10px]">Entry override</Badge>}
            </div>
            {contextLabel && <div className="text-xs text-muted-foreground">{contextLabel}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{deal.is_enabled ? "Active" : "Disabled"}</span>
          <Switch checked={deal.is_enabled} onCheckedChange={(v) => update({ is_enabled: v })} />
        </div>
      </div>

      {deal.is_enabled && (
        <Tabs value={enabledTab} onValueChange={setEnabledTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="terms">Terms</TabsTrigger>
            <TabsTrigger value="participants">Participants</TabsTrigger>
            <TabsTrigger value="modeler">Modeler</TabsTrigger>
            <TabsTrigger value="export"><FileText className="h-3.5 w-3.5 mr-1" /> Export</TabsTrigger>
          </TabsList>
          <TabsContent value="terms" className="pt-6">
            <ParityDealEditor deal={deal} onChange={update} onToggleRight={toggleReservedRight} />
          </TabsContent>
          <TabsContent value="participants" className="pt-6">
            <ParityParticipants
              participants={participants}
              onAdd={addParticipant}
              onUpdate={updateParticipant}
              onRemove={removeParticipant}
            />
          </TabsContent>
          <TabsContent value="modeler" className="pt-6">
            <ParityScenarioModeler deal={deal} participants={participants} />
          </TabsContent>
          <TabsContent value="export" className="pt-6">
            <ParityAgreementExport deal={deal} participants={participants} contextLabel={contextLabel} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
