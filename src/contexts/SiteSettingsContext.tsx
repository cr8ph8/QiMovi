import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_LAUNCH_STATE,
  getLaunchPresentation,
  getPublicLaunchAvailability,
  parseLaunchState,
  type LaunchState,
  type PublicLaunchCta,
} from "@/lib/launchState";

export interface SiteSettings {
  launchState: LaunchState;
  publicCta: PublicLaunchCta;
  publicSubmissionsOpen: boolean;
  publicPaymentsOpen: boolean;
  submissionsOpen: boolean;
  signupsOpen: boolean;
  paymentsOpen: boolean;
  signinVisible: boolean;
  maintenanceMode: boolean;
  countdownVisible: boolean;
  socialProofVisible: boolean;
  sectionSeasonZero: boolean;
  sectionDemoPreview: boolean;
  sectionHowItWorks: boolean;
  sectionCompetitionModes: boolean;
  sectionWhyThisMatters: boolean;
  sectionFeatures: boolean;
  sectionLeaderboard: boolean;
  sectionPastWinners: boolean;
  sectionRoadmap: boolean;
  sectionChangelog: boolean;
  sectionFinalCta: boolean;
  sectionTrialApp: boolean;
  sectionQrWaitlist: boolean;
  showProUpgradeBanner: boolean;
  maintenanceEta: string | null;
  loading: boolean;
}

const defaultSettings: SiteSettings = {
  launchState: DEFAULT_LAUNCH_STATE,
  publicCta: getLaunchPresentation(DEFAULT_LAUNCH_STATE).cta,
  publicSubmissionsOpen: false,
  publicPaymentsOpen: false,
  submissionsOpen: false,
  signupsOpen: false,
  paymentsOpen: false,
  signinVisible: true,
  maintenanceMode: false,
  countdownVisible: false,
  socialProofVisible: false,
  sectionSeasonZero: true,
  sectionDemoPreview: true,
  sectionHowItWorks: true,
  sectionCompetitionModes: true,
  sectionWhyThisMatters: true,
  sectionFeatures: true,
  sectionLeaderboard: true,
  sectionPastWinners: true,
  sectionRoadmap: true,
  sectionChangelog: true,
  sectionFinalCta: true,
  sectionTrialApp: true,
  sectionQrWaitlist: true,
  showProUpgradeBanner: false,
  maintenanceEta: null,
  loading: true,
};

const SiteSettingsContext = createContext<SiteSettings>(defaultSettings);

interface StoredSiteSetting {
  value: boolean;
  textValue: string | null;
}

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, StoredSiteSetting>>({});
  const [maintenanceEta, setMaintenanceEta] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data }, { data: cfg }] = await Promise.all([
        supabase.from("site_settings" as any).select("key, value, text_value"),
        supabase.from("landing_page_config" as any).select("maintenance_eta").eq("id", "season_zero").single(),
      ]);
      const map: Record<string, StoredSiteSetting> = {};
      (data as any[] || []).forEach((row: any) => {
        map[row.key] = {
          value: row.value,
          textValue: row.text_value ?? null,
        };
      });
      setSettings(map);
      setMaintenanceEta((cfg as any)?.maintenance_eta ?? null);
      setLoading(false);
    }
    load();

    // Realtime — postgres_changes only (broadcast/presence blocked by policy)
    // See REALTIME_SUBSCRIPTION_RULES.md before adding new subscriptions
    const channel = supabase
      .channel("site_settings_changes")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "site_settings" }, (payload: any) => {
        if (payload.eventType === "DELETE" && payload.old?.key) {
          setSettings((prev) => {
            const next = { ...prev };
            delete next[payload.old.key];
            return next;
          });
          return;
        }
        if (payload.new) {
          setSettings((prev) => ({
            ...prev,
            [payload.new.key]: {
              value: payload.new.value,
              textValue: payload.new.text_value ?? null,
            },
          }));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const settingValue = (key: string, fallback: boolean) =>
    settings[key]?.value ?? fallback;
  const launchState = parseLaunchState(settings.launch_state?.textValue);
  const submissionsOpen = settingValue("submissions_open", false);
  const paymentsOpen = settingValue("payments_open", false);
  const publicAvailability = getPublicLaunchAvailability(launchState, {
    submissionsOpen,
    paymentsOpen,
  });

  const value: SiteSettings = {
    launchState,
    publicCta: getLaunchPresentation(launchState).cta,
    ...publicAvailability,
    submissionsOpen,
    signupsOpen: settingValue("signups_open", false),
    paymentsOpen,
    signinVisible: settingValue("signin_visible", true),
    maintenanceMode: settingValue("maintenance_mode", false),
    countdownVisible: settingValue("countdown_visible", false),
    socialProofVisible: settingValue("social_proof_visible", false),
    sectionSeasonZero: settingValue("section_season_zero", true),
    sectionDemoPreview: settingValue("section_demo_preview", true),
    sectionHowItWorks: settingValue("section_how_it_works", true),
    sectionCompetitionModes: settingValue("section_competition_modes", true),
    sectionWhyThisMatters: settingValue("section_why_this_matters", true),
    sectionFeatures: settingValue("section_features", true),
    sectionLeaderboard: settingValue("section_leaderboard", true),
    sectionPastWinners: settingValue("section_past_winners", true),
    sectionRoadmap: settingValue("section_roadmap", true),
    sectionChangelog: settingValue("section_changelog", true),
    sectionFinalCta: settingValue("section_final_cta", true),
    sectionTrialApp: settingValue("section_trial_app", true),
    sectionQrWaitlist: settingValue("section_qr_waitlist", true),
    showProUpgradeBanner: settingValue("show_pro_upgrade_banner", false),
    maintenanceEta,
    loading,
  };

  return (
    <SiteSettingsContext.Provider value={value}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export const useSiteSettings = () => useContext(SiteSettingsContext);
