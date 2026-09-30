/**
 * Gompertz mortality: hazard h(x) = exp((x - m) / b) / b, with modal age m and dispersion b.
 * A dispersion of ~9.5 years matches the shape of US period life tables well at older ages.
 */
export const GOMPERTZ_DISPERSION = 9.5;

/** Probability of surviving from age x0 to x0 + t. */
function survival(x0: number, t: number, m: number, b: number): number {
  return Math.exp(-Math.exp((x0 - m) / b) * (Math.exp(t / b) - 1));
}

/** Expected age at death for someone alive at `x0`. */
export function expectedDeathAge(x0: number, m: number, b = GOMPERTZ_DISPERSION): number {
  const dt = 0.25;
  let area = 0;
  for (let t = 0; t < 90; t += dt) {
    const s = survival(x0, t + dt / 2, m, b);
    area += s * dt;
    if (s < 1e-9) break;
  }
  return x0 + area;
}

/**
 * Find the modal age that makes the conditional life expectancy at `currentAge` equal to
 * `lifeExpectancy`, so the user can think in terms of "expected age at death".
 */
export function solveModalAge(currentAge: number, lifeExpectancy: number, b = GOMPERTZ_DISPERSION): number {
  const target = Math.max(lifeExpectancy, currentAge + 0.5);
  let lo = 20;
  let hi = 140;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (expectedDeathAge(currentAge, mid, b) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Inverse-CDF sample of age at death given alive at `x0`; `u` is uniform in (0, 1). */
export function sampleDeathAge(x0: number, m: number, u: number, b = GOMPERTZ_DISPERSION): number {
  return x0 + b * Math.log(1 - Math.log(u) * Math.exp((m - x0) / b));
}
