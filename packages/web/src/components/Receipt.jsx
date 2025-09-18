const Receipt = ({ saleData, settings }) => {
    const { lines, subtotal, tax, total, tax_breakdown, invoice_number, physical_receipt_no } = saleData;
    const currency = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';

    return (
        <div className="receipt" style={{ 
            fontFamily: 'monospace', 
            fontSize: '12px', 
            lineHeight: '1.2', 
            maxWidth: '280px', 
            margin: '0 auto',
            padding: '10px'
        }}>
            <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: '0', fontSize: '14px', fontWeight: 'bold' }}>
                    {settings?.COMPANY_NAME || 'Company Name'}
                </h2>
                {settings?.COMPANY_ADDRESS && (
                    <div style={{ fontSize: '11px' }}>{settings.COMPANY_ADDRESS}</div>
                )}
                {settings?.COMPANY_PHONE && (
                    <div style={{ fontSize: '11px' }}>{settings.COMPANY_PHONE}</div>
                )}
            </div>
            
            <div style={{ borderTop: '1px dashed #000', paddingTop: '5px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Invoice:</span>
                    <span>{invoice_number}</span>
                </div>
                {physical_receipt_no && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Receipt:</span>
                        <span>{physical_receipt_no}</span>
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Date:</span>
                    <span>{new Date().toLocaleString()}</span>
                </div>
            </div>
            
            <div style={{ borderTop: '1px dashed #000', paddingTop: '5px', marginBottom: '10px' }}>
                {lines.map((line, index) => (
                    <div key={index} style={{ marginBottom: '5px' }}>
                        <div style={{ fontWeight: 'bold' }}>{line.display_name}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{line.quantity} x {currency}{line.sale_price.toFixed(2)}</span>
                            <span>{currency}{(line.quantity * line.sale_price).toFixed(2)}</span>
                        </div>
                    </div>
                ))}
            </div>
            
            <div style={{ borderTop: '1px dashed #000', paddingTop: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Subtotal:</span>
                    <span>{currency}{subtotal.toFixed(2)}</span>
                </div>
                
                {/* Tax Breakdown */}
                {tax_breakdown && tax_breakdown.length > 0 ? (
                    tax_breakdown.map((breakdown, index) => (
                        <div key={index} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{breakdown.rate_name} ({(breakdown.rate_percentage * 100).toFixed(2)}%):</span>
                            <span>{currency}{breakdown.tax_amount.toFixed(2)}</span>
                        </div>
                    ))
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Tax:</span>
                        <span>{currency}{tax.toFixed(2)}</span>
                    </div>
                )}
                
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    fontWeight: 'bold', 
                    fontSize: '14px',
                    borderTop: '1px solid #000',
                    paddingTop: '5px',
                    marginTop: '5px'
                }}>
                    <span>TOTAL:</span>
                    <span>{currency}{total.toFixed(2)}</span>
                </div>
            </div>
            
            {settings?.INVOICE_FOOTER_MESSAGE && (
                <div style={{ 
                    textAlign: 'center', 
                    marginTop: '10px', 
                    borderTop: '1px dashed #000',
                    paddingTop: '5px',
                    fontSize: '11px'
                }}>
                    {settings.INVOICE_FOOTER_MESSAGE}
                </div>
            )}
        </div>
    );
};

export default Receipt;