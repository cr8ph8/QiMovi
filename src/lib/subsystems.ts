import {
  Shield, FileText, Brain, Coins, Trophy, BookOpen,
  Server, CreditCard, Database,
} from "lucide-react";

export interface SubsystemNode {
  id: string;
  title: string;
  icon: typeof Shield;
  tables: string[];
  edgeFunctions: string[];
  auditActions: string[];
  godModeTab?: string;
}

export const SUBSYSTEMS: SubsystemNode[] = [
  {
    id: "auth",
    title: "Auth & Profiles",
    icon: Shield,
    tables: ["profiles", "user_roles", "access_grants", "access_requests", "pending_invites"],
    edgeFunctions: ["auth-email-hook"],
    auditActions: [],
    godModeTab: "Access",
  },
  {
    id: "entries",
    title: "Entries & Submissions",
    icon: FileText,
    tables: ["entries", "scores", "screenplay_highlights", "script_quotients", "evaluation_runs"],
    edgeFunctions: ["parse-screenplay", "export-document", "withdraw-entry", "process-batch"],
    auditActions: ["submit_entry", "delete_entry"],
    godModeTab: "Content",
  },
  {
    id: "ai",
    title: "AI Engine",
    icon: Brain,
    tables: ["ai_usage_log", "competition_judge_config", "judge_usage_log", "voice_drift_analysis"],
    edgeFunctions: ["ai-judge", "ai-compare", "rewrite-selection", "voice-drift", "generate-script"],
    auditActions: [],
    godModeTab: "AI & Costs",
  },
  {
    id: "tokens",
    title: "Token Economy",
    icon: Coins,
    tables: ["token_wallets", "wallet_transactions", "purchases", "feature_votes"],
    edgeFunctions: ["add-tokens", "spend-tokens", "transfer-tokens", "activate-pro-tokens"],
    auditActions: ["add_tokens", "spend_tokens", "transfer_tokens"],
    godModeTab: "Tokens",
  },
  {
    id: "competitions",
    title: "Competitions & Festivals",
    icon: Trophy,
    tables: ["competitions", "festivals", "seasons", "festival_ad_slots", "ad_slot_analytics"],
    edgeFunctions: ["seed-filmstack"],
    auditActions: ["update_competition"],
    godModeTab: "Competitions",
  },
  {
    id: "governance",
    title: "Governance & Audit",
    icon: BookOpen,
    tables: ["audit_log", "system_audits", "site_settings", "data_deletion_requests", "user_notifications"],
    edgeFunctions: ["notify-admin-demo-request", "notify-trial-application", "send-transactional-email", "process-email-queue", "handle-email-suppression", "handle-email-unsubscribe", "preview-transactional-email"],
    auditActions: ["system_status"],
    godModeTab: "Dev Log",
  },
  {
    id: "subscriptions",
    title: "Subscriptions & Plans",
    icon: CreditCard,
    tables: ["subscriptions", "subscription_changes", "feature_subscriptions", "feature_configs"],
    edgeFunctions: ["manage-feature-subscription", "renew-subscriptions"],
    auditActions: [],
    godModeTab: "Subscriptions",
  },
  {
    id: "content",
    title: "Content & Documents",
    icon: Database,
    tables: ["business_documents", "document_versions", "feature_roadmap", "module_configs"],
    edgeFunctions: ["legal-summary"],
    auditActions: [],
    godModeTab: "Documents",
  },
  {
    id: "storage",
    title: "Storage & Edge Functions",
    icon: Server,
    tables: ["upload_bonuses_claimed", "user_badges", "user_genre_stats", "user_feature_grants", "user_module_grants"],
    edgeFunctions: [],
    auditActions: [],
    godModeTab: "Platform",
  },
];

export const SUBSYSTEM_FUNCTION_MAP: Record<string, string[]> = {
  ai: ["ai-judge", "ai-compare", "rewrite-selection", "voice-drift", "generate-script", "organize-brain-dump", "suggest-character-diamond", "verify-character-identity", "embed-character", "rollback-character-diamond"],
  entries: ["parse-screenplay", "export-document", "withdraw-entry", "process-batch"],
  tokens: ["add-tokens", "spend-tokens", "transfer-tokens", "activate-pro-tokens"],
  competitions: ["seed-filmstack"],
  governance: ["notify-admin-demo-request", "notify-trial-application", "send-transactional-email", "process-email-queue", "handle-email-suppression", "handle-email-unsubscribe", "preview-transactional-email"],
  subscriptions: ["manage-feature-subscription", "renew-subscriptions"],
  content: ["legal-summary"],
  auth: ["auth-email-hook"],
};
