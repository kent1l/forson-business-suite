// Supplier paperwork is the primary label; internal numbers remain a fallback.
export function supplierDocumentReference(record) {
    return record?.supplier_document_no || record?.display_supplier_reference || record?.matched_doc_no
        || record?.physical_receipt_no || record?.supplier_invoice_no || null;
}

export function supplierReference(record) {
    return supplierDocumentReference(record) || record?.bill_number || record?.grn_number || 'No supplier reference';
}

export function flattenReferenceMatches(data) {
    const rows = Array.isArray(data) ? data : [...(data?.exact || []), ...(data?.similar || []), ...(data?.legacy || [])];
    return [...new Map(rows.map(row => [Number(row.bill_id), row])).values()];
}
