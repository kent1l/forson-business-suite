const { paginateReferences } = require('../helpers/receiptMonitorPagination');

describe('Receipt range search and sorting', () => {
    test('matches a brute-force oracle across digit boundaries, statuses and both sort directions', () => {
        const min = 9n, max = 137n;
        const records = new Map([['10', { status: 'ISSUED' }], ['111', { status: 'VOIDED' }], ['33', { status: 'SPOILED' }]]);
        for (const search of ['', '1', '11', '0', 'SI', 'I-1', 'SI-12', '-', '%', '999']) {
            for (const status of ['ALL', 'NO_RECORD', 'ISSUED', 'SPOILED', 'VOIDED']) {
                for (const sortBy of ['reference', 'status']) {
                    for (const sortOrder of ['asc', 'desc']) {
                        const expected = [];
                        for (let n = min; n <= max; n++) {
                            const state = records.get(String(n))?.status || 'NO_RECORD';
                            if ((status === 'ALL' || status === state) && `SI-${n}`.includes(search)) expected.push({ serial: n, status: state });
                        }
                        expected.sort((a, b) => (sortBy === 'status' ? a.status.localeCompare(b.status) : 0) || (a.serial < b.serial ? -1 : 1));
                        if (sortOrder === 'desc') expected.reverse();
                        for (const page of [1, 2, 6]) {
                            const result = paginateReferences(records, min, max, { prefix: 'SI', search, status, sortBy, sortOrder, page });
                            expect({ search, status, sortBy, sortOrder, page, total: String(result.total), serials: result.serials }).toEqual({
                                search, status, sortBy, sortOrder, page, total: String(expected.length),
                                serials: expected.slice((page - 1) * 25, page * 25).map(row => String(row.serial)),
                            });
                        }
                    }
                }
            }
        }
    });
    test('keeps full bigint precision when finding a substring near the upper bound', () => {
        const max = 9223372036854775807n;
        const result = paginateReferences(new Map(), 1n, max, { prefix: 'SI', search: String(max), status: 'ALL', sortBy: 'reference', sortOrder: 'desc', page: 1 });
        expect(result.total).toBe(1n); expect(result.serials).toEqual([String(max)]);
    });
});
