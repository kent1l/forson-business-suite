const { generateSssBrackets } = require('../services/hr/statutoryAdminService');

/**
 * The SSS generator is the piece worth testing hardest: it turns the handful of
 * numbers that actually change in a circular into the 61-row table, so a
 * mistake here silently mis-pays everyone.
 */
describe('generateSssBrackets — default (15% split 5/10, WISP above MSC 20k)', () => {
    const brackets = generateSssBrackets({});
    const byMsc = (msc) => brackets.find((b) => b.msc === msc);

    it('produces one bracket per MSC step', () => {
        expect(brackets).toHaveLength(61); // 5,000 to 35,000 in 500s
        expect(brackets[0].msc).toBe(5000);
        expect(brackets[60].msc).toBe(35000);
    });

    it('opens the bottom band at zero and leaves the top open-ended', () => {
        // Otherwise a very low or very high salary would resolve to no bracket.
        expect(brackets[0].range_from).toBe(0);
        expect(brackets[60].range_to).toBeNull();
    });

    it('makes the bands contiguous with no gaps', () => {
        for (let i = 1; i < brackets.length; i += 1) {
            const gap = Number(brackets[i].range_from) - Number(brackets[i - 1].range_to);
            expect(Number(gap.toFixed(2))).toBe(0.01);
        }
    });

    it('charges 5% employee and 10% employer below the ceiling', () => {
        expect(byMsc(16000).ee_amount).toBe(800);
        expect(byMsc(16000).er_amount).toBe(1600);
    });

    it('caps regular SS at the ceiling and routes the excess to WISP', () => {
        expect(byMsc(20000).ee_amount).toBe(1000);
        expect(byMsc(20000).mpf_ee).toBe(0);
        expect(byMsc(25000).ee_amount).toBe(1000);   // still capped
        expect(byMsc(25000).mpf_ee).toBe(250);       // 5% of the 5,000 excess
        expect(byMsc(35000).mpf_ee).toBe(750);
        expect(byMsc(35000).mpf_er).toBe(1500);
    });

    it('steps the EC contribution at the threshold', () => {
        expect(byMsc(14500).ec_amount).toBe(10);
        expect(byMsc(15000).ec_amount).toBe(30);
    });
});

describe('generateSssBrackets — responding to a rate change', () => {
    it('applies a new contribution rate across the table', () => {
        // A 16% total (5.5/10.5) circular, the kind of change this exists for.
        const brackets = generateSssBrackets({ eeRate: 0.055, erRate: 0.105 });
        const b = brackets.find((x) => x.msc === 20000);
        expect(b.ee_amount).toBe(1100);
        expect(b.er_amount).toBe(2100);
    });

    it('applies a raised MSC ceiling', () => {
        const brackets = generateSssBrackets({ mscMax: 40000 });
        expect(brackets[brackets.length - 1].msc).toBe(40000);
        expect(brackets).toHaveLength(71);
    });

    it('applies a raised regular-SS ceiling, shrinking the WISP portion', () => {
        const brackets = generateSssBrackets({ regularSsCeiling: 25000 });
        const b = brackets.find((x) => x.msc === 25000);
        expect(b.ee_amount).toBe(1250); // 5% of 25,000, no longer capped at 20k
        expect(b.mpf_ee).toBe(0);
    });

    it('handles a different MSC step', () => {
        const brackets = generateSssBrackets({ mscMin: 5000, mscMax: 6000, mscStep: 1000 });
        expect(brackets.map((b) => b.msc)).toEqual([5000, 6000]);
        // Band edges follow the step, so a 1,000 step gives +/-500 bands.
        expect(brackets[1].range_from).toBe(5500);
    });

    it('rejects nonsense parameters rather than producing a broken table', () => {
        expect(() => generateSssBrackets({ mscStep: 0 })).toThrow(/mscStep/);
        expect(() => generateSssBrackets({ mscMin: 20000, mscMax: 10000 })).toThrow(/mscMax/);
    });
});

describe('generated table stays usable by the lookup', () => {
    it('resolves every salary from zero to well above the ceiling', () => {
        const brackets = generateSssBrackets({});
        const resolve = (basis) => brackets.find(
            (b) => basis >= Number(b.range_from) && (b.range_to === null || basis <= Number(b.range_to))
        );
        for (const salary of [0, 1, 4999, 5000, 15910.83, 20000, 34999, 35000, 100000, 1000000]) {
            expect(resolve(salary)).toBeDefined();
        }
    });
});
