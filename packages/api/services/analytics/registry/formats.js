/**
 * Presentation formats, declared once and keyed by id.
 *
 * The registry owns how a number is written -- decimals, currency prefix, unit
 * suffix -- so a board spec never repeats it and the executor knows which
 * columns to coerce out of the strings `pg` returns for NUMERIC.
 */
const FORMATS = Object.freeze({
    currency: Object.freeze({
        id: 'currency', numeric: true, decimals: 2, prefix: '₱', suffix: '', compactable: true,
    }),
    integer: Object.freeze({
        id: 'integer', numeric: true, decimals: 0, prefix: '', suffix: '', compactable: true,
    }),
    percent: Object.freeze({
        id: 'percent', numeric: true, decimals: 1, prefix: '', suffix: '%', compactable: false,
    }),
    days: Object.freeze({
        id: 'days', numeric: true, decimals: 1, prefix: '', suffix: ' days', compactable: false,
    }),
    ratio: Object.freeze({
        id: 'ratio', numeric: true, decimals: 2, prefix: '', suffix: '', compactable: false,
    }),
    text: Object.freeze({
        id: 'text', numeric: false, decimals: 0, prefix: '', suffix: '', compactable: false,
    }),
});

module.exports = { FORMATS };
