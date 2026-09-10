// Unit tests for the deterministic fitment parser and engine-code grammar
// (Vehicle Fitment Phase 7, PRD-FBS-FIT-002 §7.7).
//
// These are pure -- no database. The fixture below mirrors the real taxonomy's
// shape closely enough to exercise the rules that carry the correctness risk:
// slash expansion, variant suffixes that must never collapse, short codes that
// must never be fuzzy-matched, and clause-level context carry-forward.

const {
    expandSlashToken,
    lookupKey,
    hasVariantSuffix,
} = require('../helpers/engineCodeGrammar');
const { buildIndex } = require('../helpers/vehicleTaxonomyIndex');
const roundTripFixtures = require('./fixtures/engineCodeRoundTrip.json');
const { parseFitmentText, buildShortlist } = require('../helpers/fitmentTextParser');

const RAW = {
    makes: [
        { make_id: 1, make_name: 'Toyota' },
        { make_id: 2, make_name: 'Mitsubishi' },
        { make_id: 3, make_name: 'Isuzu' },
        { make_id: 4, make_name: 'Suzuki' },
    ],
    models: [
        { model_id: 11, model_name: 'Hilux', make_id: 1, make_name: 'Toyota' },
        { model_id: 12, model_name: 'Fortuner', make_id: 1, make_name: 'Toyota' },
        { model_id: 13, model_name: 'L300', make_id: 2, make_name: 'Mitsubishi' },
        { model_id: 14, model_name: 'Grand Vitara', make_id: 4, make_name: 'Suzuki' },
        { model_id: 15, model_name: 'Crosswind', make_id: 3, make_name: 'Isuzu' },
        // Punctuation-heavy real names, and a genuine cross-make homonym.
        { model_id: 16, model_name: 'C&E Series', make_id: 3, make_name: 'Isuzu' },
        { model_id: 17, model_name: 'Every / Multicab', make_id: 4, make_name: 'Suzuki' },
        { model_id: 18, model_name: 'Ranger', make_id: 1, make_name: 'Toyota' },
        { model_id: 19, model_name: 'Ranger', make_id: 3, make_name: 'Isuzu' },
    ],
    engines: [
        { engine_id: 101, engine_code: '4D55', displacement_liters: null, fuel_type: 'diesel' },
        { engine_id: 102, engine_code: '4D56', displacement_liters: '2.50', fuel_type: 'diesel' },
        { engine_id: 103, engine_code: '4D65', displacement_liters: null, fuel_type: 'diesel' },
        { engine_id: 104, engine_code: '4D56-HP', displacement_liters: '2.50', fuel_type: 'diesel' },
        { engine_id: 105, engine_code: '4JA1', displacement_liters: '2.50', fuel_type: 'diesel' },
        { engine_id: 106, engine_code: '4JA1-L', displacement_liters: '2.50', fuel_type: 'diesel' },
        { engine_id: 107, engine_code: '4JB1', displacement_liters: '2.80', fuel_type: 'diesel' },
        { engine_id: 108, engine_code: '4JJ1-TC', displacement_liters: '3.00', fuel_type: 'diesel' },
        { engine_id: 109, engine_code: '4JJ1-TCX', displacement_liters: '3.00', fuel_type: 'diesel' },
        { engine_id: 110, engine_code: '1TR-FE', displacement_liters: '2.00', fuel_type: 'gasoline' },
        { engine_id: 111, engine_code: 'JT', displacement_liters: '2.70', fuel_type: 'diesel' },
        // Shapes the loose token regex cannot see on its own -- these are why
        // known codes are matched as literal spans.
        { engine_id: 112, engine_code: 'D4BA', displacement_liters: '2.50', fuel_type: 'diesel' },
        { engine_id: 113, engine_code: 'HR12DE', displacement_liters: '1.20', fuel_type: 'gasoline' },
        { engine_id: 114, engine_code: 'YD25DDTi', displacement_liters: '2.50', fuel_type: 'diesel' },
        { engine_id: 115, engine_code: '1.5L Ti-VCT', displacement_liters: '1.50', fuel_type: 'gasoline' },
        { engine_id: 116, engine_code: 'Cummins ISF 2.8', displacement_liters: '2.80', fuel_type: 'diesel' },
        { engine_id: 117, engine_code: '2L', displacement_liters: '2.40', fuel_type: 'diesel' },
    ],
    makeAliases: [
        { make_id: 2, alias_text: 'MITS' },
    ],
    modelAliases: [],
    engineAliases: [
        // The retired family code keeps resolving, fanning out to all three.
        { engine_id: 101, alias_text: '4D55/56/65' },
        { engine_id: 102, alias_text: '4D55/56/65' },
        { engine_id: 103, alias_text: '4D55/56/65' },
    ],
};

const index = buildIndex(RAW);
const parse = text => parseFitmentText(text, index);
const codesOf = result => result.fitments.map(f => f.engine).filter(Boolean).sort();

describe('engineCodeGrammar.expandSlashToken', () => {
    test('right-aligned overlay expands a single-digit suffix', () => {
        expect(expandSlashToken('4D55/6')).toEqual(['4D55', '4D56']);
    });

    test('right-aligned overlay expands a two-character suffix', () => {
        expect(expandSlashToken('4JA1/B1')).toEqual(['4JA1', '4JB1']);
    });

    test('each segment overlays the original base, not the previous expansion', () => {
        expect(expandSlashToken('4D55/56/65')).toEqual(['4D55', '4D56', '4D65']);
    });

    test('a segment as long as the base is treated as a complete code', () => {
        expect(expandSlashToken('4D55/4D56')).toEqual(['4D55', '4D56']);
    });

    test('tolerates spacing around the separator', () => {
        expect(expandSlashToken(' 4d55 / 6 ')).toEqual(['4D55', '4D56']);
    });

    test('a token with no slash is returned unchanged', () => {
        expect(expandSlashToken('4JA1')).toEqual(['4JA1']);
    });
});

describe('engineCodeGrammar.lookupKey', () => {
    test('collapses cosmetic separator and case variance', () => {
        expect(lookupKey('4JA1 - T')).toBe(lookupKey('4JA1-T'));
        expect(lookupKey('4ja1t')).toBe(lookupKey('4JA1-T'));
    });

    test('never collapses a variant suffix into its base code', () => {
        expect(lookupKey('4JA1')).not.toBe(lookupKey('4JA1-T'));
        expect(lookupKey('4JJ1-TC')).not.toBe(lookupKey('4JJ1-TCX'));
    });

    test('detects variant suffixes', () => {
        expect(hasVariantSuffix('4JA1-T')).toBe(true);
        expect(hasVariantSuffix('4JA1')).toBe(false);
    });
});

describe('parseFitmentText - engine codes', () => {
    test('4D55/6 resolves to two distinct, individually linked engines', () => {
        const result = parse('4D55/6');
        expect(codesOf(result)).toEqual(['4D55', '4D56']);
        expect(result.fitments.map(f => f.engine_id).sort()).toEqual([101, 102]);
    });

    test('4JA1/B1 resolves to 4JA1 and 4JB1', () => {
        expect(codesOf(parse('4JA1/B1'))).toEqual(['4JA1', '4JB1']);
    });

    test('4JA1-T does not silently collapse into 4JA1', () => {
        const result = parse('4JA1-T');
        // 4JA1-T is not in the fixture taxonomy, so it must come back
        // unresolved with its text preserved -- never matched to 4JA1.
        expect(result.fitments.every(f => f.engine_id !== 105)).toBe(true);
        const engineRow = result.fitments.find(f => f.engine);
        if (engineRow) expect(engineRow.engine_id).toBeNull();
    });

    test('a known variant suffix resolves to its own engine, not the base', () => {
        const result = parse('4JA1-L');
        expect(result.fitments[0].engine_id).toBe(106);
    });

    test('4JJ1-TCX resolves to itself, not to 4JJ1-TC', () => {
        expect(parse('4JJ1-TCX').fitments[0].engine_id).toBe(109);
    });

    test('the retired family alias still fans out to all three members', () => {
        expect(codesOf(parse('4D55/56/65'))).toEqual(['4D55', '4D56', '4D65']);
    });

    test('a bare short code resolves only by exact match', () => {
        expect(parse('JT').fitments[0].engine_id).toBe(111);
    });

    test('a short code that is not in the taxonomy is never fuzzy-matched', () => {
        const result = parse('JX');
        expect(result.fitments.every(f => f.engine_id === null)).toBe(true);
    });

    test('an unconfirmable expansion is not invented', () => {
        // 4D55/9 would expand to 4D59, which does not exist. 4D55 is real, so
        // that alone may be proposed -- but 4D59 must never appear with an id.
        const result = parse('4D55/9');
        expect(result.fitments.every(f => f.engine_id !== null ? f.engine !== '4D59' : true)).toBe(true);
    });
});

describe('parseFitmentText - dimensions', () => {
    test('extracts a year range', () => {
        const r = parse('Hilux 2005-2015');
        expect(r.fitments[0].year_start).toBe(2005);
        expect(r.fitments[0].year_end).toBe(2015);
    });

    test('extracts a single year as both bounds', () => {
        const r = parse('Hilux 2015');
        expect(r.fitments[0].year_start).toBe(2015);
        expect(r.fitments[0].year_end).toBe(2015);
    });

    test('extracts an open-ended year range', () => {
        const r = parse('Hilux 2015+');
        expect(r.fitments[0].year_start).toBe(2015);
        expect(r.fitments[0].year_end).toBeNull();
    });

    test('extracts displacement in litres and in cc', () => {
        expect(parse('Hilux 2.5L').fitments[0].displacement_liters).toBe(2.5);
        expect(parse('Hilux 2500cc').fitments[0].displacement_liters).toBe(2.5);
    });

    test('maps market fuel shorthand onto the schema fuel values', () => {
        expect(parse('Hilux diesel').fitments[0].fuel_type).toBe('diesel');
        expect(parse('Hilux CRDi').fitments[0].fuel_type).toBe('diesel');
        expect(parse('Hilux gas').fitments[0].fuel_type).toBe('gasoline');
    });

    test('inherits fuel and displacement from the matched engine when unstated', () => {
        const r = parse('4JB1');
        expect(r.fitments[0].displacement_liters).toBe(2.8);
        expect(r.fitments[0].fuel_type).toBe('diesel');
    });
});

describe('parseFitmentText - clauses and carry-forward', () => {
    test('a second clause inherits make, years and engine context', () => {
        const r = parse('Hilux 2005-2015 2.5L diesel, also Fortuner same years');
        const models = r.fitments.map(f => f.model).sort();
        expect(models).toEqual(['Fortuner', 'Hilux']);
        for (const row of r.fitments) {
            expect(row.year_start).toBe(2005);
            expect(row.year_end).toBe(2015);
            expect(row.fuel_type).toBe('diesel');
        }
    });

    test('resolves the make from the model when only the model is named', () => {
        const r = parse('Hilux');
        expect(r.fitments[0].make).toBe('Toyota');
        expect(r.fitments[0].make_id).toBe(1);
    });

    test('multi-word model names win over their first token', () => {
        const r = parse('Grand Vitara 2010');
        expect(r.fitments[0].model).toBe('Grand Vitara');
        expect(r.fitments[0].model_id).toBe(14);
    });

    test('separator variance in a model name is cosmetic', () => {
        expect(parse('Hi-Lux 2010').fitments[0].model_id).toBe(11);
        expect(parse('L 300').fitments[0].model_id).toBe(13);
    });

    test('a make alias resolves', () => {
        const r = parse('Mits L300');
        expect(r.fitments[0].make_id).toBe(2);
    });

    test('one clause naming a model and a multi-engine code yields a row per engine', () => {
        const r = parse('Hilux 4D55/6');
        expect(r.fitments).toHaveLength(2);
        expect(r.fitments.every(f => f.model_id === 11)).toBe(true);
        expect(r.fitments.map(f => f.engine_id).sort()).toEqual([101, 102]);
    });
});

describe('parseFitmentText - escalation signalling', () => {
    test('a fully recognised description needs no AI fallback', () => {
        const r = parse('Hilux 2005-2015 4D56');
        expect(r.fullyResolved).toBe(true);
        expect(r.residue).toEqual([]);
    });

    test('unrecognised text is reported as residue rather than guessed at', () => {
        const r = parse('Hilux 2005 sometotallyunknownthing');
        expect(r.fullyResolved).toBe(false);
        expect(r.residue.length).toBeGreaterThan(0);
    });

    test('filler words alone do not count as residue', () => {
        const r = parse('Fits Hilux 2005-2015');
        expect(r.residue).toEqual([]);
        expect(r.fullyResolved).toBe(true);
    });

    test('empty input is handled without escalating', () => {
        const r = parse('   ');
        expect(r.fitments).toEqual([]);
        expect(r.fullyResolved).toBe(true);
    });
});

describe('engine-code shorthand round-trips with the web display formatter', () => {
    // The other half of this guard runs in packages/web's node:test suite
    // against the same fixture (PRD-FBS-FIT-002 §9.3). The display formatter
    // compresses {4D55, 4D56} to "4D55/6"; this asserts the parser expands that
    // shorthand back to exactly the same codes. There is no shared package in
    // this repo, so the fixture is what keeps the two implementations honest.
    test.each(roundTripFixtures.roundTrip)('$compressed expands back to its codes', ({ codes, compressed }) => {
        expect(expandSlashToken(compressed)).toEqual(codes);
    });
});

describe('parseFitmentText - ordinary words are not engine codes', () => {
    // Regression: the engine-token pattern is deliberately loose, so it also
    // nominates plain words. Before this guard, "Grand Vitara" (the fixture
    // taxonomy has the two-word name, the real one only has "Vitara") and
    // phrases like "some van" produced junk "(new engine)" candidate rows for
    // staff to clean up.
    test('an unmatched ordinary word becomes residue, not a proposed engine', () => {
        const r = parse('Hilux 2010 someword');
        expect(r.fitments.some(f => f.engine === 'someword')).toBe(false);
        expect(r.residue).toContain('someword');
    });

    test('a code-shaped unknown token is still proposed for review', () => {
        // Contains a digit, so it is plausibly a real engine the catalog has
        // not seen yet -- that should reach the reviewer, unresolved.
        const r = parse('9ZZ9');
        const row = r.fitments.find(f => f.engine);
        expect(row).toBeDefined();
        expect(row.engine_id).toBeNull();
    });

    test('prose does not produce candidate rows at all', () => {
        const r = parse('fits some unknown van');
        expect(r.fitments).toEqual([]);
        expect(r.fullyResolved).toBe(false);
    });
});

describe('buildShortlist', () => {
    test('narrows the taxonomy to near candidates instead of sending all of it', () => {
        const shortlist = buildShortlist(['Hilx'], index);
        const modelNames = shortlist.models.map(m => m.model_name);
        expect(modelNames).toContain('Hilux');
        expect(shortlist.models.length).toBeLessThan(RAW.models.length);
    });

    test('returns nothing when the residue resembles nothing in the taxonomy', () => {
        // The route treats this as the signal to fall back to full grounding:
        // an empty shortlist would make the AI parser strip every id it returns.
        const shortlist = buildShortlist(['zzzzqqqqxxxx'], index);
        expect(shortlist.makes.length + shortlist.models.length + shortlist.engines.length).toBe(0);
    });

    test('ignores residue too short to be meaningful', () => {
        const shortlist = buildShortlist(['a'], index);
        expect(shortlist.models).toEqual([]);
    });
});

describe('parseFitmentText - known codes are matched literally, not by regex shape', () => {
    // Regression: the engine-token regex alone could not see about a third of
    // the real catalog (D4BA, HR12DE, 10PA1, YD25DDTi, "1.5L Ti-VCT",
    // "Cummins ISF 2.8"). Known codes are now matched as literal spans, so
    // anything already in the taxonomy resolves regardless of its shape.
    test.each([
        ['D4BA', 112],
        ['HR12DE', 113],
        ['YD25DDTi', 114],
        ['1.5L Ti-VCT', 115],
        ['Cummins ISF 2.8', 116],
    ])('%s resolves to its engine', (code, engineId) => {
        const r = parse(code);
        expect(r.fitments[0].engine_id).toBe(engineId);
        expect(r.fullyResolved).toBe(true);
    });

    test('a known code is matched case- and separator-insensitively', () => {
        expect(parse('yd25 ddti').fitments[0].engine_id).toBe(114);
    });

    // The literal matcher must never match a code that is merely the PREFIX of
    // a longer code token -- that would take 4D55 out of "4D55/6" (losing the
    // second engine) or collapse "4JA1-T" into the naturally aspirated 4JA1.
    test('literal matching does not consume a prefix of a slash token', () => {
        const r = parse('4D55/6');
        expect(r.fitments.map(f => f.engine_id).sort()).toEqual([101, 102]);
    });

    test('literal matching does not collapse a variant suffix into its base', () => {
        const r = parse('4JA1-T');
        expect(r.fitments.every(f => f.engine_id !== 105)).toBe(true);
    });

    // Bare displacement-style codes ("2L", "1.5") are deliberately NOT matched
    // literally: they are indistinguishable from litre notation, and matching
    // them would swallow the displacement of ordinary descriptions.
    test('a bare displacement-style code does not eat a stated displacement', () => {
        const r = parse('Hilux 2L diesel');
        expect(r.fitments[0].model_id).toBe(11);
        expect(r.fitments[0].displacement_liters).toBe(2);
    });
});

describe('parseFitmentText - punctuation-heavy and homonymous names', () => {
    test('model names containing & and / resolve', () => {
        expect(parse('C&E Series').fitments[0].model_id).toBe(16);
        expect(parse('Every / Multicab').fitments[0].model_id).toBe(17);
    });

    // A model name shared by two makes is genuinely ambiguous. The parser must
    // refuse to guess, but must resolve cleanly once the make is stated.
    test('a cross-make homonym is left unresolved on its own', () => {
        const r = parse('Ranger');
        expect(r.fitments[0].model_id).toBeNull();
        expect(r.fullyResolved).toBe(false);
    });

    test('the same homonym resolves once the make is given', () => {
        expect(parse('Toyota Ranger').fitments[0].model_id).toBe(18);
        expect(parse('Isuzu Ranger').fitments[0].model_id).toBe(19);
    });
});

describe('engineCodeGrammar - shared-suffix expansion', () => {
    test('distributes a shared trailing segment across the heads', () => {
        expect(expandSlashToken('1GD/1KD/2GD/2KD-FTV'))
            .toEqual(['1GD-FTV', '1KD-FTV', '2GD-FTV', '2KD-FTV']);
        expect(expandSlashToken('4JJ1/4JK1/4JH1-TC'))
            .toEqual(['4JJ1-TC', '4JK1-TC', '4JH1-TC']);
    });

    // The guard that stops the suffix reading from eating a distinct base code:
    // "4JA1/4JA1-L" must keep the naturally aspirated 4JA1, not turn both into
    // 4JA1-L.
    test('does not swallow a head that equals the final segment base', () => {
        expect(expandSlashToken('4JA1/4JA1-L')).toEqual(['4JA1', '4JA1-L']);
    });

    // The suffix rule keys off the LAST segment carrying a hyphen while the
    // earlier ones do not; these must still take the overlay path.
    test('does not hijack the right-aligned overlay forms', () => {
        expect(expandSlashToken('4D55/6')).toEqual(['4D55', '4D56']);
        expect(expandSlashToken('1KR-DE/VE')).toEqual(['1KR-DE', '1KR-VE']);
        expect(expandSlashToken('4D55/56/65')).toEqual(['4D55', '4D56', '4D65']);
    });

    test('a suffix-compressed code family resolves through the parser', () => {
        // 1TR-FE is the only -FE engine in the fixture, so this exercises the
        // grammar reaching the gazetteer rather than inventing codes.
        const r = parse('9ZZ/1TR-FE');
        expect(r.fitments.some(f => f.engine_id === 110)).toBe(true);
    });
});
