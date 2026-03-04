export type JitterOptions = {
 seed: number;
 daysPerPeriod: number;
 /** Noise fraction of the current value (e.g. `0.03` =3%) */
 volatility: number;
 /**0..1 (higher = smoother / more correlated day-to-day). */
 smoothness: number;
 /**0..1 (higher = stronger pull back to the interpolated trend). */
 meanReversion: number;
 /**0..1 (weekly seasonality strength). */
 weeklySeasonality: number;
};

function mulberry32(seed: number) {
 let a = seed |0;
 return () => {
 a |=0;
 a = (a +0x6d2b79f5) |0;
 let t = Math.imul(a ^ (a >>>15),1 | a);
 t ^= t + Math.imul(t ^ (t >>>7),61 | t);
 return ((t ^ (t >>>14)) >>>0) /4294967296;
 };
}

function lerp(a: number, b: number, t: number) {
 return a + (b - a) * t;
}

function smoothstep(t: number) {
 return t * t * (3 -2 * t);
}

/** Deterministic1D value noise in `[-1,1]`, smoothly interpolated. */
function valueNoise1D(x: number, rand: () => number) {
 const x0 = Math.floor(x);
 const x1 = x0 +1;

 // Derive pseudo-random values at lattice points based on x0/x1.
 const r0 = fracHash(x0, rand) *2 -1;
 const r1 = fracHash(x1, rand) *2 -1;

 const t = smoothstep(x - x0);
 return lerp(r0, r1, t);
}

function fracHash(i: number, rand: () => number) {
 // Stable-ish hash: mix i into a temporary stream.
 // (Avoids allocating a new RNG; determinism comes from stepping rand consistently.)
 const a = (i *2654435761) >>>0;
 const b = ((a ^0x9e3779b9) >>>0) /0xffffffff;
 return (b + rand() *0.5) %1;
}

function clamp(n: number, min: number, max: number) {
 return Math.max(min, Math.min(max, n));
}

/**
 * Upsample period values into daily values with interpolated trend + correlated noise + weekly seasonality.
 *
 * - Trend: smooth interpolation between period endpoints.
 * - Noise: correlated component that mean-reverts toward the trend.
 * - Seasonality: weekly sinusoid with a deterministic random phase.
 */
export function upsampleDailyWithJitter(periodValues: number[], options: JitterOptions): number[] {
 const values = (periodValues ?? []).map((v) => (Number.isFinite(v) ? Number(v) :0));
 if (values.length <2) return values;

 const { seed, daysPerPeriod, volatility, smoothness, meanReversion, weeklySeasonality } = options;
 const rand = mulberry32(seed);

 const out: number[] = [];

 // Per-series phase and amplitude tweaks for seasonality.
 const weeklyPhase = rand() * Math.PI *2;
 const weeklyAmp = weeklySeasonality * (0.6 + rand() *0.8); //0.6..1.4

 // Correlated noise state.
 let noiseState =0;
 const corr = clamp(smoothness,0,1);
 const mr = clamp(meanReversion,0,1);

 // Map smoothness to an AR coefficient (close to1 = smoother).
 const ar = lerp(0.2,0.92, corr);

 for (let p =0; p < values.length -1; p++) {
 const a = values[p];
 const b = values[p +1];

 for (let d =0; d < daysPerPeriod; d++) {
 const t0 = d / daysPerPeriod;
 const t = smoothstep(t0);
 const trend = lerp(a, b, t);

 // White-ish input blended with value noise (deterministic, smooth).
 const eps = (rand() *2 -1) *0.65 + valueNoise1D((p * daysPerPeriod + d) /7, rand) *0.35;

 // Noise magnitude scales with |trend| but never goes to0.
 const baseMag = Math.max(1, Math.abs(trend)) * volatility;
 noiseState = ar * noiseState + (1 - ar) * eps * baseMag;

 // Mean reversion pulls the noise back toward0 over time.
 noiseState *=1 - mr *0.1;

 // Weekly seasonality around trend.
 const weekly =
 Math.sin(((p * daysPerPeriod + d) * (2 * Math.PI)) /7 + weeklyPhase) * weeklyAmp * baseMag;

 out.push(trend + noiseState + weekly);
 }
 }

 // Include last period value as the final point.
 out.push(values[values.length -1]);
 return out;
}
