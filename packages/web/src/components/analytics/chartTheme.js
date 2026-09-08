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

export default CHART_THEME;
