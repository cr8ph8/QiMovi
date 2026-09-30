import { Link } from "react-router-dom";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export function BottomBar() {
  const { user } = useAuth();

  if (user) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/90 backdrop-blur-xl">
      <div className="container flex items-center justify-center py-3">
        <Link to="/auth" className="w-full">
          <Button className="w-full bg-gold-gradient font-body font-semibold text-primary-foreground hover:opacity-90 gap-2">
            <LogIn className="h-4 w-4" />
            Sign In
          </Button>
        </Link>
      </div>
    </div>
  );
}
