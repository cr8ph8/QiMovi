// Independent implementation of the public Black–Scholes–Merton formula.
// Formula and continuous-yield convention: Bates, Testing Option Pricing Models,
// pp. 8 and 16: https://www.biz.uiowa.edu/faculty/dbates/papers/survey.pdf
// Theoretical premiums are not executable market prices:
// https://www.optionseducation.org/advancedconcepts/black-scholes-formula
// No quotes, asset appraisal, rights verification, minting or trading occurs here.

export const ASSET_OPTION_MODEL = 'BLACK_SCHOLES_MERTON';
export const ASSET_OPTION_INPUT_FIELDS = Object.freeze([
  'optionType', 'underlyingDescription', 'currency', 'underlyingReferenceValue',
  'strikePrice', 'timeToExpiryYears', 'annualRiskFreeRate', 'annualVolatility', 'annualYield',
]);
const numericFields = ASSET_OPTION_INPUT_FIELDS.slice(3);
const assumptions = Object.freeze([
  'Values a hypothetical European option on the specifically described asset or right, exercisable only at expiry.',
  'The underlying reference value and strike use the same currency and the same quantity of the described right.',
  'Time is measured in years; rates, volatility and yield are annual decimal inputs. Rates and yield compound continuously.',
  'Assumes constant volatility, interest rate and continuous yield, and a lognormal underlying value process.',
  'The replication model assumes continuous trading and frictionless borrowing, lending and hedging. These conditions are not established for this asset.',
  'Excludes early exercise, discrete distributions, taxes, fees, liquidity, execution and legal or ownership verification.',
  'This is not an NFT spot price, an appraisal, a forecast, a sale guarantee or evidence that a market or transferable right exists.',
]);

// Phi(-|x|) = Q(1/2, x²/2)/2. Evaluate the upper gamma tail directly
// away from zero, avoiding loss of the negative tail from 1 - Phi(|x|).
// The gamma series and continued fraction are standard mathematical identities;
// see https://dlmf.nist.gov/8.7 and https://dlmf.nist.gov/8.25 .
function normalCdf(x) {
  if (x === 0) return 0.5;
  if (x <= -39) return 0;
  if (x >= 39) return 1;
  if (!Number.isFinite(x)) return NaN;
  const z = x * x / 2, factor = Math.exp(-z + 0.5 * Math.log(z) - Math.log(Math.PI) / 2);
  let tail;
  if (z < 1.5) {
    let term = 2, sum = term;
    for (let n = 1; n <= 256; n++) {
      term *= z / (n + 0.5); sum += term;
      if (Math.abs(term) <= Math.abs(sum) * Number.EPSILON) break;
    }
    tail = (1 - factor * sum) / 2;
  } else {
    const floor = 1e-300;
    let denominator = z + 0.5, c = 1 / floor, d = 1 / denominator, fraction = d;
    for (let n = 1; n <= 256; n++) {
      const numerator = -n * (n - 0.5); denominator += 2;
      d = denominator + numerator * d; if (Math.abs(d) < floor) d = floor;
      c = denominator + numerator / c; if (Math.abs(c) < floor) c = floor;
      d = 1 / d; const ratio = d * c; fraction *= ratio;
      if (Math.abs(ratio - 1) <= 4 * Number.EPSILON) break;
    }
    tail = factor * fraction / 2;
  }
  tail = Math.max(0, Math.min(0.5, tail));
  return x < 0 ? tail : 1 - tail;
}

function price(inputs) {
  const { optionType, underlyingReferenceValue: S, strikePrice: K, timeToExpiryYears: T,
    annualRiskFreeRate: r, annualVolatility: sigma, annualYield: q } = inputs;
  const call = optionType === 'CALL';
  if (T === 0) return { value: Math.max(call ? S - K : K - S, 0), method: 'EXPIRY_PAYOFF' };
  const rateTime = r * T, yieldTime = q * T, spread = sigma * Math.sqrt(T);
  if (![rateTime, yieldTime, spread].every(Number.isFinite)) return null;
  const discountedUnderlying = S === 0 ? 0 : S * Math.exp(-yieldTime);
  const discountedStrike = K === 0 ? 0 : K * Math.exp(-rateTime);
  if (![discountedUnderlying, discountedStrike].every(Number.isFinite)) return null;
  const difference = discountedUnderlying - discountedStrike;
  if (sigma === 0 || spread === 0 || discountedUnderlying === 0 || discountedStrike === 0) {
    return { value: Math.max(call ? difference : -difference, 0), method: sigma === 0 || spread === 0 ? 'ZERO_VOLATILITY_LIMIT' : 'ZERO_VALUE_LIMIT' };
  }
  // Work in discounted prices to avoid overflow in the forward price or S/K.
  const logMoneyness = Math.log(discountedUnderlying) - Math.log(discountedStrike);
  const d1 = logMoneyness / spread + spread / 2, d2 = logMoneyness / spread - spread / 2;
  let callValue, putValue;
  // Compute the out-of-the-money side directly; use parity for the other side.
  if (difference <= 0) {
    callValue = Math.max(0, discountedUnderlying * normalCdf(d1) - discountedStrike * normalCdf(d2));
    putValue = callValue - difference;
  } else {
    putValue = Math.max(0, discountedStrike * normalCdf(-d2) - discountedUnderlying * normalCdf(-d1));
    callValue = putValue + difference;
  }
  const value = call ? callValue : putValue;
  if (!Number.isFinite(value)) return null;
  return { value: Math.min(call ? discountedUnderlying : discountedStrike, value), method: 'BLACK_SCHOLES_MERTON' };
}

/**
 * Pure per-described-right scenario, with no contract multiplier or defaults.
 * Missing values remain insufficient data; numeric strings are not coerced.
 * Explicit zero S/K, expiry and volatility use their mathematical limits.
 * Negative finite rates/yields are supported; negative S/K/time/volatility fail.
 */
export function evaluateAssetOptionScenario(input) {
  const result = { schemaVersion: 1, model: ASSET_OPTION_MODEL, hypothetical: true,
    label: 'Hypothetical European option value', theoreticalValue: null, assumptions: [...assumptions] };
  if (input === undefined || input === null) return { ...result, status: 'INSUFFICIENT_DATA', missingFields: [...ASSET_OPTION_INPUT_FIELDS], errors: [] };
  if (typeof input !== 'object' || Array.isArray(input)) return { ...result, status: 'INVALID_INPUT', missingFields: [], errors: [{ field: 'input', code: 'OBJECT_REQUIRED' }] };
  const missingFields = ASSET_OPTION_INPUT_FIELDS.filter(field => !Object.hasOwn(input, field) || input[field] === null || input[field] === undefined || typeof input[field] === 'string' && !input[field].trim());
  const errors = [];
  const present = field => !missingFields.includes(field);
  if (present('optionType') && !['CALL', 'PUT'].includes(input.optionType)) errors.push({ field: 'optionType', code: 'CALL_OR_PUT_REQUIRED' });
  for (const [field, maximum] of [['underlyingDescription', 2000], ['currency', 32]]) {
    if (present(field) && (typeof input[field] !== 'string' || input[field].length > maximum || !input[field].isWellFormed() || /[\x00-\x1f\x7f]/.test(input[field]))) errors.push({ field, code: 'BOUNDED_TEXT_REQUIRED' });
  }
  for (const field of numericFields) {
    if (present(field) && !Number.isFinite(input[field])) errors.push({ field, code: 'FINITE_NUMBER_REQUIRED' });
  }
  for (const field of ['underlyingReferenceValue', 'strikePrice', 'timeToExpiryYears', 'annualVolatility']) {
    if (present(field) && Number.isFinite(input[field]) && input[field] < 0) errors.push({ field, code: 'NONNEGATIVE_NUMBER_REQUIRED' });
  }
  if (errors.length) return { ...result, status: 'INVALID_INPUT', missingFields, errors };
  if (missingFields.length) return { ...result, status: 'INSUFFICIENT_DATA', missingFields, errors: [] };
  const inputs = Object.fromEntries(ASSET_OPTION_INPUT_FIELDS.map(field => [field, input[field]]));
  const calculation = price(inputs);
  if (!calculation) return { ...result, status: 'INVALID_INPUT', missingFields: [], errors: [{ field: 'inputs', code: 'NUMERICAL_RANGE_EXCEEDED' }] };
  return { ...result, status: 'CALCULATED', theoreticalValue: calculation.value, currency: inputs.currency,
    method: calculation.method, inputs, missingFields: [], errors: [] };
}
