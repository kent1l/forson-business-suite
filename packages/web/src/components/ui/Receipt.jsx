import React from 'react';

const Receipt = React.forwardRef(({ saleData, settings }, ref) => {
    if (!saleData) return null;

    const { lines, total, subtotal, tax, invoice_number, physical_receipt_no } = saleData;

    return (
        <div ref={ref} className="p-4 font-mono text-xs text-black bg-white">
            <div className="text-center">
                <h1 className="text-lg font-bold">{settings?.COMPANY_NAME || 'Forson Business Suite'}</h1>
                <p>{settings?.COMPANY_ADDRESS}</p>
                <p>{settings?.COMPANY_PHONE}</p>
            </div>
            <div className="my-4 border-t border-dashed border-black"></div>
            <div>
                <p>Invoice #: {invoice_number}</p>
                {physical_receipt_no ? <p>Physical Receipt No: {physical_receipt_no}</p> : null}
                <p>Date: {new Date().toLocaleString()}</p>
            </div>
            <div className="my-4 border-t border-dashed border-black"></div>
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
            <div className="my-4 border-t border-dashed border-black"></div>
            <div className="space-y-1">
                <div className="flex justify-between"><span>Subtotal:</span><span>{subtotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Tax:</span><span>{tax.toFixed(2)}</span></div>
                <div className="flex justify-between font-bold"><span>TOTAL:</span><span>{total.toFixed(2)}</span></div>
            </div>
            <div className="my-4 border-t border-dashed border-black"></div>
            <div className="text-center">
                <p>{settings?.INVOICE_FOOTER_MESSAGE || 'Thank you!'}</p>
            </div>
        </div>
    );
});

export default Receipt;
