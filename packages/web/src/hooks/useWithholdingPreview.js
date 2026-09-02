import { useState, useEffect } from 'react';
import api from '../api';

/**
 * What a withholding customer is expected to deduct from the sale on screen.
 *
 * Withholding is a property of the CUSTOMER, not of a payment method. It applies the
 * moment a designated agent is selected, before anyone has decided how the sale will
 * be settled, so the figure belongs at the cart where the totals are -- not buried
 * inside one of several payment dialogs where a cashier taking cash would never see it.
 *
 * The arithmetic is deliberately not done here. The base is the VAT-exclusive amount,
 * and a base assembled in the browser is a base the browser can change -- this number
 * reduces a receivable, so it comes from the same server-side service that will
 * validate it on submit. See packages/api/services/withholdingTaxService.js.
 *
 * Returns null whenever withholding does not apply, so callers can render
 * conditionally without unpicking the shape.
 */
export default function useWithholdingPreview(customer, lines, taxRateId) {
    const [preview, setPreview] = useState(null);

    // Lines are compared by value: the array identity changes on every render in the
    // pages that use this, which would otherwise refetch in a loop.
    const linesKey = JSON.stringify(
        (lines || []).map(l => [l.part_id, l.quantity, l.sale_price, l.discount_amount || 0, l.tax_rate_id || null])
    );

    useEffect(() => {
        const parsed = JSON.parse(linesKey);
        if (!customer?.is_withholding_agent || !customer?.customer_id || parsed.length === 0) {
            setPreview(null);
            return;
        }

        // Callers hold the selected tax rate as an object on some pages and as a bare
        // id on others. Sending the object made the server reject the request, and the
        // catch below turned that into "no withholding applies" -- a wrong answer that
        // looked exactly like a correct one. Accept either shape rather than depend on
        // every call site getting it right.
        const rateId = (taxRateId && typeof taxRateId === 'object')
            ? (taxRateId.tax_rate_id ?? null)
            : (taxRateId ?? null);

        let cancelled = false;
        api.post('/withholding/preview', {
            customer_id: customer.customer_id,
            tax_rate_id: rateId,
            lines: parsed.map(([part_id, quantity, sale_price, discount_amount, tax_rate_id]) =>
                ({ part_id, quantity, sale_price, discount_amount, tax_rate_id })),
        })
            .then(res => { if (!cancelled) setPreview(res.data?.applicable ? res.data : null); })
            // Advisory display only -- the authoritative computation happens on submit,
            // which rejects loudly if anything is wrong. But a failure here is not the
            // same as "no withholding applies", and silently conflating the two hid a
            // real bug for days, so it is logged.
            .catch((err) => {
                if (cancelled) return;
                console.error('Withholding preview failed; the deduction will not be shown.', err);
                setPreview(null);
            });

        return () => { cancelled = true; };
    }, [customer?.customer_id, customer?.is_withholding_agent, taxRateId, linesKey]);

    return preview;
}
