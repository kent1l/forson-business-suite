const { normalizeForSearch, expandIdentifierArray } = require('../helpers/normalizeSku');

const extractRawPartNumbers = (part) => {
    const raw = part?.part_numbers ?? part?.part_numbers_array;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    }
    if (Array.isArray(raw) && raw.length > 0) {
        return raw
            .map((p) => (typeof p === 'string' ? p : p?.part_number || ''))
            .map((p) => p.trim())
            .filter(Boolean);
    }
    if (typeof part?.display_name === 'string' && part.display_name.includes(' | ')) {
        const sections = part.display_name.split(' | ').map((s) => s.trim()).filter(Boolean);
        const hasDetail = Boolean(typeof part?.detail === 'string' && part.detail.trim());
        if (sections.length >= 3 || (sections.length === 2 && !hasDetail)) {
            return sections[1]
                .replace(/\.\.\.$/, '')
                .split(/[;,]/)
                .map((p) => p.trim())
                .filter(Boolean);
        }
    }
    return [];
};

module.exports = {
    normalizePartData: (part = {}) => {
        const rawPartNumbers = extractRawPartNumbers(part);
        return {
            normalized_internal_sku: normalizeForSearch(part?.internal_sku),
            normalized_part_numbers: expandIdentifierArray(
                [...rawPartNumbers, part?.internal_sku].filter(Boolean)
            ),
            normalized_detail: expandIdentifierArray(
                [part?.detail, part?.brand_name, part?.group_name].filter(Boolean)
            )
        };
    }
};
