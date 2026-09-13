const { parse } = require('../helpers/poLineParser');

describe('poLineParser', () => {
    test.each([
        ['10 NGK CPR8EA-9 @ 135', 10, 135, 'NGK CPR8EA-9', 'HIGH'],
        ['5 Motul 10W-40 1L @ 280', 5, 280, 'Motul 10W-40 1L', 'MEDIUM'],
        ['10 5L Gear Oil @ 450', 10, 450, '5L Gear Oil', 'MEDIUM'],
        ['1 gal Hypoid Gear Oil @ 480', null, 480, '1 gal Hypoid Gear Oil', 'LOW'],
        ['3 3/4 brake hose 5pcs @ 35', 5, 35, '3/4 brake hose', 'HIGH'],
        ['35mm timing belt 2x @ 120', 2, 120, '35mm timing belt', 'HIGH'],
        ['Motul 3100 10W-40 1L 5btl @ 265', 5, 265, 'Motul 3100 10W-40 1L', 'HIGH'],
        ['10W-30 Gear Oil 4L 3pcs @ 520', 3, 520, '10W-30 Gear Oil 4L', 'HIGH'],
        ['5/8 radiator hose 1m 3pcs @ 85', 3, 85, '5/8 radiator hose 1m', 'HIGH'],
    ])('%s', (input, quantity, cost, description, confidence) => {
        expect(parse(input)).toEqual({
            quantity,
            cost_price: cost,
            raw_description: description,
            confidence,
        });
    });

    test('returns a safe low-confidence result for blank input', () => {
        expect(parse('   ')).toEqual({
            quantity: null,
            cost_price: null,
            raw_description: '',
            confidence: 'LOW',
        });
    });
});
