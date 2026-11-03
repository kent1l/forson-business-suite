import { compressEngineCodes, formatYearRange } from '../utils/engineCodeFormat.js';

const compare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Unknown values stay explicit: a missing qualifier never means "all".
function valuesFor(rows, getValue) {
    const values = new Map();
    for (const row of rows) {
        const value = String(getValue(row) || '').trim() || 'Not specified';
        if (!values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
    }
    return [...values.values()].sort(compare);
}

export function summarizeApplicationModel(rows = []) {
    const chassis = valuesFor(rows, row => row.chassis);
    const engines = valuesFor(rows, row => row.engine);
    const knownEngines = engines.filter(value => value !== 'Not specified');
    const engineText = compressEngineCodes(knownEngines) || knownEngines.join(', ');
    const classifications = [
        ['Years', row => formatYearRange(row.year_start, row.year_end)],
        ['Variant', row => row.variant || row.variant_descriptor],
        ['Drive', row => row.drivetrain],
        ['Transmission', row => row.transmission],
        ['Market', row => row.market],
        ['Generation', row => row.generation],
        ['Fuel', row => row.fuel_type_qualifier || row.fuel_type],
        ['Displacement', row => {
            const value = row.displacement_liters_qualifier || row.displacement_liters;
            return value ? `${value}L` : '';
        }],
    ].flatMap(([label, getValue]) => {
        const values = valuesFor(rows, getValue);
        return values.every(value => value === 'Not specified') ? [] : [{ label, values }];
    });

    return {
        chassis,
        engines,
        engineText: [engineText, engines.includes('Not specified') ? 'Not specified' : ''].filter(Boolean).join(', '),
        classifications,
    };
}
