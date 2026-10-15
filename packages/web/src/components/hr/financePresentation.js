export const financeStyles = {
  input: 'w-full min-w-0 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:[color-scheme:dark] px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60',
  button: 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50',
  primary: 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  card: 'min-w-0 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-5 shadow-card',
  muted: 'text-xs leading-relaxed text-gray-500 dark:text-slate-400',
};
export function financeMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return '—';
  return `${match[1]}₱${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(match[3] || '').padEnd(2, '0')}`;
}
export function financeDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(date);
}
const labels = { COMPANY: 'Company', PAGIBIG: 'Pag-IBIG', SSS: 'SSS', SSS_SALARY: 'SSS salary loan', SSS_CALAMITY: 'SSS calamity loan', HDMF_MPL: 'Pag-IBIG multipurpose loan', HDMF_CALAMITY: 'Pag-IBIG calamity loan', CASH_ADVANCE: 'Vale / cash advance', FIRST_CUTOFF: '1st cutoff', SECOND_CUTOFF: '2nd cutoff', SPLIT_HALF: 'Split monthly amount', LEGACY_ACTIVE: 'Imported', ACTIVE: 'Active', DRAFT: 'Draft', CATCH_UP: 'Catch-up', NEEDS_REVIEW: 'Needs review', RECOVERED: 'Recovered', RESERVED: 'Reserved', PROPOSED: 'Proposed' };
export const financeLabel = value => labels[value] || String(value || 'Unknown').toLowerCase().replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
