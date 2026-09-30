import { ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Detailed findings are deliberately excluded from the browser bundle and
 * GitHub repository. The authoritative report belongs in the private
 * operations workspace, where access can be audited server-side.
 */
export default function SecurityFindingsReport() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <CardTitle>Security findings</CardTitle>
        </div>
        <CardDescription>Private operations record</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Detailed findings are kept outside the production client and source
          repository. Review them through the authorized operations workspace.
        </p>
      </CardContent>
    </Card>
  );
}
