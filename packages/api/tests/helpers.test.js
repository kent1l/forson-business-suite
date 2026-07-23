const { normalizeForSearch, normalizeArray, EXACT_MATCH_MIN_LENGTH } = require('../helpers/normalizeSku');
const { parsePaginationQuery, buildPaginationMeta, paginatedResponse, DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../helpers/pagination');
const { formatPhysicalReceiptNumber } = require('../helpers/receiptNumberFormatter');
const { generateUniqueCode } = require('../helpers/codeGenerator');
const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');

describe('Helper Utilities Unit Tests', () => {
    describe('normalizeSku', () => {
        test('normalizeForSearch strips special chars and converts to lowercase', () => {
            expect(normalizeForSearch('SKU-123-ABC!')).toBe('sku123abc');
            expect(normalizeForSearch('  Part # 456  ')).toBe('part456');
            expect(normalizeForSearch(null)).toBe('');
            expect(normalizeForSearch(undefined)).toBe('');
            expect(normalizeForSearch(123)).toBe('');
        });

        test('normalizeArray filters short and empty strings', () => {
            const inputs = ['SKU-123', 'ab', '!', 'PART-456'];
            const normalized = normalizeArray(inputs);
            expect(normalized).toEqual(['sku123', 'part456']);
            expect(normalizeArray(null)).toEqual([]);
        });

        test('EXACT_MATCH_MIN_LENGTH constant is defined', () => {
            expect(EXACT_MATCH_MIN_LENGTH).toBe(3);
        });
    });

    describe('pagination', () => {
        test('parsePaginationQuery sets default values', () => {
            const result = parsePaginationQuery({});
            expect(result).toEqual({
                page: 1,
                pageSize: 25,
                offset: 0,
                limit: 25,
                paginated: false
            });
        });

        test('parsePaginationQuery clamps max pageSize and min page', () => {
            const result = parsePaginationQuery({ page: '-5', pageSize: '500', paginated: 'true' });
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(MAX_PAGE_SIZE);
            expect(result.offset).toBe(0);
            expect(result.paginated).toBe(true);
        });

        test('buildPaginationMeta calculates totalPages accurately', () => {
            const meta = buildPaginationMeta({ page: 2, pageSize: 10, total: 25 });
            expect(meta).toEqual({
                page: 2,
                pageSize: 10,
                total: 25,
                totalPages: 3
            });
        });

        test('paginatedResponse structures response object correctly', () => {
            const response = paginatedResponse({ data: [1, 2, 3], page: 1, pageSize: 10, total: 3 });
            expect(response).toEqual({
                data: [1, 2, 3],
                page: 1,
                pageSize: 10,
                total: 3,
                totalPages: 1
            });
        });
    });

    describe('receiptNumberFormatter', () => {
        test('formatPhysicalReceiptNumber normalizes receipt numbers', () => {
            expect(formatPhysicalReceiptNumber('SI 1234')).toBe('SI-1234');
            expect(formatPhysicalReceiptNumber('si-001234')).toBe('SI-1234');
            expect(formatPhysicalReceiptNumber('  OR/5678 ')).toBe('OR-5678');
            expect(formatPhysicalReceiptNumber('12345')).toBe('12345');
        });

        test('formatPhysicalReceiptNumber handles empty and invalid inputs', () => {
            expect(formatPhysicalReceiptNumber('')).toBeNull();
            expect(formatPhysicalReceiptNumber('   ')).toBeNull();
            expect(formatPhysicalReceiptNumber(null)).toBeNull();
            expect(formatPhysicalReceiptNumber(undefined)).toBeNull();
        });
    });

    describe('codeGenerator', () => {
        test('generateUniqueCode produces unique 4-character base codes', async () => {
            const mockClient = {
                query: jest.fn().mockResolvedValue({ rows: [] })
            };
            const code = await generateUniqueCode(mockClient, 'Brake Pads', 'group', 'group_code');
            expect(code).toBe('BRPA');
            expect(mockClient.query).toHaveBeenCalledWith(
                'SELECT 1 FROM "group" WHERE group_code = $1',
                ['BRPA']
            );
        });

        test('generateUniqueCode resolves conflicts with counter suffix', async () => {
            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [{ exists: 1 }] }) // BRPA exists
                    .mockResolvedValueOnce({ rows: [] })               // BRP1 free
            };
            const code = await generateUniqueCode(mockClient, 'Brake Pads', 'group', 'group_code');
            expect(code).toBe('BRP1');
        });
    });

    describe('documentNumberGenerator', () => {
        test('getNextDocumentNumber generates incremented document numbers', async () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const period = `${year}${month}`;

            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [{ last_number: 4 }] }) // existing sequence
                    .mockResolvedValueOnce({ rows: [] })
            };

            const docNum = await getNextDocumentNumber(mockClient, 'GRN');
            expect(docNum).toBe(`GRN-${period}-0005`);
            expect(mockClient.query).toHaveBeenNthCalledWith(
                1,
                'SELECT last_number FROM document_sequence WHERE prefix = $1 AND period = $2 FOR UPDATE',
                ['GRN', period]
            );
            expect(mockClient.query).toHaveBeenNthCalledWith(
                2,
                'UPDATE document_sequence SET last_number = $1 WHERE prefix = $2 AND period = $3',
                [5, 'GRN', period]
            );
        });

        test('getNextDocumentNumber initializes new sequence when none exists', async () => {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const period = `${year}${month}`;

            const mockClient = {
                query: jest.fn()
                    .mockResolvedValueOnce({ rows: [] }) // no existing sequence
                    .mockResolvedValueOnce({ rows: [] })
            };

            const docNum = await getNextDocumentNumber(mockClient, 'INV');
            expect(docNum).toBe(`INV-${period}-0001`);
            expect(mockClient.query).toHaveBeenNthCalledWith(
                2,
                'INSERT INTO document_sequence (prefix, period, last_number) VALUES ($1, $2, $3)',
                ['INV', period, 1]
            );
        });
    });
});
