import { Badge } from "@/components/ui/badge";
import { Crown, Gavel } from "lucide-react";

export function RoleChip({ role }: { role: "lead" | "judge" | "admin" }) {
  if (role === "admin") {
    return (
      <Badge variant="outline" className="bg-amber-500/15 border-amber-500/40 text-amber-300 font-mono text-[10px] uppercase tracking-wider">
        <Crown className="h-3 w-3 mr-1" /> Admin
      </Badge>
    );
  }
  if (role === "lead") {
    return (
      <Badge variant="outline" className="bg-primary/15 border-primary/40 text-primary font-mono text-[10px] uppercase tracking-wider">
        <Crown className="h-3 w-3 mr-1" /> Lead Judge
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-muted/40 border-border text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
      <Gavel className="h-3 w-3 mr-1" /> Judge
    </Badge>
  );
}
