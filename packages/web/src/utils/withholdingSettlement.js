/**
 * Splitting a customer's payment between cash and tax withheld at source.
 *
 * Kept out of the form because the arithmetic is where this goes wrong, and it goes
 * wrong quietly: a mistake here does not throw, it silently manufactures store-wallet
 * credit or leaves an invoice short. Pure functions so the cases can be pinned down
 * in tests -- see packages/web/tests/withholdingSettlement.test.js.
 *
 * The invariant everything below serves:
 *
 *     cash applied + tax withheld  <=  invoice balance
 *
 * Being a withholding agent means a customer MAY deduct, not that they always did.
 * They routinely just pay in full, and the settlement has to accept that without
 * inventing an overpayment.
 */

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/**
 * The cash a single invoice can bring in, once the expected deduction is taken off.
 *
 * A withholding customer never sends the gross balance. Allocating against the gross
 * makes every such payment look short by exactly the withheld amount.
 */
export function cashCapFor(invoice, expected) {
    const balance = Number(invoice.balance_due) || 0;
    if (!expected) return balance;
    return Math.max(round2(balance - Number(expected.remaining_expected)), 0);
}

/**
 * Spread cash received across outstanding invoices, oldest first.
 *
 * Two passes, and both are needed:
 *
 *   Pass 1 fills each invoice only to its NET requirement. This is what makes one net
 *   cheque covering several invoices land correctly -- filling the first to its gross
 *   balance would swallow the cash meant for the second and leave it short.
 *
 *   Pass 2 tops invoices up towards their GROSS balance with whatever is left. This is
 *   the customer who did not withhold this time and simply paid the full amount;
 *   without it their surplus reads as an overpayment and is pushed into a store wallet.
 *
 * @returns {Object} invoice_id -> cash allocated (number)
 */
export function allocateCash(invoices, amount, expectedByInvoice = {}) {
    const next = {};
    let remaining = Number(amount) || 0;

    for (const inv of invoices) {
        if (remaining <= 0.005) break;
        const add = Math.min(remaining, cashCapFor(inv, expectedByInvoice[String(inv.invoice_id)]));
        if (add > 0) {
            next[inv.invoice_id] = round2(add);
            remaining = round2(remaining - add);
        }
    }

    for (const inv of invoices) {
        if (remaining <= 0.005) break;
        const balance = Number(inv.balance_due) || 0;
        const add = Math.min(remaining, round2(balance - (next[inv.invoice_id] || 0)));
        if (add > 0) {
            next[inv.invoice_id] = round2((next[inv.invoice_id] || 0) + add);
            remaining = round2(remaining - add);
        }
    }

    return next;
}

/**
 * Tax deducted for one invoice, given the cash actually applied to it.
 *
 * Bounded twice:
 *
 *   Prorated by how much of the invoice the cash settles -- a customer clearing half
 *   a bill withholds on half of it, not on all of it.
 *
 *   Capped at whatever the cash leaves unpaid, so a payment that already covers the
 *   balance withholds nothing.
 */
export function withheldFor(invoice, expected, cashApplied) {
    if (!expected) return 0;
    const cash = Number(cashApplied) || 0;
    if (cash <= 0) return 0;

    const balance = Number(invoice.balance_due) || 0;
    const cap = cashCapFor(invoice, expected);
    const ratio = cap > 0 ? Math.min(cash / cap, 1) : 1;
    const prorated = Number(expected.remaining_expected) * ratio;
    const unpaidByCash = Math.max(round2(balance - cash), 0);

    return round2(Math.min(prorated, unpaidByCash));
}
