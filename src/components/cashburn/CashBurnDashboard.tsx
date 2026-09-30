import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CashBurnScope, useCashBurn } from "@/hooks/useCashBurn";
import { BurnSummaryCards } from "./BurnSummaryCards";
import { MonthlyBurnTable } from "./MonthlyBurnTable";
import { ScenarioModeler } from "./ScenarioModeler";
import { MilestoneTracker } from "./MilestoneTracker";
import { BurnCharts } from "./BurnCharts";
import { BurnIntelligencePanel } from "./BurnIntelligencePanel";
import { Q2EStabilityScore } from "./Q2EStabilityScore";

interface Props {
  scopeType: CashBurnScope;
  scopeId: string;
  scopeLabel?: string;
}

export function CashBurnDashboard({ scopeType, scopeId, scopeLabel }: Props) {
  const cb = useCashBurn(scopeType, scopeId);
  const label = scopeLabel || scopeType;

  if (cb.loading) return <div className="text-sm text-muted-foreground p-6">Loading cash burn…</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <BurnSummaryCards {...cb.summary} />
        <Q2EStabilityScore
          records={cb.records}
          milestones={cb.milestones}
          runwayMonths={cb.summary.runwayMonths}
          monthlyRevenue={cb.summary.monthlyRevenue}
        />
      </div>

      <BurnIntelligencePanel
        records={cb.records}
        milestones={cb.milestones}
        runwayMonths={cb.summary.runwayMonths}
        netBurn={cb.summary.netBurn}
        monthlyRevenue={cb.summary.monthlyRevenue}
        scopeLabel={label}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="monthly">Monthly burn</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <BurnCharts records={cb.records} />
        </TabsContent>
        <TabsContent value="monthly" className="mt-4">
          <MonthlyBurnTable records={cb.records} canEdit={cb.canEdit} onUpsert={cb.upsertRecord} onDelete={cb.deleteRecord} />
        </TabsContent>
        <TabsContent value="scenarios" className="mt-4">
          <ScenarioModeler scenarios={cb.scenarios} canEdit={cb.canEdit} onUpsert={cb.upsertScenario} />
        </TabsContent>
        <TabsContent value="milestones" className="mt-4">
          <MilestoneTracker
            milestones={cb.milestones}
            canEdit={cb.canEdit}
            runwayMonths={cb.summary.runwayMonths}
            onUpsert={cb.upsertMilestone}
            onDelete={cb.deleteMilestone}
          />
        </TabsContent>
      </Tabs>

      {!cb.canEdit && (
        <p className="text-xs text-muted-foreground">You have read-only access to this scope's financials.</p>
      )}
    </div>
  );
}
