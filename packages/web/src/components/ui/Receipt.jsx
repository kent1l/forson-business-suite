import React from 'react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// A defective-flagged return line went to quarantine instead of active stock --
// worth a visible marker on the customer's own copy, since it's the reason the
// item can't simply be resold as-is if they change their mind again.
const conditionLabel = (line) => (line.is_defective ? ' (Defective/Damaged)' : '');

const Receipt = React.forwardRef(({ saleData, settings }, ref) => {
    if (!saleData) return null;

    const { lines, total, subtotal, tax, tax_breakdown, withholding_breakdown, invoice_number, physical_receipt_no, exchange_data } = saleData;
    const currency = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';
    const isExchange = !!exchange_data;

    return (
        <div ref={ref} className="p-4 font-mono text-xs text-black bg-white">
            <div className="text-center">
                <h1 className="text-lg font-bold">{settings?.COMPANY_NAME || 'Forson Business Suite'}</h1>
                <p>{settings?.COMPANY_ADDRESS}</p>
                <p>{settings?.COMPANY_PHONE}</p>
            </div>
            <div className="my-4 border-t border-dashed border-black"></div>
            {isExchange && (
                <p className="text-center font-bold">*** ITEM EXCHANGE RECEIPT ***</p>
            )}
            <div>
                <p>Invoice #: {invoice_number}</p>
                {physical_receipt_no ? <p>Physical Receipt No: {physical_receipt_no}</p> : null}
                {isExchange && (
                    <>
                        <p>Original Invoice #: {exchange_data.original_invoice_number}</p>
                        {exchange_data.original_physical_receipt_no ? (
                            <p>Original Receipt #: {exchange_data.original_physical_receipt_no}</p>
                        ) : null}
                        {exchange_data.cn_number ? <p>Credit Note #: {exchange_data.cn_number}</p> : null}
                    </>
                )}
                <p>Date: {format(toZonedTime(new Date(), 'Asia/Manila'), 'MM/dd/yyyy hh:mm a')}</p>
            </div>
            <div className="my-4 border-t border-dashed border-black"></div>
            {isExchange ? (
                <>
                    <p className="font-bold">ITEMS RETURNED</p>
                    <table className="w-full">
                        <thead>
                            <tr>
                                <th className="text-left">Item</th>
                                <th className="text-center">Qty</th>
                                <th className="text-right">Price</th>
                                <th className="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {exchange_data.returned_lines.map((line, idx) => (
                                <tr key={idx}>
                                    <td>{line.display_name}{conditionLabel(line)}</td>
                                    <td className="text-center">{line.quantity}</td>
                                    <td className="text-right">{Number(line.sale_price).toFixed(2)}</td>
                                    <td className="text-right">-{(line.quantity * line.sale_price).toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="my-3 border-t border-dashed border-black"></div>
                    <p className="font-bold">ITEMS ISSUED (REPLACEMENT)</p>
                    <table className="w-full">
                        <thead>
                            <tr>
                                <th className="text-left">Item</th>
                                <th className="text-center">Qty</th>
                                <th className="text-right">Price</th>
                                <th className="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((line, idx) => (
                                <tr key={line.part_id || idx}>
                                    <td>{line.display_name}</td>
                                    <td className="text-center">{line.quantity}</td>
                                    <td className="text-right">{Number(line.sale_price).toFixed(2)}</td>
                                    <td className="text-right">{(line.quantity * line.sale_price).toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            ) : (
                <table className="w-full">
                    <thead>
                        <tr>
                            <th className="text-left">Item</th>
                            <th className="text-center">Qty</th>
                            <th className="text-right">Price</th>
                            <th className="text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map(line => (
                            <tr key={line.part_id}>
                                <td>{line.display_name}</td>
                                <td className="text-center">{line.quantity}</td>
                                <td className="text-right">{Number(line.sale_price).toFixed(2)}</td>
                                <td className="text-right">{(line.quantity * line.sale_price).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div className="my-4 border-t border-dashed border-black"></div>
            <div className="space-y-1">
                <div className="flex justify-between"><span>Subtotal:</span><span>{subtotal.toFixed(2)}</span></div>
                {/* One line per rate when the sale mixes rates, so the customer
                    can see what was taxed at what. Older sales have no
                    breakdown stored, so a single total still has to work. */}
                {tax_breakdown && tax_breakdown.length > 0 ? (
                    tax_breakdown.map((breakdown, index) => (
                        <div key={index} className="flex justify-between">
                            <span>{breakdown.rate_name} ({(Number(breakdown.rate_percentage) * 100).toFixed(2)}%):</span>
                            <span>{Number(breakdown.tax_amount).toFixed(2)}</span>
                        </div>
                    ))
                ) : (
                    <div className="flex justify-between"><span>Tax:</span><span>{tax.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between font-bold"><span>{isExchange ? 'REPLACEMENT TOTAL:' : 'TOTAL:'}</span><span>{total.toFixed(2)}</span></div>
                {isExchange && (
                    <>
                        <div className="my-2 border-t border-dashed border-black"></div>
                        <div className="flex justify-between"><span>Returned Value:</span><span>-{exchange_data.return_credit.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold">
                            <span>NET SETTLEMENT:</span>
                            <span>
                                {exchange_data.net_differential > 0
                                    ? `+${currency}${exchange_data.net_differential.toFixed(2)} (Upgrade)`
                                    : exchange_data.net_differential < 0
                                        ? `-${currency}${Math.abs(exchange_data.net_differential).toFixed(2)} (Downgrade)`
                                        : 'Even -- ' + currency + '0.00'}
                            </span>
                        </div>
                        {(exchange_data.tenders || []).map((t, idx) => (
                            <div key={idx} className="flex justify-between">
                                <span>Paid via {t.method_name}:</span><span>{Number(t.amount_paid).toFixed(2)}</span>
                            </div>
                        ))}
                        {exchange_data.is_credit_sale && exchange_data.amount_due > 0 && (
                            <div className="flex justify-between"><span>Charged to Account:</span><span>{exchange_data.amount_due.toFixed(2)}</span></div>
                        )}
                        {exchange_data.leftover_credit > 0 && (
                            <div className="flex justify-between">
                                <span>
                                    {exchange_data.is_credit_sale
                                        ? 'Applied to Account Balance:'
                                        : exchange_data.downgrade_disposition === 'wallet'
                                            ? 'Store Credit Issued:'
                                            : 'Cash Refunded:'}
                                </span>
                                <span>{exchange_data.leftover_credit.toFixed(2)}</span>
                            </div>
                        )}
                    </>
                )}
                {/* Withholding is disclosed BELOW the total, never netted into it.
                    The sale is the full amount and that is what gets reported; the
                    deduction only changes how the balance was settled. Netting it
                    into the total would understate revenue and misstate VAT. */}
                {withholding_breakdown && withholding_breakdown.length > 0 && (
                    <>
                        {withholding_breakdown.map((w, index) => (
                            <div key={index} className="flex justify-between">
                                <span>
                                    Less: {w.withholding_type === 'VAT_GOV' ? 'Withholding VAT' : 'Tax withheld'}
                                    {w.atc_code ? ` (${w.atc_code})` : ''}:
                                </span>
                                <span>({Number(w.actual_withheld).toFixed(2)})</span>
                            </div>
                        ))}
                        <div className="flex justify-between font-bold">
                            <span>NET DUE:</span>
                            <span>
                                {(total - withholding_breakdown.reduce((sum, w) => sum + Number(w.actual_withheld), 0)).toFixed(2)}
                            </span>
                        </div>
                        <p className="text-center mt-2">Please issue BIR Form 2307 for the tax withheld.</p>
                    </>
                )}
            </div>
            <div className="my-4 border-t border-dashed border-black"></div>
            <div className="text-center">
                <p>{settings?.INVOICE_FOOTER_MESSAGE || 'Thank you!'}</p>
            </div>
        </div>
    );
});

export default Receipt;
