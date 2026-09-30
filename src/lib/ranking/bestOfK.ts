/**
 * Verifier-based best-of-K ranking.
 *
 * Given K variants and a K×K matrix P where P[i][j] = Pr(i preferred over j),
 * fit a Bradley–Terry model to recover latent strengths and derive a full
 * ranking with per-position confidence (softmax over strengths).
 *
 * Design notes:
 * - Server elicits preferences by pairwise LLM judgments over both orderings
 *   (position-swap debias) with N Monte-Carlo repeats per ordering.
 * - Client only consumes the summary this module produces so UI stays cheap.
 */

export interface RankedVariant {
  /** Original index in the variants[] array passed to the ranker. */
  index: number;
  /** Bradley–Terry latent strength (log-scale). */
  strength: number;
  /** Softmax(strength) — probability this variant is best of K. */
  probBest: number;
  /** Average pairwise win probability across all opponents. */
  avgWinProb: number;
  /** Number of pairwise judgments contributing to this variant. */
  judgmentCount: number;
}

export interface RankingResult {
  ranking: RankedVariant[];
  /** Full K×K preference matrix used to fit the model (P[i][j] = Pr(i > j)). */
  preferenceMatrix: number[][];
  /** K×K pairwise judgment counts (symmetric; countsMatrix[i][j] === countsMatrix[j][i]). */
  countsMatrix?: number[][];
  /** For each matrix row/col index, the caller-side variant index it refers to. */
  matrixVariantIndices?: number[];
  /** Confidence in the top pick = probBest of rank 1. In [1/K, 1]. */
  topConfidence: number;
  /** Margin between top-1 and top-2 probBest. Useful for "too close to call" flags. */
  topMargin: number;
  /** Preference matrix entropy (bits), averaged over off-diagonal cells. */
  entropyAvg: number;
  /** Total pairwise judgments used across all cells. */
  totalJudgments: number;
}

/**
 * Fit Bradley–Terry strengths via minorization-maximization.
 * See Hunter (2004), "MM algorithms for generalized Bradley-Terry models".
 * Input: winsMatrix[i][j] = number of times i beat j.
 */
export function fitBradleyTerry(
  winsMatrix: number[][],
  maxIter = 200,
  tol = 1e-6,
): number[] {
  const K = winsMatrix.length;
  if (K === 0) return [];
  if (K === 1) return [0];

  // pi_i = exp(strength_i); start uniform.
  let pi = new Array(K).fill(1);

  // Row sums W_i = total wins by i.
  const W = winsMatrix.map((row) => row.reduce((a, b) => a + b, 0));
  // Pairwise total games N_ij = wins_ij + wins_ji.
  const N: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      N[i][j] = winsMatrix[i][j] + winsMatrix[j][i];
    }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const newPi = new Array(K).fill(0);
    for (let i = 0; i < K; i++) {
      let denom = 0;
      for (let j = 0; j < K; j++) {
        if (i === j || N[i][j] === 0) continue;
        denom += N[i][j] / (pi[i] + pi[j]);
      }
      newPi[i] = denom > 0 ? W[i] / denom : pi[i];
    }
    // Normalize so geometric mean = 1 (identifiability).
    const logMean =
      newPi.reduce((s, v) => s + Math.log(Math.max(v, 1e-12)), 0) / K;
    const scale = Math.exp(-logMean);
    for (let i = 0; i < K; i++) newPi[i] *= scale;

    let delta = 0;
    for (let i = 0; i < K; i++) delta = Math.max(delta, Math.abs(newPi[i] - pi[i]));
    pi = newPi;
    if (delta < tol) break;
  }

  return pi.map((v) => Math.log(Math.max(v, 1e-12)));
}

/** Softmax with numerical stability. */
export function softmax(xs: number[]): number[] {
  if (xs.length === 0) return [];
  const max = Math.max(...xs);
  const exps = xs.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/**
 * Turn a preference-probability matrix and per-cell judgment counts into a
 * full RankingResult. `prefMatrix[i][j]` = Pr(i > j) in [0,1].
 * `countsMatrix[i][j]` = number of judgments contributing to that cell.
 */
export function buildRanking(
  prefMatrix: number[][],
  countsMatrix: number[][],
): RankingResult {
  const K = prefMatrix.length;
  // Reconstruct fractional "wins" as p_ij * n_ij so BT sees calibrated evidence.
  const wins: number[][] = Array.from({ length: K }, () => new Array(K).fill(0));
  let totalJudgments = 0;
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < K; j++) {
      if (i === j) continue;
      wins[i][j] = prefMatrix[i][j] * countsMatrix[i][j];
      totalJudgments += countsMatrix[i][j];
    }
  }
  const strengths = fitBradleyTerry(wins);
  const probs = softmax(strengths);

  // Off-diagonal entropy average.
  let entSum = 0;
  let entCount = 0;
  for (let i = 0; i < K; i++) {
    for (let j = i + 1; j < K; j++) {
      entSum += binaryEntropy(prefMatrix[i][j]);
      entCount++;
    }
  }
  const entropyAvg = entCount > 0 ? entSum / entCount : 0;

  const ranking: RankedVariant[] = strengths.map((s, i) => {
    let winSum = 0;
    let count = 0;
    for (let j = 0; j < K; j++) {
      if (i === j) continue;
      winSum += prefMatrix[i][j];
      count++;
    }
    return {
      index: i,
      strength: s,
      probBest: probs[i],
      avgWinProb: count > 0 ? winSum / count : 0.5,
      judgmentCount: countsMatrix[i].reduce((a, b) => a + b, 0),
    };
  });
  ranking.sort((a, b) => b.probBest - a.probBest);

  const topConfidence = ranking[0]?.probBest ?? 1 / Math.max(K, 1);
  const topMargin =
    ranking.length >= 2 ? ranking[0].probBest - ranking[1].probBest : topConfidence;

  return {
    ranking,
    preferenceMatrix: prefMatrix,
    topConfidence,
    topMargin,
    entropyAvg,
    totalJudgments,
  };
}
