import { ReactNode } from "react";
import { usePlatform } from "@/contexts/PlatformContext";
import { DevStatusDot } from "./DevStatusDot";

interface FeatureGateProps {
  id: string;
  children: ReactNode;
}

export function FeatureGate({ id, children }: FeatureGateProps) {
  const { mode, isFeatureEnabled, getFeatureConfig } = usePlatform();
  const config = getFeatureConfig(id);
  const enabled = isFeatureEnabled(id);

  if (mode === "developer") {
    const isOff = !config?.enabled || config?.tier === "disabled";
    return (
      <div className={`relative ${isOff ? "opacity-40" : ""}`}>
        <DevStatusDot id={id} />
        {children}
      </div>
    );
  }

  if (!enabled) return null;
  return <>{children}</>;
}
