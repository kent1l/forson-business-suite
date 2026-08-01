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

export const VIEWPORT_WIDTH_PCT = 0.85 as const;  // 85% screen width
export const VIEWPORT_HEIGHT_PX = 140 as const;   // 140px fixed height

// ── Types ────────────────────────────────────────────────────────────────────
export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

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

// ── Tier B: ROI Viewport Filtering & Coordinate Transformation ────────────────

/**
 * Single source of truth for screen-space ROI box bounds (matches viewfinder UI).
 */
export function getScreenRoiRect(
  screenWidth: number,
  screenHeight: number,
  widthPct: number = VIEWPORT_WIDTH_PCT,
  heightPx: number = VIEWPORT_HEIGHT_PX
): RectBounds {
  const width = screenWidth * widthPct;
  const height = heightPx;
  const left = (screenWidth - width) / 2;
  const top = (screenHeight - height) / 2;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

/**
 * Converts frame-space pixel coordinates to screen-space coordinates.
 *
 * Coordinate System Conversion Rationale:
 * Camera preview fills the screen using aspect-fill ('cover') mode.
 * MLKit returns barcode coordinates relative to the input camera frame resolution.
 *
 * We convert frame coordinates (x_f, y_f) to screen coordinates (x_s, y_s) via:
 *   scale = max(screenWidth / frameWidth, screenHeight / frameHeight)
 *   offsetX = (frameWidth * scale - screenWidth) / 2
 *   offsetY = (frameHeight * scale - screenHeight) / 2
 *   x_s = x_f * scale - offsetX
 *   y_s = y_f * scale - offsetY
 */
export function frameToScreenRect(
  frameRect: RectBounds,
  frameDim: Dimensions,
  screenDim: Dimensions
): RectBounds {
  const scale = Math.max(
    screenDim.width / frameDim.width,
    screenDim.height / frameDim.height
  );
  const offsetX = (frameDim.width * scale - screenDim.width) / 2;
  const offsetY = (frameDim.height * scale - screenDim.height) / 2;

  return {
    left: frameRect.left * scale - offsetX,
    right: frameRect.right * scale - offsetX,
    top: frameRect.top * scale - offsetY,
    bottom: frameRect.bottom * scale - offsetY,
  };
}

/**
 * Safely extracts bounding rectangle {left, right, top, bottom} from various barcode object schemas.
 */
export function extractBarcodeRect(code: any): RectBounds | null {
  if (!code) return null;

  // Nitro BarcodeSpec / MLKit Rect (left, right, top, bottom)
  if (code.boundingBox) {
    const box = code.boundingBox;
    const left = typeof box.left === 'number' ? box.left : box.x;
    const top = typeof box.top === 'number' ? box.top : box.y;
    const right = typeof box.right === 'number' ? box.right : (typeof box.x === 'number' && typeof box.width === 'number' ? box.x + box.width : left);
    const bottom = typeof box.bottom === 'number' ? box.bottom : (typeof box.y === 'number' && typeof box.height === 'number' ? box.y + box.height : top);
    if (left !== undefined && right !== undefined && top !== undefined && bottom !== undefined) {
      return { left, top, right, bottom };
    }
  }

  // VisionCamera v3/v4 bounds
  if (code.bounds) {
    const b = code.bounds;
    if (typeof b.minX === 'number' && typeof b.maxX === 'number' && typeof b.minY === 'number' && typeof b.maxY === 'number') {
      return { left: b.minX, right: b.maxX, top: b.minY, bottom: b.maxY };
    }
  }

  // Frame object
  if (code.frame) {
    const f = code.frame;
    if (typeof f.x === 'number' && typeof f.width === 'number' && typeof f.y === 'number' && typeof f.height === 'number') {
      return { left: f.x, right: f.x + f.width, top: f.y, bottom: f.y + f.height };
    }
  }

  // Corner points array
  if (Array.isArray(code.cornerPoints) && code.cornerPoints.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pt of code.cornerPoints) {
      if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }
    if (minX !== Infinity) {
      return { left: minX, right: maxX, top: minY, bottom: maxY };
    }
  }

  return null;
}

/**
 * Evaluates whether a barcode falls within the defined Region of Interest (ROI) rectangle.
 *
 * In-Region Criteria & Assumptions:
 * - Default mode ('center'): Checks if the center point (midX, midY) of the barcode falls strictly inside the ROI rectangle.
 * - 'full' mode: Checks if the entire barcode bounding box is 100% contained within the ROI rectangle.
 * - 'overlap' mode: Checks if any portion of the barcode intersects the ROI rectangle.
 *
 * Using 'center' containment ensures that barcodes positioned mostly outside the viewfinder box are ignored,
 * preventing unintended scans while remaining easy for users to aim.
 */
export function isInROI(
  code: any,
  screenDim: Dimensions,
  frameDim: Dimensions = { width: 720, height: 1280 },
  customRoiRect?: RectBounds,
  containmentMode: 'center' | 'full' | 'overlap' = 'center'
): boolean {
  if (!code) return false;

  const rawRect = extractBarcodeRect(code);
  if (!rawRect) return true; // Pass through if location data missing

  const roiRect = customRoiRect ?? getScreenRoiRect(screenDim.width, screenDim.height);

  let screenRect: RectBounds;
  // Check if rawRect coordinates are normalized (0..1)
  if (rawRect.right <= 1.0 && rawRect.bottom <= 1.0 && rawRect.left >= 0 && rawRect.top >= 0) {
    screenRect = {
      left: rawRect.left * screenDim.width,
      right: rawRect.right * screenDim.width,
      top: rawRect.top * screenDim.height,
      bottom: rawRect.bottom * screenDim.height,
    };
  } else {
    // Transform frame pixel coordinates to screen space using camera aspect-fill ('cover')
    screenRect = frameToScreenRect(rawRect, frameDim, screenDim);
  }

  if (containmentMode === 'center') {
    const midX = (screenRect.left + screenRect.right) / 2;
    const midY = (screenRect.top + screenRect.bottom) / 2;
    return (
      midX >= roiRect.left &&
      midX <= roiRect.right &&
      midY >= roiRect.top &&
      midY <= roiRect.bottom
    );
  }

  if (containmentMode === 'full') {
    return (
      screenRect.left >= roiRect.left &&
      screenRect.right <= roiRect.right &&
      screenRect.top >= roiRect.top &&
      screenRect.bottom <= roiRect.bottom
    );
  }

  if (containmentMode === 'overlap') {
    return !(
      screenRect.right < roiRect.left ||
      screenRect.left > roiRect.right ||
      screenRect.bottom < roiRect.top ||
      screenRect.top > roiRect.bottom
    );
  }

  return true;
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
