export function parsePaymentTermsDays(terms) {
    if (!terms) return null;
    const m = String(terms).match(/(\d{1,4})/);
    if (m) return parseInt(m[1], 10);
    if (/due|upon/i.test(terms)) return 0;
    return null;
}

export default { parsePaymentTermsDays };
