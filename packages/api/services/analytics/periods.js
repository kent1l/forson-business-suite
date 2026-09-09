const { manilaDateString } = require('../../helpers/manilaDate');

/**
 * Date-range arithmetic, done on plain YYYY-MM-DD strings in the Manila
 * calendar.
 *
 * Everything downstream filters on `(col AT TIME ZONE 'Asia/Manila')::date`, so
 * the ranges have to be Manila calendar dates too. Using Date objects in the
 * server's local zone is how a period quietly gains or loses its first day.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toUtcNoon = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    // Noon, so a daylight-saving shift in any intermediate zone cannot roll the date.
    return new Date(Date.UTC(y, m - 1, d, 12));
};

const toIso = (date) => date.toISOString().slice(0, 10);

const isIsoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const addDays = (iso, days) => toIso(new Date(toUtcNoon(iso).getTime() + days * MS_PER_DAY));

const addMonths = (iso, months) => {
    const d = toUtcNoon(iso);
    const targetMonth = d.getUTCMonth() + months;
    const first = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1, 12));
    // Clamp: one month before 31 March is 28/29 February, not 3 March.
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
    return toIso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), lastDay), 12)));
};

const daysBetweenInclusive = (from, to) =>
    Math.round((toUtcNoon(to) - toUtcNoon(from)) / MS_PER_DAY) + 1;

const today = () => manilaDateString();

const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const endOfMonth = (iso) => {
    const d = toUtcNoon(iso);
    return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
};
const startOfQuarter = (iso) => {
    const d = toUtcNoon(iso);
    return toIso(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1, 12)));
};
const startOfYear = (iso) => `${iso.slice(0, 4)}-01-01`;

/**
 * The named ranges the UI offers. Kept server-side so a preset means the same
 * thing on every board and in every export.
 */
const PRESETS = Object.freeze({
    today: { label: 'Today', resolve: (t) => ({ from: t, to: t }) },
    yesterday: { label: 'Yesterday', resolve: (t) => ({ from: addDays(t, -1), to: addDays(t, -1) }) },
    last_7_days: { label: 'Last 7 days', resolve: (t) => ({ from: addDays(t, -6), to: t }) },
    last_30_days: { label: 'Last 30 days', resolve: (t) => ({ from: addDays(t, -29), to: t }) },
    last_90_days: { label: 'Last 90 days', resolve: (t) => ({ from: addDays(t, -89), to: t }) },
    this_month: { label: 'This month', resolve: (t) => ({ from: startOfMonth(t), to: t }) },
    last_month: {
        label: 'Last month',
        resolve: (t) => {
            const anchor = addMonths(startOfMonth(t), -1);
            return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
        },
    },
    this_quarter: { label: 'This quarter', resolve: (t) => ({ from: startOfQuarter(t), to: t }) },
    year_to_date: { label: 'Year to date', resolve: (t) => ({ from: startOfYear(t), to: t }) },
    last_12_months: { label: 'Last 12 months', resolve: (t) => ({ from: addDays(addMonths(t, -12), 1), to: t }) },
});

const resolvePreset = (presetId, anchor = today()) => {
    const preset = PRESETS[presetId];
    if (!preset) return null;
    return preset.resolve(anchor);
};

/**
 * The equally long range ending the day before this one starts.
 */
const previousPeriod = ({ from, to }) => {
    const length = daysBetweenInclusive(from, to);
    return { from: addDays(from, -length), to: addDays(from, -1) };
};

const previousYear = ({ from, to }) => ({ from: addMonths(from, -12), to: addMonths(to, -12) });

const COMPARE_MODES = Object.freeze({
    previous_period: { id: 'previous_period', label: 'vs previous period', resolve: previousPeriod },
    previous_year: { id: 'previous_year', label: 'vs same period last year', resolve: previousYear },
});

/**
 * Wording for a comparison, in words rather than a bare arrow. "vs previous 30
 * days" is readable; a red triangle is not.
 */
const compareLabel = (mode, range) => {
    if (mode === 'previous_year') return 'vs same period last year';
    const days = daysBetweenInclusive(range.from, range.to);
    return `vs previous ${days} day${days === 1 ? '' : 's'}`;
};

module.exports = {
    PRESETS,
    COMPARE_MODES,
    resolvePreset,
    previousPeriod,
    previousYear,
    compareLabel,
    daysBetweenInclusive,
    isIsoDate,
    addDays,
    addMonths,
    today,
};
