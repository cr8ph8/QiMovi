// Route-level error boundary with Sonner fallback + reset key.
// Wrap critical surfaces (Submission, Judges, Brain Dump, Workspace) to keep
// runtime errors local to that surface and recoverable without a hard reload.
import { Component, ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  /** Stable label used in toast + telemetry. */
  surface: string;
  /** Changing this value resets the boundary (e.g. route param). */
  resetKey?: string | number;
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Structured log per project conventions.
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        component: "ErrorBoundary",
        action: "catch",
        surface: this.props.surface,
        message: error.message,
        stack: info.componentStack?.split("\n").slice(0, 4).join(" | "),
      })
    );
    toast.error(`${this.props.surface} ran into a problem.`, {
      description: error.message?.slice(0, 140) ?? "Unknown error",
    });
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="container max-w-lg py-24">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
            <h2 className="mt-3 font-display text-xl">Something interrupted {this.props.surface}.</h2>
            <p className="mt-2 text-sm text-muted-foreground break-words">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <Button onClick={this.reset} variant="outline" size="sm" className="mt-4">
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
