import { usePlatform, type FeatureTier } from "@/contexts/PlatformContext";

function dotColor(tier: FeatureTier, enabled: boolean): string {
  if (!enabled) return "bg-destructive";
  if (tier === "disabled") return "bg-destructive";
  if (tier === "free") return "bg-green-500";
  return "bg-yellow-500"; // basic, pro, token
}

export function DevStatusDot({ id }: { id: string }) {
  const { mode, getFeatureConfig } = usePlatform();
  if (mode !== "developer") return null;
  const config = getFeatureConfig(id);
  if (!config) return null;

  return (
    <span
      className={`absolute top-1 right-1 h-2.5 w-2.5 rounded-full ${dotColor(config.tier, config.enabled)} ring-2 ring-background z-10`}
      title={`${config.enabled ? "ON" : "OFF"} · ${config.tier}`}
    />
  );
}
