const { parse } = require('../helpers/poLineParser');

describe('poLineParser', () => {
    test.each([
        ['10 NGK CPR8EA-9 @ 135', 10, 135, 'NGK CPR8EA-9', null, null, 'HIGH'],
        ['5 Motul 10W-40 1L @ 280', 5, 280, 'MOTUL 10W-40 1L', null, '1L', 'MEDIUM'],
        ['10 5L Gear Oil @ 450', 10, 450, '5L GEAR OIL', null, '5L', 'MEDIUM'],
        ['1 gal Hypoid Gear Oil @ 480', null, 480, '1 GAL HYPOID GEAR OIL', null, '1 GAL', 'LOW'],
        ['3 3/4 brake hose 5pcs @ 35', 5, 35, '3/4 BRAKE HOSE', 'PCS', null, 'HIGH'],
        ['35mm timing belt 2x @ 120', 2, 120, '35MM TIMING BELT', 'PCS', '35MM', 'HIGH'],
        ['Motul 3100 10W-40 1L 5btl @ 265', 5, 265, 'MOTUL 3100 10W-40 1L', 'BTL', '1L', 'HIGH'],
        ['10W-30 Gear Oil 4L 3pcs @ 520', 3, 520, '10W-30 GEAR OIL 4L', 'PCS', '4L', 'HIGH'],
        ['5/8 radiator hose 1m 3pcs @ 85', 3, 85, '5/8 RADIATOR HOSE 1M', 'PCS', '1M', 'HIGH'],
    ])('%s', (input, quantity, cost, description, orderUnit, packSize, confidence) => {
        expect(parse(input)).toEqual({
            quantity,
            cost_price: cost,
            raw_description: description,
            order_unit: orderUnit,
            pack_size: packSize,
            confidence,
        });
    });

    test('returns a safe low-confidence result for blank input', () => {
        expect(parse('   ')).toEqual({
            quantity: null,
            cost_price: null,
            raw_description: '',
            order_unit: null,
            pack_size: null,
            confidence: 'LOW',
        });
    });
});
