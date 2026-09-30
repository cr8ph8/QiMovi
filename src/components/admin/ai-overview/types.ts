export interface AiUsageRow {
  function_name: string;
  model_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
  created_at: string;
}

export interface JudgeUsageRow {
  model_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
  created_at: string;
}

export interface UsageRow {
  source: string;
  model_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_cents: number | null;
  created_at: string;
}

export interface FnStat {
  calls: number;
  cost: number;
  tokens: number;
  lastUsed: string;
}
