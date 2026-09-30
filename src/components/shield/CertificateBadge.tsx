import { Link } from "react-router-dom";
import { Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  certificateNumber: string;
  sha256Hash: string;
  status?: string;
  className?: string;
}

export function CertificateBadge({ certificateNumber, sha256Hash, status, className }: Props) {
  return (
    <Link
      to={`/shield/verify/${sha256Hash}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[10px] font-mono uppercase tracking-wider hover:bg-gold/20 transition-colors",
        className,
      )}
      title={`Qi Authorship Certificate ${certificateNumber}${status ? ` · ${status}` : ""}`}
    >
      <Award className="h-3 w-3" />
      Qi Certified
    </Link>
  );
}
