import { HelpCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useTour } from "@/lib/tour/useTour";

export function HelpMenuButton() {
  const { user, isJudge, isAdmin } = useAuth();
  const { start, reset } = useTour();

  if (!user) return null;

  const showJudge = isJudge || isAdmin;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-tour="help"
          aria-label="Help and walkthrough"
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Walkthrough
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            reset();
            start("writer");
          }}
          className="cursor-pointer"
        >
          Restart writer tour
        </DropdownMenuItem>
        {showJudge && (
          <DropdownMenuItem
            onClick={() => {
              reset();
              start("judge");
            }}
            className="cursor-pointer"
          >
            Restart judge tour
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <a href="/how-it-works">How it works</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
