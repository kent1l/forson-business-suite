'use strict';

function normalizeText(value) {
    return typeof value === 'string'
        ? value.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().trim()
        : '';
}

// Preserve words and prefixes: shorthand business names need explicit reconciliation.
function normalizePartyName(value) {
    return normalizeText(value)
        .replace(/&/g, ' AND ')
        .replace(/\bCORPORATION\b/g, 'CORP')
        .replace(/\bINCORPORATED\b/g, 'INC')
        .replace(/[^A-Z0-9]/g, '');
}

function normalizeReceiptIdentifier(value) {
    const text = normalizeText(value);
    if (!text || /^(?:N\/?A|NONE|NULL)$/.test(text)) return '';
    return text.replace(/[^A-Z0-9]/g, '').replace(/\d+/g, digits => digits.replace(/^0+(?=\d)/, ''));
}

module.exports = { normalizePartyName, normalizeReceiptIdentifier };
