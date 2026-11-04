import { formatYearRange } from '../utils/engineCodeFormat.js';
import { getEngineCodeDisplay } from '../utils/engineCodeDisplay.js';
import { compareFitmentValues } from '../utils/fitmentDisplayOrder.js';

// Summaries include recorded values only; missing details add no placeholder.
function valuesFor(rows, getValue) {
    const values = new Map();
    for (const row of rows) {
        const value = String(getValue(row) || '').trim();
        if (!value) continue;
        if (!values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
    }
    return [...values.values()].sort(compareFitmentValues);
}

export function summarizeApplicationModel(rows = []) {
    const chassis = valuesFor(rows, row => row.chassis);
    const { codes: engines, text: engineText } = getEngineCodeDisplay(rows.map(row => row.engine));
    const classifications = [
        ['Years', row => formatYearRange(row.year_start, row.year_end)],
        ['Generation', row => row.generation],
        ['Variant', row => row.variant || row.variant_descriptor],
        ['Drive', row => row.drivetrain],
        ['Transmission', row => row.transmission],
        ['Fuel', row => row.fuel_type_qualifier || row.fuel_type],
        ['Displacement', row => {
            const value = row.displacement_liters_qualifier || row.displacement_liters;
            return value ? `${value}L` : '';
        }],
        ['Market', row => row.market],
    ].flatMap(([label, getValue]) => {
        const values = valuesFor(rows, getValue);
        return values.length ? [{ label, values }] : [];
    });

    return {
        chassis,
        engines,
        engineText,
        classifications,
    };
}
