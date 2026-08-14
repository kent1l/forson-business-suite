/**
 * Version comparison for the forced-update gate.
 *
 * The gate used to block on any difference between the installed version and
 * the server's `mobile_app_version`. That is wrong in one direction: a build
 * NEWER than the server setting is not out of date, it is ahead — which is the
 * normal state of a development or preview build, and of the maintainer's
 * device between cutting a release and publishing it. Those builds were locked
 * out of the app entirely, before login, with no way through.
 *
 * Only a server version strictly greater than the installed one should force an
 * update.
 */

const parse = (raw: string): number[] | null => {
  const cleaned = String(raw ?? '').trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(cleaned)) return null;
  return cleaned.split('.').map(Number);
};

/**
 * -1 when a < b, 0 when equal, 1 when a > b.
 * Returns null when either side is not a plain numeric version.
 */
export const compareVersions = (a: string, b: string): number | null => {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;

  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    // Missing segments are zero, so 2.1 and 2.1.0 compare equal.
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
};

/**
 * Whether the installed build must be replaced before the app may be used.
 *
 * Falls back to the old exact-mismatch behaviour when either version is not
 * plain numeric. That keeps the setting usable as a deliberate kill switch —
 * an admin who types something non-numeric still stops every client — rather
 * than silently letting an unparseable value disable the gate.
 */
export const isUpdateRequired = (installed: string, serverLatest: string): boolean => {
  if (!serverLatest) return false;

  const comparison = compareVersions(serverLatest, installed);
  if (comparison === null) return serverLatest !== installed;
  return comparison > 0;
};

export default isUpdateRequired;
