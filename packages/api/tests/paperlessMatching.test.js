const { normalizePartyName, normalizeReceiptIdentifier } = require('../helpers/paperlessMatching');

test.each([
    ['Ramline Resources, Inc.', 'RAM-LINE RESOURCES INC.'],
    ['PYRUS AUTO SPARE PARTS', 'PYRUS AUTOSPAREPARTS'],
    ['Armtech Auto Parts & Services Inc.', 'ARMTECH AUTO PARTS AND SERVICES INC.'],
    ['Café Corporation', 'CAFE CORP.'],
])('party normalization equates %s and %s', (a, b) => {
    expect(normalizePartyName(a)).toBe(normalizePartyName(b));
});

test.each([
    ['GMAP', 'GMAP AUTO PARTS TRADING'],
    ['BJ AUTO PARTS', 'BJ AUTO PARTS SUPPLY'],
    ['GEO PARTS', 'GEO PARTS SALES INC.'],
])('party normalization preserves meaningful words: %s and %s', (a, b) => {
    expect(normalizePartyName(a)).not.toBe(normalizePartyName(b));
});

test.each([
    ['DR_000123', 'dr / 123'], ['TRA52367', 'tra-052367'], ['006401', '6401'],
])('receipt normalization equates %s and %s', (a, b) => {
    expect(normalizeReceiptIdentifier(a)).toBe(normalizeReceiptIdentifier(b));
});

test('receipt normalization preserves prefixes and full numbers', () => {
    expect(normalizeReceiptIdentifier('DR-123')).not.toBe(normalizeReceiptIdentifier('SI-123'));
    expect(normalizeReceiptIdentifier('123')).not.toBe(normalizeReceiptIdentifier('1234'));
    expect(normalizeReceiptIdentifier('N/A')).toBe('');
});
