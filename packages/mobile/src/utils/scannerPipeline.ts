/**
 * scannerPipeline.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero-allocation barcode scanning consensus pipeline for react-native-vision-camera v4/v5.
 * Hermes-compatible — no ES features beyond ES2019.
 *
 * Architecture (3-Tier):
 *   Tier A  Time-gated frame skip  – 33 ms minimum inter-frame interval at 30 FPS
 *   Tier B  ROI viewport mask      – central 85% width x 140px height band
 *   Tier C  Sliding mode consensus – 3-element window, ≥2/3 majority (66.6%)
 */

// ── Constants ────────────────────────────────────────────────────────────────
export const FRAME_INTERVAL_MS = 33 as const;     // 1000 ms / 30 FPS
export const BUDGET_WINDOW_SIZE = 3 as const;     // Reduced window for instant recognition
export const MAJORITY_THRESHOLD = 2 as const;     // 2 out of 3 majority = 66.6%

export const VIEWPORT_WIDTH_PCT = 0.85 as const;  // 85% screen width
export const VIEWPORT_HEIGHT_PX = 140 as const;   // 140px fixed height

// Static zero-allocation buffers for Levenshtein DP calculation
const LEV_PREV_BUFFER: number[] = new Array(128).fill(0);
const LEV_CURR_BUFFER: number[] = new Array(128).fill(0);

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
 * Fast-path O(1) for exact match, O(N) zero-allocation for same length.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;

  const la = a.length;
  const lb = b.length;

  if (Math.abs(la - lb) > 1) {
    // Length difference guarantees distance > 1; skip full DP
    return Math.max(la, lb) + 1;
  }

  if (la === 0) return lb;
  if (lb === 0) return la;

  // Single-pass mismatch counter for equal-length strings (zero allocations)
  if (la === lb) {
    let diff = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diff++;
        if (diff > 1) break;
      }
    }
    if (diff <= 1) return diff;
  }

  // Rolling DP with static reusable buffers (zero allocations for strings <= 128 chars)
  const prev = LEV_PREV_BUFFER.length > lb ? LEV_PREV_BUFFER : new Array<number>(lb + 1);
  const curr = LEV_CURR_BUFFER.length > lb ? LEV_CURR_BUFFER : new Array<number>(lb + 1);

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
    for (let j = 0; j <= lb; j++) {
      prev[j] = curr[j];
    }
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

  // 1. Nitro BarcodeSpec / MLKit Rect (left, right, top, bottom)
  if (code.boundingBox) {
    const box = code.boundingBox;
    const left = typeof box.left === 'number' ? box.left : box.x;
    const top = typeof box.top === 'number' ? box.top : box.y;
    const right = typeof box.right === 'number' ? box.right : (typeof box.x === 'number' && typeof box.width === 'number' ? box.x + box.width : left);
    const bottom = typeof box.bottom === 'number' ? box.bottom : (typeof box.y === 'number' && typeof box.height === 'number' ? box.y + box.height : top);
    if (typeof left === 'number' && typeof right === 'number' && typeof top === 'number' && typeof bottom === 'number') {
      return {
        left: Math.min(left, right),
        right: Math.max(left, right),
        top: Math.min(top, bottom),
        bottom: Math.max(top, bottom),
      };
    }
  }

  // 2. Corner points array
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

  // 3. VisionCamera v3/v4 bounds
  if (code.bounds) {
    const b = code.bounds;
    if (typeof b.minX === 'number' && typeof b.maxX === 'number' && typeof b.minY === 'number' && typeof b.maxY === 'number') {
      return {
        left: Math.min(b.minX, b.maxX),
        right: Math.max(b.minX, b.maxX),
        top: Math.min(b.minY, b.maxY),
        bottom: Math.max(b.minY, b.maxY),
      };
    }
  }

  // 4. Frame object
  if (code.frame) {
    const f = code.frame;
    if (typeof f.x === 'number' && typeof f.width === 'number' && typeof f.y === 'number' && typeof f.height === 'number') {
      return { left: f.x, right: f.x + f.width, top: f.y, bottom: f.y + f.height };
    }
  }

  return null;
}

/**
 * Converts raw barcode bounding box coordinates into screen-space coordinates.
 */
export function computeScreenRect(
  rawRect: RectBounds,
  screenDim: Dimensions,
  frameDim: Dimensions = { width: 720, height: 1280 }
): RectBounds {
  // 1. Normalized (0..1) coordinates
  if (rawRect.right <= 1.0 && rawRect.bottom <= 1.0 && rawRect.left >= 0 && rawRect.top >= 0) {
    return {
      left: rawRect.left * screenDim.width,
      right: rawRect.right * screenDim.width,
      top: rawRect.top * screenDim.height,
      bottom: rawRect.bottom * screenDim.height,
    };
  }

  // 2. Pixel coordinates
  // Detect landscape camera frame orientation (width > height, e.g. 1280x720)
  const isLandscapeFrame = frameDim.width > frameDim.height || (rawRect.right > 720 && rawRect.right > rawRect.bottom);

  if (isLandscapeFrame) {
    const frameW = Math.max(1280, frameDim.width, rawRect.right);
    const frameH = Math.max(720, frameDim.height, rawRect.bottom);

    // Landscape sensor frame space mapping to portrait screen:
    // Frame X (0..frameW) maps to screen vertical Y,
    // Frame Y (0..frameH) maps to screen horizontal X.
    const normYMin = rawRect.left / frameW;
    const normYMax = rawRect.right / frameW;
    const normXMin = rawRect.top / frameH;
    const normXMax = rawRect.bottom / frameH;

    return {
      left: normXMin * screenDim.width,
      right: normXMax * screenDim.width,
      top: normYMin * screenDim.height,
      bottom: normYMax * screenDim.height,
    };
  }

  // Portrait frame or screen space
  let frameW = frameDim.width;
  let frameH = frameDim.height;
  if (rawRect.right <= screenDim.width && rawRect.bottom <= screenDim.height && frameDim.width === screenDim.width) {
    frameW = screenDim.width;
    frameH = screenDim.height;
  } else {
    frameW = Math.max(frameDim.width, rawRect.right);
    frameH = Math.max(frameDim.height, rawRect.bottom);
  }

  return frameToScreenRect(rawRect, { width: frameW, height: frameH }, screenDim);
}

/**
 * Evaluates whether a barcode falls within the defined Region of Interest (ROI) rectangle.
 */
export function isInROI(
  code: any,
  screenDim: Dimensions,
  frameDim: Dimensions = { width: 720, height: 1280 },
  customRoiRect?: RectBounds,
  containmentMode: 'center' | 'full' | 'overlap' = 'center',
  paddingPx: number = 8
): boolean {
  if (!code) return false;

  const rawRect = extractBarcodeRect(code);
  if (!rawRect) return false; // Require valid bounding coordinates for ROI check

  const roiRect = customRoiRect ?? getScreenRoiRect(screenDim.width, screenDim.height);

  const paddedRoiRect: RectBounds = {
    left: roiRect.left - paddingPx,
    top: roiRect.top - paddingPx,
    right: roiRect.right + paddingPx,
    bottom: roiRect.bottom + paddingPx,
  };

  const screenRect = computeScreenRect(rawRect, screenDim, frameDim);

  if (containmentMode === 'center') {
    const midX = (screenRect.left + screenRect.right) / 2;
    const midY = (screenRect.top + screenRect.bottom) / 2;
    return (
      midX >= paddedRoiRect.left &&
      midX <= paddedRoiRect.right &&
      midY >= paddedRoiRect.top &&
      midY <= paddedRoiRect.bottom
    );
  }

  if (containmentMode === 'full') {
    return (
      screenRect.left >= paddedRoiRect.left &&
      screenRect.right <= paddedRoiRect.right &&
      screenRect.top >= paddedRoiRect.top &&
      screenRect.bottom <= paddedRoiRect.bottom
    );
  }

  if (containmentMode === 'overlap') {
    return !(
      screenRect.right < paddedRoiRect.left ||
      screenRect.left > paddedRoiRect.right ||
      screenRect.bottom < paddedRoiRect.top ||
      screenRect.top > paddedRoiRect.bottom
    );
  }

  return true;
}

/**
 * Given an array of detected barcode objects from camera frame,
 * filters for barcodes inside ROI and selects the one closest to the center of the ROI viewfinder.
 */
export function selectBestRoiBarcode(
  codes: any[],
  screenDim: Dimensions,
  frameDim: Dimensions = { width: 720, height: 1280 },
  customRoiRect?: RectBounds
): any | null {
  if (!codes || codes.length === 0) return null;

  const roiRect = customRoiRect ?? getScreenRoiRect(screenDim.width, screenDim.height);
  const roiCenterX = (roiRect.left + roiRect.right) / 2;
  const roiCenterY = (roiRect.top + roiRect.bottom) / 2;

  let bestCode = null;
  let minDistanceSq = Infinity;

  for (const code of codes) {
    if (!isInROI(code, screenDim, frameDim, roiRect)) continue;

    const rawRect = extractBarcodeRect(code);
    if (!rawRect) {
      if (!bestCode) bestCode = code;
      continue;
    }

    const screenRect = computeScreenRect(rawRect, screenDim, frameDim);

    const codeCenterX = (screenRect.left + screenRect.right) / 2;
    const codeCenterY = (screenRect.top + screenRect.bottom) / 2;

    const distSq = (codeCenterX - roiCenterX) ** 2 + (codeCenterY - roiCenterY) ** 2;

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      bestCode = code;
    }
  }

  return bestCode;
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
  } else {
    // String mismatch or item shift — re-seed window with new candidate
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

