export interface AutoStopOptions {
  /** Seconds of quiet after the last note before stopping. */
  silenceS?: number;
  /** Hard limit in seconds. */
  maxS?: number;
  /** How far above the ambient level (dB) counts as a note. */
  riseDb?: number;
}

const DEFAULT_SILENCE_S = 1.5;
const DEFAULT_MAX_S = 15;
const DEFAULT_RISE_DB = 12;
const AMBIENT_PERCENTILE = 0.2;

/**
 * Decides when a recording should end: `silenceS` of quiet after at least one note,
 * or `maxS` regardless. Pure logic, fed one level reading at a time.
 */
export class AutoStop {
  private readonly silenceS: number;
  private readonly maxS: number;
  private readonly riseDb: number;
  /** Every level seen so far, kept sorted so the ambient percentile is cheap to read. */
  private readonly sortedLevels: number[] = [];
  private noteSeen = false;
  private quietSinceS: number | null = null;

  constructor(opts: AutoStopOptions = {}) {
    this.silenceS = opts.silenceS ?? DEFAULT_SILENCE_S;
    this.maxS = opts.maxS ?? DEFAULT_MAX_S;
    this.riseDb = opts.riseDb ?? DEFAULT_RISE_DB;
  }

  /** Feed the latest level (dB) at time `tS` (seconds). Returns true when recording should stop. */
  update(levelDb: number, tS: number): boolean {
    this.insertSorted(levelDb);
    if (tS >= this.maxS) return true;

    const noteThreshold = this.ambientDb() + this.riseDb;
    if (levelDb >= noteThreshold) {
      this.noteSeen = true;
      this.quietSinceS = null;
      return false;
    }
    if (!this.noteSeen) return false;

    this.quietSinceS ??= tS;
    return tS - this.quietSinceS >= this.silenceS;
  }

  private ambientDb(): number {
    const index = Math.floor(AMBIENT_PERCENTILE * (this.sortedLevels.length - 1));
    return this.sortedLevels[index];
  }

  private insertSorted(levelDb: number): void {
    let low = 0;
    let high = this.sortedLevels.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.sortedLevels[mid] < levelDb) low = mid + 1;
      else high = mid;
    }
    this.sortedLevels.splice(low, 0, levelDb);
  }
}
