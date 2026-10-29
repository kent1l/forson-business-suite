const {
    validateNoClientVerificationFlags,
    validateAtomicAliasText,
    deriveIdentityAndQualifierModes,
    computeInterpretationKey,
} = require('../helpers/fitmentRuleSchema');
const {
    evaluateFitmentRules,
    buildPowerSearchVehiclePredicate,
} = require('../helpers/fitmentMatcher');
const {
    mergeFitmentCandidates,
    validateEvidenceUrl,
} = require('../services/fitmentReviewService');
const {
    _validateResult,
} = require('../services/ai/features/vehicleFitmentParserAI');

describe('Phase 1-3 Fitment Resolver Unit & Contract Tests', () => {
    describe('fitmentRuleSchema', () => {
        test('validateNoClientVerificationFlags rejects forged verification flags', () => {
            expect(validateNoClientVerificationFlags({ make: 'Toyota' }).valid).toBe(true);
            expect(validateNoClientVerificationFlags({ evidence_status: 'sourced_verified' }).valid).toBe(false);
            expect(validateNoClientVerificationFlags({ approval_status: 'approved' }).valid).toBe(false);
            expect(validateNoClientVerificationFlags({ verified: true }).valid).toBe(false);
        });

        test('validateAtomicAliasText rejects multi-clause, year ranges, and exclusions', () => {
            expect(validateAtomicAliasText('Hilux Revo').ok).toBe(true);
            expect(validateAtomicAliasText('Hilux 2016-2020').ok).toBe(false);
            expect(validateAtomicAliasText('Hilux, Fortuner').ok).toBe(false);
            expect(validateAtomicAliasText('Hilux except 2021').ok).toBe(false);
            expect(validateAtomicAliasText('Hilux 2.8L Diesel').ok).toBe(false);
        });

        test('deriveIdentityAndQualifierModes defaults blank dimensions to not_supplied', () => {
            const derived = deriveIdentityAndQualifierModes({
                make_id: 1,
                model_id: 10,
                chassis_id: null,
                engine_id: null,
                year_start: null,
                year_end: null,
            });
            expect(derived.make_mode).toBe('specified');
            expect(derived.model_mode).toBe('specified');
            expect(derived.chassis_mode).toBe('not_supplied');
            expect(derived.engine_mode).toBe('not_supplied');
            expect(derived.year_mode).toBe('not_supplied');
        });

        test('computeInterpretationKey produces distinct keys for different chassis and effects', () => {
            const k1 = computeInterpretationKey({ make: 'Toyota', model: 'Hiace', chassis: 'KDH200', effect: 'include' });
            const k2 = computeInterpretationKey({ make: 'Toyota', model: 'Hiace', chassis: 'LH113', effect: 'include' });
            const k3 = computeInterpretationKey({ make: 'Toyota', model: 'Hiace', chassis: 'KDH200', effect: 'exclude' });
            expect(k1).not.toBe(k2);
            expect(k1).not.toBe(k3);
        });
    });

    describe('fitmentMatcher (evaluateSingleRule & evaluateFitmentRules)', () => {
        const baseRule = {
            rule_id: 101,
            effect: 'include',
            approval_status: 'approved',
            make_id: 1,
            model_id: 10,
            chassis_id: null,
            chassis_mode: 'not_supplied',
            engine_id: 100,
            engine_mode: 'specified',
            year_start: 2016,
            year_end: 2020,
            year_mode: 'specified',
            market_mode: 'not_supplied',
            variant_mode: 'not_supplied',
            position_mode: 'not_supplied',
            drivetrain_mode: 'not_supplied',
        };

        test('returns confirmed_compatible when all specified dimensions match', () => {
            const res = evaluateFitmentRules([baseRule], {
                make_id: 1,
                model_id: 10,
                engine_id: 100,
                year: 2018,
            });
            expect(res.status).toBe('confirmed_compatible');
            expect(res.state).toBe('confirmed');
        });

        test('returns needs_details when rule has not_supplied engine and query specifies an engine', () => {
            const unspecifiedEngineRule = {
                ...baseRule,
                engine_id: null,
                engine_mode: 'not_supplied',
            };
            const res = evaluateFitmentRules([unspecifiedEngineRule], {
                make_id: 1,
                model_id: 10,
                engine_id: 200,
                year: 2018,
            });
            expect(res.status).toBe('needs_details');
        });

        test('returns excluded when an exclusion rule matches a specific year inside an included range', () => {
            const exclude2021 = {
                ...baseRule,
                rule_id: 102,
                effect: 'exclude',
                year_start: 2021,
                year_end: 2021,
            };
            const include2016To2022 = {
                ...baseRule,
                year_start: 2016,
                year_end: 2022,
            };
            const res2021 = evaluateFitmentRules([include2016To2022, exclude2021], {
                make_id: 1,
                model_id: 10,
                engine_id: 100,
                year: 2021,
            });
            expect(res2021.status).toBe('excluded');

            const res2019 = evaluateFitmentRules([include2016To2022, exclude2021], {
                make_id: 1,
                model_id: 10,
                engine_id: 100,
                year: 2019,
            });
            expect(res2019.status).toBe('confirmed_compatible');
        });

        test('buildPowerSearchVehiclePredicate builds parameterized SQL with exclusion guard', () => {
            const params = [];
            const sql = buildPowerSearchVehiclePredicate(params, {
                makeId: 1,
                modelId: 10,
                engineId: 100,
            });
            expect(sql).toContain('NOT EXISTS');
            expect(sql).toContain('part_application_rule par_ex');
            expect(params).toEqual([1, 10, 100, 1, 10, 100]);
        });
    });

    describe('mergeFitmentCandidates (B06 & B07) and SSRF validation', () => {
        test('B06: does not collapse engine-specific candidate into engine-less candidate', () => {
            const merged = mergeFitmentCandidates(
                [{ make_id: 1, make: 'Toyota', model_id: 10, model: 'Hilux', engine_id: null, engine: null, year_start: 2016, year_end: 2020 }],
                [{ make_id: 1, make: 'Toyota', model_id: 10, model: 'Hilux', engine_id: 100, engine: '1GD-FTV', year_start: 2016, year_end: 2020 }]
            );
            expect(merged).toHaveLength(2);
            expect(merged[0].alternative_group_id).toBeDefined();
            expect(merged[0].alternative_group_id).toBe(merged[1].alternative_group_id);
        });

        test('B07: preserves multiple AI candidates for a multi-vehicle span without collapsing them', () => {
            const ai = [
                { clause_index: 0, make_id: 1, make: 'Mitsubishi', model_id: 20, model: 'Montero Sport', year_start: 2016, year_end: 2020 },
                { clause_index: 0, make_id: 1, make: 'Mitsubishi', model_id: 21, model: 'Strada', year_start: 2016, year_end: 2020 },
            ];
            const merged = mergeFitmentCandidates([], ai);
            expect(merged).toHaveLength(2);
            expect(merged.map((c) => c.model)).toEqual(['Montero Sport', 'Strada']);
        });

        test('validateEvidenceUrl blocks localhost, private IPs, and unsupported schemes', async () => {
            await expect(validateEvidenceUrl('ftp://example.com/catalog')).resolves.toMatchObject({ ok: false, code: 'UNSUPPORTED_URL_PROTOCOL' });
            await expect(validateEvidenceUrl('https://localhost/admin')).resolves.toMatchObject({ ok: false, code: 'SSRF_BLOCKED_HOST' });
            await expect(validateEvidenceUrl('https://127.0.0.1/secret')).resolves.toMatchObject({ ok: false, code: 'SSRF_BLOCKED_IP' });
            await expect(validateEvidenceUrl('https://169.254.169.254/latest/meta-data')).resolves.toMatchObject({ ok: false, code: 'SSRF_BLOCKED_IP' });
        });
    });

    describe('vehicleFitmentParserAI._validateResult (B08 & F17)', () => {
        const mockIndex = {
            makesById: new Map([[1, { make_id: 1, make_name: 'Toyota' }], [2, { make_id: 2, make_name: 'Mitsubishi' }]]),
            modelsById: new Map([[10, { model_id: 10, make_id: 1, model_name: 'Hilux' }]]),
            chassisById: new Map(),
            enginesById: new Map([[100, { engine_id: 100, engine_code: '2KD-FTV', make_id: 1 }]]),
        };

        test('B08: clears hallucinated IDs when label or parent make disagrees with shortlist/catalog', () => {
            const raw = {
                fitments: [
                    {
                        make_id: 1,
                        make: 'Nissan', // Mismatches make_id 1 (Toyota)
                        model_id: 10,
                        model: 'Navara', // Mismatches model_id 10 (Hilux)
                        engine_id: 100,
                        engine: 'YD25', // Mismatches engine_id 100 (2KD-FTV)
                        fuel_type: 'other',
                        confidence: 'high',
                    },
                ],
                notes: '',
            };
            const validated = _validateResult(raw, { makes: [], models: [], engines: [] }, mockIndex);
            expect(validated.fitments).toHaveLength(1);
            expect(validated.fitments[0].make_id).toBeNull();
            expect(validated.fitments[0].model_id).toBeNull();
            expect(validated.fitments[0].engine_id).toBeNull();
            expect(validated.fitments[0].fuel_type).toBeNull(); // F17: never defaults to 'other'
            expect(validated.fitments[0].confidence).toBe('low');
        });
    });
});
