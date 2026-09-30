// Script Club reward math — ported from ScriptScout donor.
// Base 6 tokens + top-30% reviewer bonus + streak bonus (cap 3).
export interface RewardBreakdown {
  base: number;
  bonus: number;
  streak: number;
  total: number;
}

export function calculateReward(
  reviewerTotalReviews: number,
  reviewerStreak: number,
  allReviewerTotals: number[]
): RewardBreakdown {
  const base = 6;
  const sorted = [...allReviewerTotals].sort((a, b) => b - a);
  const threshold = sorted[Math.floor(sorted.length * 0.3)] ?? 0;
  const bonus = reviewerTotalReviews >= threshold && sorted.length > 0 ? 5 : 0;
  const streak = Math.min(Math.floor(reviewerStreak / 3), 3);
  return { base, bonus, streak, total: base + bonus + streak };
}
