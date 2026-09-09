import { useTheme } from '../../contexts/ThemeContext';

/**
 * Chart colours, picked in JS.
 *
 * recharts paints inline SVG styles, so Tailwind's `dark:` classes never reach a
 * chart surface. Colours are therefore resolved from the theme mode (which
 * ThemeContext has already resolved from "system") rather than from CSS.
 *
 * Extracted from components/dashboard/AnalyticsCharts.jsx, which re-exports it
 * so the existing Dashboard is untouched.
 */
export const CHART_THEME = {
    light: {
        grid: '#e2e8f0',
        tick: '#64748b',
        line: '#2563eb',
        bar: '#8f56f0',
        tooltipBg: '#ffffff',
        tooltipBorder: '#e2e8f0',
        tooltipLabel: '#64748b',
    },
    dark: {
        grid: '#334155',
        tick: '#94a3b8',
        line: '#60a5fa',
        bar: '#a78bfa',
        tooltipBg: '#1e293b',
        tooltipBorder: '#334155',
        tooltipLabel: '#94a3b8',
    },
};

/**
 * The categorical series palette.
 *
 * Hues are assigned in this fixed order and never cycled: colour follows the
 * entity, not its rank, so filtering a series out must not repaint the ones that
 * remain. Beyond six meaningful classes the tail folds into "Other" (a neutral
 * grey) — with 444 brands and 767 groups in this catalogue, generating more hues
 * would produce a legend nobody can read.
 *
 * Both sets were checked with the dataviz skill's validator against their own
 * surface — white for light, slate-800 for dark — and pass all six checks:
 * lightness band, chroma floor, adjacent-pair CVD separation (deutan and
 * tritan), the normal-vision floor, and contrast against the surface. Dark mode
 * is its own selected set at the dark band's own lightness, not a flip of the
 * light one. Do not edit these by eye; re-run the validator.
 *
 * Status colours (success / warning / danger) are deliberately absent: they mean
 * a state, and reusing one as "series 4" makes a neutral category look like an
 * alarm.
 */
export const SERIES_PALETTE = {
    light: ['#2563eb', '#c2410c', '#0891b2', '#be185d', '#7c3aed', '#4d7c0f'],
    dark: ['#5590f0', '#d7752f', '#12a2bd', '#e0608f', '#9a7af0', '#7ba32e'],
};

/** The colour of the folded tail, and of anything that is not one of the six. */
export const OTHER_COLOR = { light: '#94a3b8', dark: '#64748b' };

/**
 * A comparison series is the same entity in a different period, so it is drawn
 * as a muted, dashed version of its own colour rather than as a second category.
 */
export const COMPARE_STROKE = { light: '#94a3b8', dark: '#64748b' };

/**
 * The sequential ramp, for continuous magnitude — the hour x weekday heatmap.
 *
 * ONE hue, light to dark, seven steps. A sequential encoding is not a
 * categorical one: cycling hues across intensity would say these cells are
 * different *kinds* of thing when the only thing that differs is how much.
 * Blue is used because it is already series 0, so the busiest hour and the
 * revenue line on the board above it read as the same measure.
 *
 * Checked with the dataviz validator against each mode's own surface (white,
 * slate-800). Both ramps pass every check that applies to a sequential ramp:
 * monotone lightness, an adjacent step gap of at least 0.06, and a single hue
 * (spread 4 deg light, 5 deg dark). The validator's remaining check — that the
 * end nearest the surface clears 2:1 contrast — is an ORDINAL requirement and
 * is deliberately not met: in a sequential ramp the palest step means "nearly
 * nothing" and is meant to recede. Trimming the ramp does not fix it (the next
 * step reaches only 1.79:1) and would throw away the low end of the scale.
 *
 * That is exactly why HEATMAP_EMPTY exists and is a NEUTRAL rather than a
 * paler blue. "The shop was shut" and "the shop was open and sold almost
 * nothing" are different facts, and on a staffing chart they lead to opposite
 * decisions, so they must not be two shades of the same colour.
 *
 * Do not edit any of this by eye; re-run scripts/validate_palette.js.
 */
export const SEQUENTIAL_PALETTE = {
    light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    // Selected at the dark band's own lightness and running dark -> light, not a
    // reversal of the light ramp.
    dark: ['#1e3a5f', '#24508f', '#2a68bd', '#3d86dc', '#6da7ec', '#9ec5f4', '#cde2fb'],
};

/** A cell with no data at all: neutral, and visibly not part of the ramp. */
export const HEATMAP_EMPTY = { light: '#f1f5f9', dark: '#0f172a' };

export const useChartTheme = () => {
    const { mode } = useTheme() || {};
    return CHART_THEME[mode === 'dark' ? 'dark' : 'light'];
};

/**
 * Series colours for the current theme, plus a resolver that keys a colour to an
 * entity id so it survives re-ordering and filtering.
 */
export const useSeriesPalette = () => {
    const { mode } = useTheme() || {};
    const key = mode === 'dark' ? 'dark' : 'light';
    const palette = SERIES_PALETTE[key];
    return {
        palette,
        other: OTHER_COLOR[key],
        compare: COMPARE_STROKE[key],
        colorFor: (index) => (index >= 0 && index < palette.length ? palette[index] : OTHER_COLOR[key]),
    };
};

/**
 * The sequential ramp for the current theme, plus a resolver from a value to a
 * step.
 *
 * `stepFor` is linear against the largest cell, and deliberately so. A square
 * root or a log would spread the low end out and make a quiet hour look busier
 * than it was — a distortion the reader cannot see and would not expect from a
 * chart that is used to decide when to put a second person on the counter.
 * `null` (no data at all) returns null, never step 0.
 */
export const useSequentialPalette = () => {
    const { mode } = useTheme() || {};
    const key = mode === 'dark' ? 'dark' : 'light';
    const ramp = SEQUENTIAL_PALETTE[key];
    return {
        ramp,
        empty: HEATMAP_EMPTY[key],
        stepFor: (value, max) => {
            if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
            if (!(max > 0)) return ramp[0];
            const ratio = Math.min(Math.max(Number(value) / max, 0), 1);
            // Any positive value lands on at least the first step: a cell that
            // sold something must never be painted as though it sold nothing.
            return ramp[Math.min(ramp.length - 1, Math.max(Number(value) > 0 ? 1 : 0, Math.ceil(ratio * ramp.length)) - 1)];
        },
    };
};

export default CHART_THEME;
