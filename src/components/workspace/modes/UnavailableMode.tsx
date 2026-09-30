import { Info } from "lucide-react";

interface Props {
  title: string;
  reason: string;
  cta?: React.ReactNode;
}

/** Friendly placeholder when a mode is not yet available for the current kernel. */
export default function UnavailableMode({ title, reason, cta }: Props) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted border border-border">
          <Info className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-playfair text-2xl font-bold">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{reason}</p>
        {cta}
      </div>
    </div>
  );
}
