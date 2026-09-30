import { usePlatform } from "@/contexts/PlatformContext";
import { useAuth } from "@/hooks/useAuth";
import { Code, User } from "lucide-react";

export function PlatformSwitcher() {
  const { mode, setMode } = usePlatform();
  const { isAdmin } = useAuth();

  if (!isAdmin) return null;

  return (
    <button
      onClick={() => setMode(mode === "user" ? "developer" : "user")}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border/50 bg-card/95 px-4 py-2 shadow-lg backdrop-blur-sm transition-all hover:border-primary/50"
      title={`Switch to ${mode === "user" ? "Developer" : "User"} mode`}
    >
      {mode === "developer" ? (
        <>
          <Code className="h-4 w-4 text-primary" />
          <span className="text-xs font-mono text-primary">DEV</span>
        </>
      ) : (
        <>
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">USER</span>
        </>
      )}
    </button>
  );
}
