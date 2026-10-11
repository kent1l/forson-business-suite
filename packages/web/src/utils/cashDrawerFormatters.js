/**
 * Format reference text for cash drawer movements.
 * Combines transaction number (e.g. invoice, credit note, AR, AP, expense)
 * and physical receipt/reference with a slash: e.g. "INV-202610-0001/DR-1234".
 *
 * @param {object|null|undefined} item - The movement object
 * @returns {string} Formatted reference text
 */
export function formatMovementReference(item) {
    if (!item) return '—';

    const txNumber = (
        item.invoice_number ||
        item.cn_number ||
        item.customer_payment_reference ||
        item.expense_reference ||
        item.ap_payment_reference ||
        null
    );

    const physicalReceipt = (
        item.physical_reference ||
        item.invoice_physical_receipt_no ||
        item.customer_payment_receipt_no ||
        null
    );

    if (txNumber && physicalReceipt) {
        if (String(txNumber).trim().toLowerCase() === String(physicalReceipt).trim().toLowerCase()) {
            return String(txNumber).trim();
        }
        return `${String(txNumber).trim()}/${String(physicalReceipt).trim()}`;
    }

    if (txNumber) return String(txNumber).trim();
    if (physicalReceipt) return String(physicalReceipt).trim();

    if (item.reversal_of) {
        return `Reversal of #${item.reversal_of}`;
    }

    return '—';
}

/**
 * Format a date string in Asia/Manila time zone.
 *
 * @param {string|Date|null|undefined} value
 * @returns {string} Formatted date (e.g. "10/9/2026") or "—"
 */
export function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
}

/**
 * Format a time string in Asia/Manila time zone.
 *
 * @param {string|Date|null|undefined} value
 * @returns {string} Formatted time (e.g. "4:01:34 PM") or ""
 */
export function formatTimeOnly(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' });
}
