// Standardized fitment position shorthand. Canonical order: primary, secondary, tertiary, modifier.
// e.g. "front right lower" -> "FR RH LWR"

export const FITMENT_POSITION_CODES = {
  FR: 'Front', RR: 'Rear', CTR: 'Center', LH: 'Left Hand', RH: 'Right Hand',
  UPR: 'Upper', LWR: 'Lower', INR: 'Inner', OTR: 'Outer', FWD: 'Forward', RWD: 'Rearward',
  B1: 'Bank 1', B2: 'Bank 2', S1: 'Upstream / Sensor 1', S2: 'Downstream / Sensor 2',
  INT: 'Intake', EXH: 'Exhaust', 'NO. 1': 'No. 1', 'NO. 2': 'No. 2',
};

const ALIASES = {
  FR: 'FR', FRT: 'FR', FRONT: 'FR',
  RR: 'RR', REAR: 'RR', BACK: 'RR',
  CTR: 'CTR', CENTER: 'CTR', CENTRE: 'CTR', MID: 'CTR', MIDDLE: 'CTR',
  LH: 'LH', L: 'LH', LEFT: 'LH', DRIVER: 'LH', LHS: 'LH',
  RH: 'RH', R: 'RH', RIGHT: 'RH', PASSENGER: 'RH', RHS: 'RH',
  UPR: 'UPR', UPPER: 'UPR', UP: 'UPR', TOP: 'UPR',
  LWR: 'LWR', LOWER: 'LWR', LOW: 'LWR', BOTTOM: 'LWR',
  INR: 'INR', INNER: 'INR', INBOARD: 'INR',
  OTR: 'OTR', OUTER: 'OTR', OUTBOARD: 'OTR',
  FWD: 'FWD', FORWARD: 'FWD',
  RWD: 'RWD', REARWARD: 'RWD',
  B1: 'B1', BANK1: 'B1', B2: 'B2', BANK2: 'B2',
  UPSTR: 'S1', UPSTREAM: 'S1', S1: 'S1',
  DWNSTR: 'S2', DOWNSTREAM: 'S2', S2: 'S2',
  INT: 'INT', INTAKE: 'INT', EXH: 'EXH', EXHAUST: 'EXH',
};

// Token order: axis (FR/RR/CTR) -> side (LH/RH) -> vertical (UPR/LWR) -> inner/outer -> fwd/rwd -> subsystem.
const RANK = {
  FR: 0, RR: 0, CTR: 0, LH: 1, RH: 1, UPR: 2, LWR: 2, INR: 3, OTR: 3, FWD: 4, RWD: 4,
  B1: 5, B2: 5, S1: 6, S2: 6, INT: 7, EXH: 7,
};

/**
 * Normalize free text to canonical shorthand. Unrecognized text is returned trimmed/unchanged.
 */
export function normalizeFitmentPosition(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const tokens = raw.toUpperCase().replace(/\bNO\.?\s*(\d)\b/g, 'NO.$1').split(/[\s,/&-]+/).filter(Boolean);
  const out = [];
  for (const t of tokens) {
    if (/^NO\.\d+$/.test(t)) { out.push(`NO. ${t.slice(3)}`); continue; }
    const code = ALIASES[t];
    if (!code) return raw;
    if (!out.includes(code)) out.push(code);
  }
  const numbered = out.filter(c => c.startsWith('NO.'));
  const coded = out.filter(c => !c.startsWith('NO.')).sort((a, b) => RANK[a] - RANK[b]);
  return [...coded, ...numbered].join(' ');
}

export const formatFitmentPosition = normalizeFitmentPosition;
