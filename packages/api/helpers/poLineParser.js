'use strict';

const ORDER_UNITS = '(?:pcs?|bxs?|boxes?|btls?|sets?|pairs?|rolls?|drums?|cans?|bags?|units?|ea|x)';
const PRODUCT_UNITS = '(?:ml|l|liters?|gal|gallons?|oz|fl\\.?oz|cc|pails?|qt|mm|cm|m|in|inches?|ft|g|grams?|kg|lbs?)';

function normalizeSpaces(value) {
    return value.replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
    return normalizeSpaces(value).split(' ').filter(Boolean);
}

function classifyNumbers(tokens) {
    return tokens.map((token, index) => {
        const next = tokens[index + 1] || '';
        if (/^\d+\/\d+$/.test(token) || /^\d+W[-–]\d+$/i.test(token)) return { token, type: 'PRODUCT_ATTR' };
        if (new RegExp(`^\\d+(?:\\.\\d+)?${ORDER_UNITS}$`, 'i').test(token)
            || (/^\d+(?:\.\d+)?$/.test(token) && new RegExp(`^${ORDER_UNITS}$`, 'i').test(next))) {
            return { token, type: 'ORDER_QTY' };
        }
        if (new RegExp(`^\\d+(?:\\.\\d+)?${PRODUCT_UNITS}(?:["'])?$`, 'i').test(token)
            || (/^\d+(?:\.\d+)?$/.test(token) && new RegExp(`^${PRODUCT_UNITS}$`, 'i').test(next))) {
            return { token, type: 'PRODUCT_ATTR' };
        }
        return /^\d+(?:\.\d+)?$/.test(token) ? { token, type: 'BARE_NUMBER' } : { token, type: 'TEXT' };
    });
}

function extractPrice(value) {
    const patterns = [
        /(?:^|\s)@\s*₱?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*$/i,
        /(?:^|\s)P\s*:\s*₱?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*$/i,
        /(?:^|\s)SRP\s+₱?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*$/i,
        /(?:^|\s)₱?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*\/\s*ea\s*$/i,
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) {
            return {
                cost_price: Number(match[1].replace(/,/g, '')),
                text: normalizeSpaces(value.slice(0, match.index) + value.slice(match.index + match[0].length)),
            };
        }
    }
    return { cost_price: null, text: normalizeSpaces(value) };
}

function isProductAttributeStart(value) {
    return new RegExp(`^(?:\\d+\\/\\d+|\\d+W[-–]\\d+|\\d+(?:\\.\\d+)?\\s*${PRODUCT_UNITS})(?:\\b|["'])`, 'i').test(value);
}

function extractQuantity(value, classifications = classifyNumbers(tokenize(value))) {
    const explicit = value.match(new RegExp(`(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*${ORDER_UNITS}(?=\\s|$)`, 'i'));
    if (explicit) {
        const start = explicit.index + (explicit[0].startsWith(' ') ? 1 : 0);
        const matchedText = explicit[0].trim();
        let remainder = normalizeSpaces(value.slice(0, start) + value.slice(start + matchedText.length));
        // When an explicit order unit appears later, a stray leading integer before
        // a fraction is an abandoned quantity candidate ("3 3/4 ... 5pcs"). The
        // fraction itself remains a product dimension.
        remainder = remainder.replace(/^\d+\s+(?=\d+\/\d+\b)/, '');
        return {
            quantity: Number(explicit[1]),
            confidence: 'HIGH',
            text: remainder,
        };
    }

    if (classifications[0]?.type === 'PRODUCT_ATTR' || isProductAttributeStart(value)) {
        return { quantity: null, confidence: 'LOW', text: value };
    }

    const leading = value.match(/^(\d+)\s+(.+)$/);
    if (leading) {
        const remainder = leading[2].trim();
        const containsProductAttribute = new RegExp(`(?:^|\\s)(?:\\d+\\/\\d+|\\d+W[-–]\\d+|\\d+(?:\\.\\d+)?\\s*${PRODUCT_UNITS})(?:\\b|["'])`, 'i').test(remainder);
        return {
            quantity: Number(leading[1]),
            confidence: containsProductAttribute ? 'MEDIUM' : 'HIGH',
            text: remainder,
        };
    }

    return { quantity: null, confidence: 'LOW', text: value };
}

function buildRawDescription(value) {
    return normalizeSpaces(value);
}

function parse(rawLine) {
    const source = typeof rawLine === 'string' ? normalizeSpaces(rawLine) : '';
    if (!source) {
        return { quantity: null, cost_price: null, raw_description: '', confidence: 'LOW' };
    }

    const price = extractPrice(source);
    const quantity = extractQuantity(price.text, classifyNumbers(tokenize(price.text)));
    return {
        quantity: quantity.quantity,
        cost_price: price.cost_price,
        raw_description: buildRawDescription(quantity.text),
        confidence: quantity.confidence,
    };
}

module.exports = { parse };
