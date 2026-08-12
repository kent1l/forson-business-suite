import tinycolor from 'tinycolor2';

// Shade steps used across the app's semantic color tokens (primary/accent).
// The input hex is treated as the "600" workhorse shade - the one used for
// solid buttons/hover states - matching how the app's static palette is shaped.
const SHADE_STEPS = {
    50: { lightenTo: 96, desaturateBy: 8 },
    100: { lightenTo: 91, desaturateBy: 4 },
    500: { lightenBy: 6 },
    600: null, // the base color itself, unchanged
    700: { darkenBy: 8 },
    900: { darkenBy: 30, minLightness: 12 },
};

/**
 * Generates a 6-step shade ramp (50/100/500/600/700/900) from a single base hex color.
 * @param {string} hex - base color, treated as the 600 shade
 * @returns {{50:string,100:string,500:string,600:string,700:string,900:string}}
 */
export function generateShadeRamp(hex) {
    const base = tinycolor(hex);
    if (!base.isValid()) return null;

    const baseHsl = base.toHsl();
    const ramp = { 600: base.toHexString() };

    for (const [step, rule] of Object.entries(SHADE_STEPS)) {
        if (rule === null) continue;
        let color = tinycolor(base.toHexString());

        if (rule.lightenTo !== undefined) {
            color = tinycolor({ h: baseHsl.h, s: Math.max(0, baseHsl.s * 100 - (rule.desaturateBy || 0)) / 100, l: rule.lightenTo / 100 });
        } else if (rule.lightenBy !== undefined) {
            color = tinycolor({ h: baseHsl.h, s: baseHsl.s, l: Math.min(1, baseHsl.l + rule.lightenBy / 100) });
        } else if (rule.darkenBy !== undefined) {
            const targetL = Math.max((rule.minLightness || 0) / 100, baseHsl.l - rule.darkenBy / 100);
            color = tinycolor({ h: baseHsl.h, s: baseHsl.s, l: targetL });
        }

        ramp[step] = color.toHexString();
    }

    return {
        50: ramp[50],
        100: ramp[100],
        500: ramp[500],
        600: ramp[600],
        700: ramp[700],
        900: ramp[900],
    };
}

/**
 * WCAG contrast ratio between two colors (1-21). Higher is better.
 */
export function contrastRatio(hexA, hexB) {
    return tinycolor.readability(hexA, hexB);
}

/**
 * Contrast rating against white, based on the WCAG AA thresholds for normal text.
 * @returns {'good'|'borderline'|'poor'}
 */
export function contrastRating(hex) {
    const ratio = contrastRatio(hex, '#ffffff');
    if (ratio >= 4.5) return 'good';
    if (ratio >= 3.0) return 'borderline';
    return 'poor';
}

/**
 * Nudges a color's lightness (darker, since brand colors are usually checked
 * against white text) until it reaches the target contrast ratio against white.
 * Returns the original hex if it already passes, or if no safe shade is found.
 */
export function suggestSaferShade(hex, targetRatio = 4.5) {
    const base = tinycolor(hex);
    if (!base.isValid() || contrastRatio(hex, '#ffffff') >= targetRatio) return base.toHexString();

    const hsl = base.toHsl();
    for (let l = hsl.l; l >= 0; l -= 0.02) {
        const candidate = tinycolor({ h: hsl.h, s: hsl.s, l });
        if (contrastRatio(candidate.toHexString(), '#ffffff') >= targetRatio) {
            return candidate.toHexString();
        }
    }
    return base.toHexString();
}

export function isValidHex(hex) {
    return /^#[0-9a-f]{6}$/i.test(hex || '');
}
