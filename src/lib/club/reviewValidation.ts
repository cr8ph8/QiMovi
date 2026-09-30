// Local client-side review gate (mirrors server validation).
// Catches the obvious problems before the AI screener is invoked.

export interface ReviewDraft {
  readProgress: number;          // 0..100
  readTimeMinutes: number;
  totalPages: number;
  whatWorked: string;
  whatDidnt: string;
  oneImprovement: string;
}

export interface ExistingReviewText {
  whatWorked: string;
  whatDidnt: string;
  oneImprovement: string;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

export function validateReview(
  review: ReviewDraft,
  existingReviews: ExistingReviewText[],
  reviewsToday: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (review.readProgress < 100) {
    errors.push("You must finish reading the entire screenplay before submitting a review.");
  }
  const minMinutes = Math.ceil(review.totalPages * 0.5);
  if (review.readTimeMinutes < minMinutes) {
    errors.push(
      `Minimum reading time is ${minMinutes} minutes for ${review.totalPages} pages. You've read for ${review.readTimeMinutes} minutes.`
    );
  }
  if (wordCount(review.whatWorked) < 30) errors.push('"What Worked" must be at least 30 words.');
  if (wordCount(review.whatDidnt) < 30) errors.push('"What Didn\'t Work" must be at least 30 words.');
  if (wordCount(review.oneImprovement) < 30) errors.push('"One Improvement" must be at least 30 words.');

  for (const existing of existingReviews) {
    const combinedNew = `${review.whatWorked} ${review.whatDidnt} ${review.oneImprovement}`;
    const combinedOld = `${existing.whatWorked} ${existing.whatDidnt} ${existing.oneImprovement}`;
    if (jaccardSimilarity(combinedNew, combinedOld) >= 0.6) {
      errors.push("Your review is too similar to an existing review. Please write original feedback.");
      break;
    }
  }

  if (reviewsToday >= 3) {
    errors.push("You've reached the daily limit of 3 reviews.");
  }

  return { valid: errors.length === 0, errors };
}
