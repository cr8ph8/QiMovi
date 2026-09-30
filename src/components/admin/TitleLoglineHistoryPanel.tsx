import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { History, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

interface HistoryRow {
  id: string;
  entry_id: string;
  user_id: string;
  field: string;
  old_value: string | null;
  new_value: string;
  source: string;
  created_at: string;
}

const SOURCE_COLORS: Record<string, string> = {
  manual: "bg-muted text-muted-foreground",
  ai_suggest: "bg-primary/15 text-primary",
  ai_generate: "bg-accent/50 text-accent-foreground",
};

export default function TitleLoglineHistoryPanel() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [fieldFilter, setFieldFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  useEffect(() => {
    fetchHistory();
  }, [page, fieldFilter, sourceFilter]);

  const fetchHistory = async () => {
    setLoading(true);
    let query = supabase
      .from("title_logline_history" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (fieldFilter !== "all") query = query.eq("field", fieldFilter);
    if (sourceFilter !== "all") query = query.eq("source", sourceFilter);

    const { data, error } = await query;
    if (!error && data) setRows(data as unknown as HistoryRow[]);
    setLoading(false);
  };

  const filtered = search
    ? rows.filter(
        (r) =>
          r.new_value?.toLowerCase().includes(search.toLowerCase()) ||
          r.old_value?.toLowerCase().includes(search.toLowerCase()) ||
          r.entry_id.includes(search) ||
          r.user_id.includes(search)
      )
    : rows;

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 p-6">
      <div className="flex items-center gap-3 mb-5">
        <History className="h-5 w-5 text-primary" />
        <h3 className="font-display text-lg font-bold">Title & Logline History</h3>
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {filtered.length} entries
        </Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search values, entry ID, user ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs font-mono"
          />
        </div>
        <Select value={fieldFilter} onValueChange={(v) => { setFieldFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[120px] h-9 text-xs font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Fields</SelectItem>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="logline">Logline</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(v) => { setSourceFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[130px] h-9 text-xs font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="ai_suggest">AI Suggest</SelectItem>
            <SelectItem value="ai_generate">AI Generate</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No history entries found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 text-muted-foreground">
                <th className="text-left py-2 px-2 font-mono font-medium">Date</th>
                <th className="text-left py-2 px-2 font-mono font-medium">Field</th>
                <th className="text-left py-2 px-2 font-mono font-medium">Old → New</th>
                <th className="text-left py-2 px-2 font-mono font-medium">Source</th>
                <th className="text-left py-2 px-2 font-mono font-medium">Entry</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                  <td className="py-2.5 px-2 font-mono text-muted-foreground whitespace-nowrap">
                    {format(new Date(row.created_at), "MMM d, HH:mm")}
                  </td>
                  <td className="py-2.5 px-2">
                    <Badge variant="outline" className="font-mono text-[10px] capitalize">
                      {row.field}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-2 max-w-[400px]">
                    <div className="flex items-start gap-1.5">
                      <span className="text-muted-foreground line-through truncate max-w-[160px]" title={row.old_value || "—"}>
                        {row.old_value || "—"}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                      <span className="text-foreground truncate max-w-[200px] font-medium" title={row.new_value}>
                        {row.new_value}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-2">
                    <Badge className={`font-mono text-[10px] ${SOURCE_COLORS[row.source] || ""}`}>
                      {row.source}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-2 font-mono text-[10px] text-muted-foreground">
                    {row.entry_id.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <Button variant="outline" size="sm" className="text-xs font-mono" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="text-xs text-muted-foreground font-mono">Page {page + 1}</span>
        <Button variant="outline" size="sm" className="text-xs font-mono" disabled={filtered.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
