const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn() }));

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = req.user || { employee_id: 1, username: 'testadmin', permission_level_id: 10 };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
    isAdmin: (req, res, next) => next()
}));

const db = require('../db');
const lexicon = require('../services/expenseLexiconService');
const lexiconRouter = require('../routes/expenseLexiconRoutes');

const app = express();
app.use(express.json());
app.use('/api', lexiconRouter);

describe('Expense lexicon service', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('normalizeTerm', () => {
        test('lowercases, strips punctuation and collapses whitespace', () => {
            expect(lexicon.normalizeTerm('  FIBECO,   Inc. ')).toBe('fibeco inc');
        });

        test('preserves non-ASCII letters rather than stripping them', () => {
            expect(lexicon.normalizeTerm('Ñoño')).toBe('ñoño');
        });

        test('handles null and undefined safely', () => {
            expect(lexicon.normalizeTerm(null)).toBe('');
            expect(lexicon.normalizeTerm(undefined)).toBe('');
        });
    });

    describe('extractCandidateTerms', () => {
        test('keeps meaningful Cebuano vocabulary and drops function words', () => {
            const terms = lexicon.extractCandidateTerms('Bayad 4500 sa fibeco para sa kuryente gahapon');
            expect(terms).toContain('fibeco');
            expect(terms).toContain('kuryente');
            // Function/time/generic words carry no classification signal.
            expect(terms).not.toContain('bayad');
            expect(terms).not.toContain('sa');
            expect(terms).not.toContain('para');
            expect(terms).not.toContain('gahapon');
        });

        test('drops bare numbers so amounts never become vocabulary', () => {
            const terms = lexicon.extractCandidateTerms('paid 4500 to Shell');
            expect(terms).not.toContain('4500');
            expect(terms).toContain('shell');
        });

        test('drops tokens shorter than the minimum length', () => {
            const terms = lexicon.extractCandidateTerms('ab cde fghi');
            expect(terms).not.toContain('ab');
            expect(terms).toEqual(expect.arrayContaining(['cde', 'fghi']));
        });

        test('de-duplicates repeated tokens', () => {
            const terms = lexicon.extractCandidateTerms('shell shell shell diesel');
            expect(terms.filter(t => t === 'shell')).toHaveLength(1);
        });
    });

    describe('matchAliases', () => {
        const aliases = [
            { term_normalized: 'kuryente', target_type: 'category', category_id: 2, category_name: 'Utilities' },
            { term_normalized: 'gas', target_type: 'category', category_id: 4, category_name: 'Transportation' }
        ];

        test('matches whole tokens only, never substrings', () => {
            // "gas" must not fire inside "gasket".
            const matched = lexicon.matchAliases('bought a gasket', aliases);
            expect(matched).toHaveLength(0);
        });

        test('matches a term surrounded by other words', () => {
            const matched = lexicon.matchAliases('bayad sa kuryente gahapon', aliases);
            expect(matched).toHaveLength(1);
            expect(matched[0].category_name).toBe('Utilities');
        });

        test('matches multi-word aliases as a phrase', () => {
            const phraseAliases = [{ term_normalized: 'office supplies', target_type: 'category', category_id: 6 }];
            expect(lexicon.matchAliases('bought office supplies today', phraseAliases)).toHaveLength(1);
            expect(lexicon.matchAliases('supplies for the office', phraseAliases)).toHaveLength(0);
        });
    });

    describe('applyAliasesToParsed', () => {
        const aliases = [
            { term_normalized: 'kuryente', target_type: 'category', category_id: 2, category_name: 'Utilities' },
            { term_normalized: 'gracecash', target_type: 'payee', payee: 'Grace' }
        ];

        test('fills a category the model failed to resolve', () => {
            const { parsed, appliedAliases } = lexicon.applyAliasesToParsed(
                'bayad sa kuryente', { category_id: null, payee: null }, aliases
            );
            expect(parsed.category_id).toBe(2);
            expect(parsed.category_name).toBe('Utilities');
            expect(appliedAliases).toHaveLength(1);
        });

        test('never overrides a value the model already resolved', () => {
            const { parsed, appliedAliases } = lexicon.applyAliasesToParsed(
                'bayad sa kuryente', { category_id: 9, category_name: 'Rent', payee: null }, aliases
            );
            expect(parsed.category_id).toBe(9);
            expect(parsed.category_name).toBe('Rent');
            expect(appliedAliases).toHaveLength(0);
        });

        test('fills a payee nickname', () => {
            const { parsed } = lexicon.applyAliasesToParsed(
                'sent via gracecash', { category_id: 1, payee: null }, aliases
            );
            expect(parsed.payee).toBe('Grace');
        });

        test('is a no-op when nothing matches', () => {
            const input = { category_id: null, payee: null };
            const { parsed, appliedAliases } = lexicon.applyAliasesToParsed('random text', input, aliases);
            expect(appliedAliases).toHaveLength(0);
            expect(parsed.category_id).toBeNull();
        });
    });

    describe('looksLikeVariantOf', () => {
        test('treats a longer form of the same name as a variant', () => {
            expect(lexicon.looksLikeVariantOf('gracecash', 'grace')).toBe(true);
        });

        test('rejects an unrelated word that shared the sentence', () => {
            // "kuryente" (electricity) is not a nickname for the power co-op.
            expect(lexicon.looksLikeVariantOf('kuryente', 'fibeco')).toBe(false);
        });

        test('rejects tokens too short to judge', () => {
            expect(lexicon.looksLikeVariantOf('ab', 'abcdef')).toBe(false);
        });
    });

    describe('detectLanguageHint', () => {
        test('flags Cebuano when multiple markers are present', () => {
            expect(lexicon.detectLanguageHint('Bayad sa fibeco kay kuryente')).toBe('ceb');
        });

        test('defaults to English otherwise', () => {
            expect(lexicon.detectLanguageHint('Paid FIBECO for electricity')).toBe('en');
        });
    });

    describe('proposeAliasesFromExpense', () => {
        test('proposes pending aliases and never approves them outright', async () => {
            db.query.mockResolvedValue({ rows: [{ alias_id: 1, term: 'kuryente', status: 'pending', confirm_count: 1 }] });

            const result = await lexicon.proposeAliasesFromExpense({
                rawInput: 'bayad sa kuryente',
                categoryId: 2,
                payee: null,
                employeeId: 1
            });

            expect(result.length).toBeGreaterThan(0);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toMatch(/'pending'/);
            // Re-observation must bump the counter rather than duplicate the row.
            expect(sql).toMatch(/ON CONFLICT .*DO UPDATE/s);
            expect(sql).toMatch(/confirm_count \+ 1/);
        });

        test('caps proposals so one long entry cannot flood the review queue', async () => {
            db.query.mockResolvedValue({ rows: [{ alias_id: 1 }] });

            await lexicon.proposeAliasesFromExpense({
                rawInput: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet',
                categoryId: 2,
                payee: null,
                employeeId: 1
            });

            expect(db.query.mock.calls.length).toBeLessThanOrEqual(lexicon.MAX_PROPOSALS_PER_PARSE);
        });

        test('does not propose unrelated words as payee nicknames', async () => {
            db.query.mockResolvedValue({ rows: [{ alias_id: 1 }] });

            await lexicon.proposeAliasesFromExpense({
                rawInput: 'bayad sa fibeco para sa kuryente',
                categoryId: 2,
                payee: 'FIBECO',
                employeeId: 1
            });

            const payeeProposals = db.query.mock.calls.filter(c => c[1] && c[1][1] === 'payee');
            expect(payeeProposals).toHaveLength(0);
        });

        test('does propose a genuine spelling variant as a payee nickname', async () => {
            db.query.mockResolvedValue({ rows: [{ alias_id: 1 }] });

            await lexicon.proposeAliasesFromExpense({
                rawInput: 'sent through gracecash yesterday',
                categoryId: 2,
                payee: 'Grace',
                employeeId: 1
            });

            const payeeProposals = db.query.mock.calls.filter(c => c[1] && c[1][1] === 'payee');
            expect(payeeProposals.length).toBeGreaterThan(0);
            expect(payeeProposals[0][1][0]).toBe('gracecash');
        });

        test('does nothing when there is no raw input', async () => {
            const result = await lexicon.proposeAliasesFromExpense({ rawInput: '', categoryId: 2 });
            expect(result).toEqual([]);
            expect(db.query).not.toHaveBeenCalled();
        });

        test('a failed proposal never propagates out to break expense saving', async () => {
            db.query.mockRejectedValue(new Error('db down'));
            await expect(lexicon.proposeAliasesFromExpense({
                rawInput: 'bayad sa kuryente', categoryId: 2, employeeId: 1
            })).resolves.toEqual([]);
        });
    });

    describe('getApprovedAliases', () => {
        test('requests approved rows only', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await lexicon.getApprovedAliases();
            expect(db.query.mock.calls[0][0]).toMatch(/status = 'approved'/);
        });
    });
});

describe('Expense lexicon routes', () => {
    beforeEach(() => jest.clearAllMocks());

    test('GET /expense-lexicon filters by status', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ alias_id: 1, term: 'kuryente', status: 'pending' }] });

        const res = await request(app).get('/api/expense-lexicon').query({ status: 'pending' });

        expect(res.status).toBe(200);
        expect(db.query.mock.calls[0][1]).toEqual(['pending']);
    });

    test('GET /expense-lexicon ignores an unknown status rather than injecting it', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        const res = await request(app).get('/api/expense-lexicon').query({ status: "'; DROP TABLE x; --" });
        expect(res.status).toBe(200);
        expect(db.query.mock.calls[0][1]).toEqual([]);
    });

    test('PUT /:id/review approves a term', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ alias_id: 1, term: 'kuryente', status: 'approved' }] });

        const res = await request(app).put('/api/expense-lexicon/1/review').send({ status: 'approved' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('approved');
    });

    test('PUT /:id/review rejects an invalid status', async () => {
        const res = await request(app).put('/api/expense-lexicon/1/review').send({ status: 'maybe' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/approved or rejected/i);
    });

    test('PUT /:id requires a target that matches the declared type', async () => {
        const res = await request(app)
            .put('/api/expense-lexicon/1')
            .send({ term: 'kuryente', target_type: 'category' }); // no category_id

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/category must be selected/i);
    });

    test('PUT /:id surfaces a friendly message on duplicate term collision', async () => {
        const dupErr = new Error('duplicate'); dupErr.code = '23505';
        db.query.mockRejectedValueOnce(dupErr);

        const res = await request(app)
            .put('/api/expense-lexicon/1')
            .send({ term: 'kuryente', target_type: 'category', category_id: 2 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already maps this term/i);
    });

    test('GET /expense-lexicon/pending-count returns the queue size', async () => {
        db.query.mockResolvedValueOnce({ rows: [{ pending: 7 }] });
        const res = await request(app).get('/api/expense-lexicon/pending-count');
        expect(res.status).toBe(200);
        expect(res.body.pending).toBe(7);
    });

    test('GET /expense-lexicon/accuracy returns the weekly acceptance trend', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ week_start: '2026-08-10', total_parses: 20, accepted: 17, acceptance_rate: 85.0 }]
        });
        const res = await request(app).get('/api/expense-lexicon/accuracy');
        expect(res.status).toBe(200);
        expect(res.body[0].acceptance_rate).toBe(85.0);
    });
});
