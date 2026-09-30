import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { CashBurnRecord, EXPENSE_FIELDS, EXPENSE_LABELS, totalExpenses, netBurn, endingCash } from "@/hooks/useCashBurn";
import { formatCurrency } from "./BurnSummaryCards";

interface Props {
  records: CashBurnRecord[];
  canEdit: boolean;
  onUpsert: (rec: Partial<CashBurnRecord> & { month: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function todayMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function MonthlyBurnTable({ records, canEdit, onUpsert, onDelete }: Props) {
  const [draft, setDraft] = useState<Record<string, Partial<CashBurnRecord>>>({});

  const setField = (id: string, field: keyof CashBurnRecord, value: any) => {
    setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), [field]: value } }));
  };

  const merged = (r: CashBurnRecord) => ({ ...r, ...(draft[r.id] || {}) });

  const addMonth = async () => {
    const last = [...records].sort((a, b) => a.month.localeCompare(b.month)).pop();
    let month = todayMonth();
    if (last) {
      const d = new Date(last.month);
      d.setUTCMonth(d.getUTCMonth() + 1);
      month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }
    await onUpsert({
      month,
      starting_cash: last ? endingCash(last) : 0,
    });
  };

  const save = async (r: CashBurnRecord) => {
    const m = merged(r);
    await onUpsert({ id: r.id, month: r.month, ...draft[r.id] });
    setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Monthly burn</h3>
        {canEdit && (
          <Button size="sm" onClick={addMonth}><Plus className="h-3 w-3 mr-1" />Add month</Button>
        )}
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Start cash</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              {EXPENSE_FIELDS.map((f) => (
                <TableHead key={f} className="text-right">{EXPENSE_LABELS[f]}</TableHead>
              ))}
              <TableHead className="text-right">Total exp.</TableHead>
              <TableHead className="text-right">Net burn</TableHead>
              <TableHead className="text-right">Ending cash</TableHead>
              {canEdit && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 && (
              <TableRow><TableCell colSpan={EXPENSE_FIELDS.length + 5} className="text-center text-sm text-muted-foreground py-8">No data yet. {canEdit && "Click Add month to begin."}</TableCell></TableRow>
            )}
            {records.map((r) => {
              const m = merged(r);
              const dirty = Boolean(draft[r.id]);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium whitespace-nowrap">{r.month.slice(0, 7)}</TableCell>
                  <NumCell value={m.starting_cash} onChange={(v) => setField(r.id, "starting_cash", v)} editable={canEdit} />
                  <NumCell value={m.revenue_collected} onChange={(v) => setField(r.id, "revenue_collected", v)} editable={canEdit} />
                  {EXPENSE_FIELDS.map((f) => (
                    <NumCell key={f} value={(m as any)[f]} onChange={(v) => setField(r.id, f, v)} editable={canEdit} />
                  ))}
                  <TableCell className="text-right tabular-nums">{formatCurrency(totalExpenses(m))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(netBurn(m))}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatCurrency(endingCash(m))}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right whitespace-nowrap">
                      {dirty && <Button size="sm" variant="secondary" className="mr-1" onClick={() => save(r)}>Save</Button>}
                      <Button size="icon" variant="ghost" onClick={() => onDelete(r.id)}><Trash2 className="h-3 w-3" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function NumCell({ value, onChange, editable }: { value: number | undefined; onChange: (v: number) => void; editable: boolean }) {
  if (!editable) return <TableCell className="text-right tabular-nums">{formatCurrency(Number(value || 0))}</TableCell>;
  return (
    <TableCell className="text-right">
      <Input
        type="number"
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-24 text-right tabular-nums ml-auto"
      />
    </TableCell>
  );
}
