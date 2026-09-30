import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Competition {
  id: string;
  name: string;
  status: string;
}

export function CompetitionPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [comps, setComps] = useState<Competition[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("competitions")
        .select("id,name,status")
        .order("created_at", { ascending: false });
      const list = (data ?? []) as Competition[];
      setComps(list);
      if (!value && list.length) onChange(list[0].id);
    })();
  }, [value, onChange]);

  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className="w-[320px] bg-background/60 border-border/60">
        <SelectValue placeholder="Select a competition" />
      </SelectTrigger>
      <SelectContent>
        {comps.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="font-body">{c.name}</span>
            <span className="ml-2 text-[10px] font-mono uppercase text-muted-foreground">{c.status}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
