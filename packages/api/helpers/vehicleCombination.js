'use strict';

// Reusable vehicle classification. Installation position belongs to the part link.
const COMBINATION_FIELDS = ['year_start', 'year_end', 'market', 'variant_descriptor', 'drivetrain', 'transmission', 'generation', 'fuel_type_qualifier', 'displacement_liters_qualifier'];

function normalizeCombination(input = {}) {
  const { deriveIdentityAndQualifierModes } = require('./fitmentRuleSchema');
  const error = message => Object.assign(new Error(message), { status: 422, code: 'INVALID_COMBINATION' });
  const year = value => {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) throw error('Years must be between 1900 and 2100');
    return n;
  };
  const year_start = year(input.year_start), year_end = year(input.year_end);
  if (year_start != null && year_end != null && year_start > year_end) throw error('Start year must not be after end year');
  for (const key of ['market', 'variant', 'variant_descriptor', 'drivetrain', 'transmission', 'generation']) {
    if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > 200)) throw error(`Invalid ${key}`);
  }
  const fuel = input.fuel_type_qualifier ?? input.fuel_type;
  if (fuel != null && fuel !== '' && !['diesel', 'gasoline', 'hybrid', 'electric', 'lpg', 'other'].includes(fuel)) throw error('Invalid fuel type');
  const displacement = input.displacement_liters_qualifier ?? input.displacement_liters;
  if (displacement != null && displacement !== '' && (!Number.isFinite(Number(displacement)) || Number(displacement) <= 0 || Number(displacement) >= 20 || Math.abs(Number(displacement) * 10 - Math.round(Number(displacement) * 10)) > 1e-8)) throw error('Displacement must be between 0 and 20 liters with at most one decimal place');
  const values = { ...deriveIdentityAndQualifierModes(input), year_start, year_end };
  return Object.fromEntries(COMBINATION_FIELDS.map(key => [key, values[key] ?? null]));
}

module.exports = { COMBINATION_FIELDS, normalizeCombination };
