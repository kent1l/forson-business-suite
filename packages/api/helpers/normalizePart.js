const { normalizeForSearch, normalizeArray } = require('../helpers/normalizeSku');

module.exports = {
    normalizePartData: (part) => {
        return {
            normalized_internal_sku: normalizeForSearch(part.internal_sku),
            normalized_part_numbers: normalizeArray(part.part_numbers ? part.part_numbers.split(';').map(p => p.trim()) : [])
        };
    }
};
