// ============================================================
// ASTRONOMY — SIMULATION CLOCK (single authoritative time source)
// ============================================================
// EVERY body's orbital position is a pure function of this one clock's
// `epochDays`. There are no per-planet animation timers. Switching the clock
// switches every body consistently — inner bodies are always faster than
// outer bodies because they have shorter periods (Kepler's third law), not
// because we assigned them convenient angular velocities.
//
//   • paused    -> time frozen (rate 0)
//   • realtime  -> true sidereal rate (1 day per 86400 s)
//   • visualized-> accelerated: a user-chosen days-per-real-second (presets)
//
// `epochDays` is days since J2000.0 — the same epoch the orbital elements use.
// ============================================================

export type SimTimeMode = 'paused' | 'realtime' | 'visualized';

export interface SpeedPreset {
  id: string;
  label: string;
  /** Days of simulated time advanced per real second. */
  daysPerSecond: number;
}

/** Curated acceleration presets ("Visualized" time). */
export const SPEED_PRESETS: readonly SpeedPreset[] = [
  { id: 'realtime', label: 'Real time', daysPerSecond: 1 / 86400 },
  { id: '1day', label: '1 day / s', daysPerSecond: 1 },
  { id: '1week', label: '1 week / s', daysPerSecond: 7 },
  { id: '1month', label: '1 month / s', daysPerSecond: 30.44 },
  { id: '1year', label: '1 year / s', daysPerSecond: 365.25 },
] as const;

export const J2000_REALTIME_RATE = 1 / 86400; // days per second at true rate

/**
 * The one simulation clock. Framework-agnostic and pure so it is trivial to
 * unit-test: advancing it by a real delta of time deterministically advances
 * `epochDays` by `delta · rate(mode, preset)`.
 */
export class SimulationClock {
  /** Current epoch: days since J2000.0. */
  epochDays = 0;
  mode: SimTimeMode = 'visualized';
  /** Active "visualized" rate (days/real-second) when mode === 'visualized'. */
  visualizedDaysPerSecond = 1;

  constructor(options?: {
    epochDays?: number;
    mode?: SimTimeMode;
    daysPerSecond?: number;
  }) {
    if (options) {
      this.epochDays = options.epochDays ?? this.epochDays;
      this.mode = options.mode ?? this.mode;
      this.visualizedDaysPerSecond = options.daysPerSecond ?? this.visualizedDaysPerSecond;
    }
  }

  /** Simulated seconds-per-real-second (rate) for the current mode. */
  getDaysPerSecond(): number {
    if (this.mode === 'paused') return 0;
    if (this.mode === 'realtime') return J2000_REALTIME_RATE;
    return this.visualizedDaysPerSecond;
  }

  /** Advance the clock by a real-time delta (seconds). */
  advance(realDeltaSeconds: number): void {
    if (!isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return;
    this.epochDays += realDeltaSeconds * this.getDaysPerSecond();
  }

  setMode(mode: SimTimeMode): void {
    this.mode = mode;
  }

  setVisualizedRate(daysPerSecond: number): void {
    this.visualizedDaysPerSecond = Math.max(0, daysPerSecond);
  }

  /** Apply a curated preset (realtime stays in realtime mode; others visualized). */
  applyPreset(preset: SpeedPreset): void {
    if (preset.id === 'realtime') {
      this.mode = 'realtime';
    } else {
      this.mode = 'visualized';
      this.visualizedDaysPerSecond = preset.daysPerSecond;
    }
  }

  reset(daysSinceJ2000 = 0): void {
    this.epochDays = daysSinceJ2000;
  }
}
