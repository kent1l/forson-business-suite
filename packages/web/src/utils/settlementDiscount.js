/**
 * The arithmetic of forgiving part of a balance while collecting the rest.
 *
 * Built as a sibling of withholdingSettlement.js, and for the same reason: this
 * is where the mistake would be silent. A discount that overshoots the balance
 * does not throw, it over-settles an invoice; one that quietly eats into the
 * withheld tax leaves a BIR certificate short. Both surfaces that grant
 * concessions -- the A/R collection modal and the POS split-payment modal --
 * call these, so the counter and the back office cannot drift apart on what a
 * peso of concession means.
 *
 * The invariant everything below serves:
 *
 *     cash applied + tax withheld + discount  <=  invoice balance
 *
 * Withholding comes first in that sum and is never reduced to make room for a
 * discount. The deduction is a function of the invoice's VAT-exclusive base,
 * which a post-invoice concession does not change (no output-VAT adjustment is
 * made for one), so the discount can only take what the tax leaves behind.
 */

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const balanceOf = (invoice) =>
    Number(invoice?.balance_due ?? invoice?.outstanding ?? 0) || 0;

/**
 * The largest concession this invoice can still take, given what the cash and
 * the tax certificate already cover.
 *
 * Never negative: an invoice already settled by cash has no room to forgive,
 * and offering a negative ceiling would let a caller's `Math.min` produce one.
 */
export function maxDiscountFor(invoice, cashApplied = 0, withheld = 0) {
    const room = balanceOf(invoice) - (Number(cashApplied) || 0) - (Number(withheld) || 0);
    return Math.max(round2(room), 0);
}

/**
 * The figure the "Settle" shortcut fills in: exactly what is left owing once
 * the cash counted and the tax withheld are applied.
 *
 * This is the one number in the collection form the system is entitled to
 * assert. The cash is an observation of what the clerk physically received and
 * is never pre-filled; the concession is arithmetic, and derived from it.
 */
export function discountToSettle(invoice, cashApplied = 0, withheld = 0) {
    return maxDiscountFor(invoice, cashApplied, withheld);
}

/**
 * Client-side mirror of the server's rules, so the form can explain itself
 * rather than letting the clerk find out by being rejected.
 *
 * Deliberately a mirror and not the authority: the server re-checks every one
 * of these against the database, where the balance is actually known.
 *
 * @param {Array}  invoices        rows carrying invoice_id, invoice_number, balance_due
 * @param {Object} discountByInvoice   invoice_id -> concession (number or numeric string)
 * @param {Object} opts
 * @param {Object} [opts.cashByInvoice]      invoice_id -> cash applied
 * @param {Object} [opts.withheldByInvoice]  invoice_id -> tax withheld
 * @param {Object} [opts.reason]     the selected ar_adjustment_reason row, if any
 * @param {string} [opts.notes]
 * @param {number} [opts.minNoteLength]
 * @returns {{ total: number, problems: string[], byInvoice: Object }}
 */
export function validateDiscounts(invoices, discountByInvoice = {}, opts = {}) {
    const {
        cashByInvoice = {},
        withheldByInvoice = {},
        reason = null,
        notes = '',
        minNoteLength = 10,
        formatCurrency = (n) => `₱${Number(n || 0).toFixed(2)}`,
    } = opts;

    const problems = [];
    const byInvoice = {};
    let total = 0;

    for (const inv of invoices || []) {
        const key = String(inv.invoice_id);
        const amount = round2(parseFloat(discountByInvoice[key] ?? discountByInvoice[inv.invoice_id]) || 0);
        if (amount <= 0) continue;

        byInvoice[key] = amount;
        total = round2(total + amount);

        const cash = Number(cashByInvoice[key] ?? cashByInvoice[inv.invoice_id]) || 0;
        const withheld = Number(withheldByInvoice[key] ?? withheldByInvoice[inv.invoice_id]) || 0;
        const room = maxDiscountFor(inv, cash, withheld);

        if (amount > room + 0.005) {
            problems.push(
                `${inv.invoice_number || `Invoice #${inv.invoice_id}`}: ${formatCurrency(amount)} is more than the ` +
                `${formatCurrency(room)} left after ${formatCurrency(cash)} cash` +
                (withheld > 0 ? ` and ${formatCurrency(withheld)} withheld` : '') + '.'
            );
        }
    }

    if (total > 0) {
        if (!reason) {
            problems.push('Choose a reason for the concession.');
        } else {
            if (reason.max_amount != null && total > Number(reason.max_amount) + 0.005) {
                problems.push(`${reason.label} is capped at ${formatCurrency(reason.max_amount)}.`);
            }
            if (reason.requires_note && String(notes || '').trim().length < minNoteLength) {
                problems.push(`${reason.label} needs a note of at least ${minNoteLength} characters.`);
            }
        }
    }

    return { total, problems, byInvoice };
}

/** The payload shape POST /payments and POST /invoices both expect. */
export function discountsPayload(byInvoice = {}) {
    return Object.entries(byInvoice)
        .map(([invoice_id, amount]) => ({ invoice_id: Number(invoice_id), amount: round2(amount) }))
        .filter(d => d.invoice_id && d.amount > 0);
}
