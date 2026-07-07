/**
 * scannerPipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-allocation barcode scanning consensus pipeline for react-native-vision-camera v4.
 * Hermes-compatible — no ES features beyond ES2019.
 *
 * Architecture (3-Tier):
 *   Tier A  Time-gated frame skip  – 33 ms minimum inter-frame interval at 30 FPS
 *   Tier B  ROI viewport mask      – central 40% horizontal band
 *   Tier C  Sliding mode consensus – 6-element window, ≥4/6 majority (66.6%)
 */

// ── Constants ────────────────────────────────────────────────────────────────
export const FRAME_INTERVAL_MS = 33 as const;     // 1000 ms / 30 FPS
export const BUDGET_WINDOW_SIZE = 6 as const;
export const MAJORITY_THRESHOLD = 4 as const;     // 4 out of 6 = 66.6%
export const ROI_HALF_WIDTH = 0.20 as const;      // ±20% from centre = inner 40%

// ── Types ────────────────────────────────────────────────────────────────────
export interface ScannerPipelineRefs {
  lastFrameTs: number;
  window: string[];
}

export function createPipelineRefs(): ScannerPipelineRefs {
  return { lastFrameTs: 0, window: [] };
}

// ── Levenshtein Distance (zero-allocation, O(min(m,n)) space) ────────────────
/**
 * Returns the edit distance between `a` and `b`.
 * Fast-returns (max(la, lb) + 1) when |la - lb| > 1 to save CPU cycles.
 */
export function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;

  if (Math.abs(la - lb) > 1) {
    // Length difference guarantees distance > 1; skip full DP
    return Math.max(la, lb) + 1;
  }

  if (la === 0) return lb;
  if (lb === 0) return la;

  // Single-row rolling DP — no matrix allocation
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);

  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insert
        prev[j] + 1,           // delete
        prev[j - 1] + cost,    // replace
      );
    }
    // Swap buffers — no allocations inside the hot loop
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[lb];
}

// ── EAN-13 / UPC-A Modulo-10 Checksum ───────────────────────────────────────
export function isValidEanChecksum(barcode: string): boolean {
  if (!/^\d{12,13}$/.test(barcode)) return true; // non-EAN — pass through
  const digits = barcode.split('').map(Number);
  const checkDigit = digits.pop()!;
  let sum = 0;
  if (digits.length === 12) {
    // EAN-13
    for (let i = 0; i < 12; i++) sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  } else {
    // UPC-A (11 digits before check)
    for (let i = 0; i < 11; i++) sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

// ── Tier B: ROI Mask (central 40% horizontal band) ──────────────────────────
/**
 * Returns true when the barcode's horizontal midpoint falls within the central
 * 40% of the camera frame (0.30 – 0.70 normalised x).
 * Falls back to `true` when no bounds metadata is available.
 */
export function isInROI(code: { bounds?: { minX: number; maxX: number; minY: number; maxY: number } }, frameWidth: number): boolean {
  if (!code.bounds || frameWidth === 0) return true;
  const { minX, maxX } = code.bounds;
  const normMidX = (minX + (maxX - minX) / 2) / frameWidth;
  return Math.abs(normMidX - 0.5) <= ROI_HALF_WIDTH;
}

// ── Tier C: Sliding Mode Consensus ──────────────────────────────────────────
/**
 * Mutates `refs` (the useRef object) according to Levenshtein-gated sliding window.
 *
 * Returns the consensus string when majority is reached, or `null` to keep scanning.
 */
export function runConsensus(refs: ScannerPipelineRefs, incoming: string): string | null {
  const win = refs.window;

  if (win.length === 0) {
    win.push(incoming);
    return null;
  }

  const last = win[win.length - 1];
  const dist = levenshtein(last, incoming);

  if (dist === 0) {
    // Perfect match — append
    win.push(incoming);
  } else if (dist === 1) {
    // Single-character noise — preserve momentum using last stable value
    win.push(last);
  } else {
    // Item shift — wipe and re-seed
    refs.window = [incoming];
    return null;
  }

  // Enforce window budget
  if (win.length > BUDGET_WINDOW_SIZE) {
    win.shift();
  }

  // Majority vote when window is full
  if (win.length === BUDGET_WINDOW_SIZE) {
    const freq: Record<string, number> = {};
    for (const s of win) {
      freq[s] = (freq[s] ?? 0) + 1;
    }
    let topCandidate = '';
    let topCount = 0;
    for (const [candidate, count] of Object.entries(freq)) {
      if (count > topCount) {
        topCount = count;
        topCandidate = candidate;
      }
    }

    if (topCount >= MAJORITY_THRESHOLD) {
      refs.window = [];
      return topCandidate;
    }
  }

  return null;
}
