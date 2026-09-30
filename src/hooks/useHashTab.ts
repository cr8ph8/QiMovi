import { useState, useEffect, useCallback } from "react";

export function useHashTab(validTabs: readonly string[], defaultTab: string): [string, (tab: string) => void] {
  const readHash = (): string => {
    const hash = window.location.hash.replace(/^#/, "");
    return validTabs.includes(hash) ? hash : defaultTab;
  };

  const [activeTab, setActiveTabState] = useState<string>(readHash);

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    window.location.hash = tab;
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveTabState(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [validTabs, defaultTab]);

  return [activeTab, setActiveTab];
}
