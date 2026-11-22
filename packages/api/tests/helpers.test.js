const {
    normalizeForSearch,
    normalizeArray,
    expandIdentifierTokens,
    expandIdentifierArray,
    buildSearchQueryVariants,
    searchPartsWithVariants,
    EXACT_MATCH_MIN_LENGTH
} = require('../helpers/normalizeSku');
const { normalizePartData } = require('../helpers/normalizePart');
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

        test('expandIdentifierTokens decomposes hyphenated, concatenated, and prefixed identifiers', () => {
            expect(expandIdentifierTokens('VK-9001')).toEqual(expect.arrayContaining(['vk9001', 'vk', '9001']));
            expect(expandIdentifierTokens('VK9001')).toEqual(expect.arrayContaining(['vk9001', 'vk', '9001']));
            expect(expandIdentifierTokens('VA8704K')).toEqual(expect.arrayContaining(['va8704k', 'va', '8704', '8704k', 'va8704']));
            expect(expandIdentifierTokens('41120-VK101')).toEqual(expect.arrayContaining(['41120vk101', '41120', 'vk101', 'vk', '101']));
            expect(expandIdentifierTokens('SF-M505')).toEqual(expect.arrayContaining(['sfm505', 'sf', 'm505', '505', 'sfm']));
            expect(expandIdentifierTokens('VK-9919 (REAR)')).toEqual(expect.arrayContaining(['vk9919rear', 'vk', '9919', 'rear', 'vk9919', '9919rear']));
            expect(expandIdentifierTokens('')).toEqual([]);
            expect(expandIdentifierTokens(null)).toEqual([]);
        });

        test('expandIdentifierArray handles semicolon-delimited strings and object arrays', () => {
            expect(expandIdentifierArray('ST-100; VK-9001')).toEqual(
                expect.arrayContaining(['st100', 'st', '100', 'vk9001', 'vk', '9001'])
            );
            expect(expandIdentifierArray([{ part_number: 'VK-9001' }, { part_number: 'VA8704K' }])).toEqual(
                expect.arrayContaining(['vk9001', 'vk', '9001', 'va8704k', '8704'])
            );
        });

        test('normalizePartData generates consistent tokens for both VK-9001 and VK9001 and falls back to display_name', () => {
            const hyphenated = normalizePartData({
                internal_sku: 'BRSH-NUPR-0001',
                part_numbers: 'VK-9001',
                detail: 'REAR',
                brand_name: 'NUVO PRO',
                group_name: 'BRAKE SHOE'
            });
            const concatenated = normalizePartData({
                internal_sku: 'BRSH-NUPR-0001',
                part_numbers: 'VK9001',
                detail: 'REAR',
                brand_name: 'NUVO PRO',
                group_name: 'BRAKE SHOE'
            });

            for (const result of [hyphenated, concatenated]) {
                expect(result.normalized_internal_sku).toBe('brshnupr0001');
                expect(result.normalized_part_numbers).toEqual(expect.arrayContaining(['vk9001', 'vk', '9001', 'brshnupr0001']));
                expect(result.normalized_detail).toEqual(expect.arrayContaining(['rear', 'nuvopro', 'nuvo', 'pro', 'brakeshoe']));
            }

            const fromDisplayName = normalizePartData({
                internal_sku: 'BRSH-NUPR-0002',
                display_name: 'BRAKE SHOE (NUVO PRO) | VK-9001, ST-100 | REAR',
                detail: 'REAR'
            });
            expect(fromDisplayName.normalized_part_numbers).toEqual(expect.arrayContaining(['vk9001', '9001', 'vk', 'st100', '100']));
        });

        test('buildSearchQueryVariants produces spaced and collapsed variants capped at 3', () => {
            expect(buildSearchQueryVariants('')).toEqual(['']);
            expect(buildSearchQueryVariants('9001')).toEqual(['9001']);
            expect(buildSearchQueryVariants('vk9001')).toEqual(['vk9001', 'vk 9001']);
            expect(buildSearchQueryVariants('vk 9001')).toEqual(['vk 9001', 'vk9001']);
            expect(buildSearchQueryVariants('VK-9001')).toEqual(['VK-9001', 'VK9001', 'VK 9001']);
            expect(buildSearchQueryVariants('41120-VK101')).toEqual(['41120-VK101', '41120VK101', '41120 VK 101']);
            expect(buildSearchQueryVariants('nuvo pro')).toEqual(['nuvo pro', 'nuvopro']);
        });

        test('searchPartsWithVariants merges, deduplicates, and falls back to matchingStrategy last', async () => {
            const mockIndex = {
                search: jest.fn()
                    .mockResolvedValueOnce({
                        hits: [{ part_id: 2, _rankingScore: 0.7 }],
                        estimatedTotalHits: 1
                    })
                    .mockResolvedValueOnce({
                        hits: [
                            { part_id: 1, _rankingScore: 0.95 },
                            { part_id: 2, _rankingScore: 0.6 }
                        ],
                        estimatedTotalHits: 2
                    })
            };

            const merged = await searchPartsWithVariants(mockIndex, 'vk9001', { limit: 10, matchingStrategy: 'all' });
            expect(mockIndex.search).toHaveBeenCalledTimes(2);
            expect(merged.hits.map(h => h.part_id)).toEqual([1, 2]);
            expect(merged.estimatedTotalHits).toBe(2);

            const fallbackIndex = {
                search: jest.fn()
                    .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 })
                    .mockResolvedValueOnce({ hits: [], estimatedTotalHits: 0 })
                    .mockResolvedValueOnce({ hits: [{ part_id: 99 }], estimatedTotalHits: 1 })
            };
            const fallback = await searchPartsWithVariants(fallbackIndex, 'vk 9001', { limit: 10, matchingStrategy: 'all' });
            expect(fallbackIndex.search).toHaveBeenLastCalledWith('vk 9001', expect.objectContaining({ matchingStrategy: 'last' }));
            expect(fallback.hits.map(h => h.part_id)).toEqual([99]);
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
            expect(formatPhysicalReceiptNumber('crv 0012')).toBe('CRV-12');
            expect(formatPhysicalReceiptNumber('ORPMT 0045')).toBe('ORPMT-45');
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
