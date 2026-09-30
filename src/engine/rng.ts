/**
 * Small, fast, seedable PRNG (sfc32). Seeded runs are reproducible, and every scenario
 * replays the *same* market paths (common random numbers), so differences between
 * scenarios come from the plan choices rather than from luck of the draw.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: number, stream = 0) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88 ^ (seed >>> 0);
    this.c = 0xb7e15162 ^ Math.imul(stream + 1, 0x85ebca6b);
    this.d = (seed * 1000003 + stream) >>> 0;
    for (let i = 0; i < 16; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform in (0, 1) — safe for log(). */
  open(): number {
    let u = this.next();
    while (u === 0) u = this.next();
    return u;
  }

  /** Standard normal via Box–Muller (caches the second value). */
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    const r = Math.sqrt(-2 * Math.log(this.open()));
    const theta = 2 * Math.PI * this.next();
    this.spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  }
}
