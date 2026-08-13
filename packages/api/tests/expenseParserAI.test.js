jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/ai/core/llmClient', () => ({ executeWithPool: jest.fn() }));
jest.mock('../services/ai/core/embeddingClient', () => ({ generateEmbeddingWithPool: jest.fn() }));
jest.mock('../services/expenseLexiconService', () => ({
    getApprovedAliases: jest.fn().mockResolvedValue([]),
    applyAliasesToParsed: jest.fn((rawInput, parsed) => ({ parsed, appliedAliases: [] }))
}));

const db = require('../db');
const llmClient = require('../services/ai/core/llmClient');
const embeddingClient = require('../services/ai/core/embeddingClient');
const expenseParserAI = require('../services/ai/features/expenseParserAI');

const CATEGORY_ROWS = { rows: [{ category_id: 2, category_name: 'Utilities', description: '' }] };
const PM_ROWS = { rows: [{ method_id: 1, name: 'Cash' }] };
const PAYEE_ROWS = { rows: [] };
const EMPTY_VECTOR_QUERY = { rows: [] };

function mockDbForParse() {
    db.query.mockImplementation((sql) => {
        if (/FROM expense_category/.test(sql)) return Promise.resolve(CATEGORY_ROWS);
        if (/FROM payment_methods/.test(sql)) return Promise.resolve(PM_ROWS);
        if (/FROM expense[\s\n]+WHERE is_void/.test(sql)) return Promise.resolve(PAYEE_ROWS);
        if (/FROM expense_ai_parse_log/.test(sql)) return Promise.resolve(EMPTY_VECTOR_QUERY);
        return Promise.resolve({ rows: [] });
    });
}

describe('ExpenseParserAI embedding reuse (parse -> save)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDbForParse();
        llmClient.executeWithPool.mockResolvedValue({
            data: {
                amount: 4500,
                category_name: 'Utilities',
                payee: 'FIBECO',
                payment_method_name: 'Cash',
                expense_date: '2026-08-13',
                confidence: { overall: 0.9, category: 0.9, amount: 0.9, date: 0.9, payment_method: 0.9 }
            },
            provider: 'test-provider'
        });
        embeddingClient.generateEmbeddingWithPool.mockResolvedValue({
            vector: [0.1, 0.2, 0.3],
            model: 'test-embed-model'
        });
    });

    test('parseExpenseText embeds the text exactly once', async () => {
        await expenseParserAI.parseExpenseText('Bayad 4500 sa fibeco para sa kuryente');
        expect(embeddingClient.generateEmbeddingWithPool).toHaveBeenCalledTimes(1);
    });

    test('logParseOutcome reuses the vector from a prior parse of the same text instead of re-embedding', async () => {
        const text = 'Bayad 4500 sa fibeco para sa kuryente';
        await expenseParserAI.parseExpenseText(text);
        expect(embeddingClient.generateEmbeddingWithPool).toHaveBeenCalledTimes(1);

        db.query.mockImplementation((sql) => {
            if (/INSERT INTO expense_ai_parse_log/.test(sql)) return Promise.resolve({ rows: [{ parse_id: 1 }] });
            return Promise.resolve({ rows: [] });
        });

        await expenseParserAI.logParseOutcome({
            rawInput: text,
            parsed: { category_id: 2, amount: 4500, payee: 'FIBECO' },
            final: { category_id: 2, amount: 4500, payee: 'FIBECO' },
            expenseId: 99,
            provider: 'test-provider',
            employeeId: 1
        });

        // Still exactly one call total across BOTH the parse and the save.
        expect(embeddingClient.generateEmbeddingWithPool).toHaveBeenCalledTimes(1);
    });

    test('a cached vector can only be reused once, so a second save falls back to a fresh embedding', async () => {
        const text = 'Bayad 4500 sa fibeco para sa kuryente';
        await expenseParserAI.parseExpenseText(text);

        db.query.mockImplementation((sql) => {
            if (/INSERT INTO expense_ai_parse_log/.test(sql)) return Promise.resolve({ rows: [{ parse_id: 1 }] });
            return Promise.resolve({ rows: [] });
        });

        await expenseParserAI.logParseOutcome({ rawInput: text, parsed: {}, final: {}, employeeId: 1 });
        await expenseParserAI.logParseOutcome({ rawInput: text, parsed: {}, final: {}, employeeId: 1 });

        // 1 for the parse + 1 for the second save (the cache entry was consumed by the first).
        expect(embeddingClient.generateEmbeddingWithPool).toHaveBeenCalledTimes(2);
    });

    test('logParseOutcome with unrelated text (no prior parse) still embeds fresh', async () => {
        db.query.mockImplementation((sql) => {
            if (/INSERT INTO expense_ai_parse_log/.test(sql)) return Promise.resolve({ rows: [{ parse_id: 1 }] });
            return Promise.resolve({ rows: [] });
        });

        await expenseParserAI.logParseOutcome({
            rawInput: 'a completely different expense never parsed before',
            parsed: {},
            final: {},
            employeeId: 1
        });

        expect(embeddingClient.generateEmbeddingWithPool).toHaveBeenCalledTimes(1);
    });
});

describe('ExpenseParserAI escalation and confidence handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDbForParse();
        embeddingClient.generateEmbeddingWithPool.mockResolvedValue({ vector: [0.1], model: 'test-embed-model' });
    });

    test('escalates when the amount is missing even if confidence looks fine', async () => {
        llmClient.executeWithPool
            .mockResolvedValueOnce({
                data: { amount: null, category_name: 'Utilities', confidence: { overall: 0.95 } },
                provider: 'primary'
            })
            .mockResolvedValueOnce({
                data: { amount: 4500, category_name: 'Utilities', confidence: { overall: 0.7 } },
                provider: 'escalated'
            });

        const result = await expenseParserAI.parseExpenseText('bayad sa kuryente pero walay klaro nga kantidad');

        expect(llmClient.executeWithPool).toHaveBeenCalledTimes(2);
        expect(llmClient.executeWithPool.mock.calls[1][0]).toBe('expense_reasoning_pool');
        // The escalated pass recovered the missing amount, so it should win.
        expect(result.parsed.amount).toBe(4500);
    });

    test('does not escalate when the parse already has amount, category, and high confidence', async () => {
        llmClient.executeWithPool.mockResolvedValueOnce({
            data: {
                amount: 4500,
                category_name: 'Utilities',
                confidence: { overall: 0.9, category: 0.9, amount: 0.9, date: 0.9, payment_method: 0.9 }
            },
            provider: 'primary'
        });

        await expenseParserAI.parseExpenseText('bayad 4500 sa fibeco');

        expect(llmClient.executeWithPool).toHaveBeenCalledTimes(1);
    });

    test('returns the raw input the user typed for the learning loop, not just the AI notes', async () => {
        llmClient.executeWithPool.mockResolvedValueOnce({
            data: { amount: 4500, category_name: 'Utilities', notes: 'Electricity bill payment', confidence: { overall: 0.9 } },
            provider: 'primary'
        });

        const result = await expenseParserAI.parseExpenseText('bayad 4500 sa fibeco para kuryente');

        expect(result.raw_input).toBe('bayad 4500 sa fibeco para kuryente');
        expect(result.parsed.notes).toBe('Electricity bill payment');
    });
});
