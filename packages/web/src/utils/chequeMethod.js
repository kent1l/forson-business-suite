// Cheque / PDC instrument detection, shared by every screen that can take a
// cheque (POS + Invoicing via SplitPaymentModal, AR via ReceivePaymentForm).
//
// A cheque is not money in the drawer: it stays in the PDC & Clearance Desk
// until someone verifies it, and it carries a maturity date that is not the
// date it was handed over. Both facts hang off this check, so the detection
// has to be identical everywhere -- a screen that misses it silently records a
// cheque as already cleared.
//
// Matches the server-side rule in paymentRoutes/invoiceRoutes: explicit
// 'cheque'/'pdc' codes, a cheque-typed method, or a method named for one.
export const isChequeMethod = (method) => {
    if (!method) return false;
    const code = String(method.code || '').toLowerCase();
    const type = String(method.type || '').toLowerCase();
    const name = String(method.name || '').toLowerCase();
    return code === 'cheque' || code === 'pdc' || type === 'cheque' || name.includes('cheque');
};

export default isChequeMethod;
