// One entry per foreign key into the four mergeable master tables. The database
// integration test compares this list with pg_constraint before merges are enabled.
const POLICY = Object.freeze({
    supplier: {
        namespace: 730001,
        references: [
            ['supplier', 'merged_into_supplier_id', 'provenance'],
            ['supplier_duplicate_suggestion', 'supplier_id', 'workflow'],
            ['supplier_duplicate_suggestion', 'duplicate_supplier_id', 'workflow'],
            ['goods_receipt', 'supplier_id', 'move'],
            ['goods_receipt', 'freight_supplier_id', 'move'],
            ['goods_receipt_freight', 'supplier_id', 'move'],
            ['purchase_order', 'supplier_id', 'move'],
            ['supplier_bill', 'supplier_id', 'move'],
            ['ap_ledger', 'supplier_id', 'move'],
            ['ap_payment', 'supplier_id', 'move'],
            ['cheque_clearance_log', 'supplier_id', 'move'],
            ['supplier_alias', 'supplier_id', 'union'],
            ['supplier_alias', 'source_supplier_id', 'provenance'],
        ],
    },
    customer: {
        namespace: 730002,
        references: [
            ['customer', 'merged_into_customer_id', 'provenance'],
            ['customer_duplicate_suggestion', 'customer_id', 'workflow'],
            ['customer_duplicate_suggestion', 'duplicate_customer_id', 'workflow'],
            ['invoice', 'customer_id', 'move'],
            ['customer_payment', 'customer_id', 'move'],
            ['staged_sale', 'customer_id', 'move'],
            ['ar_adjustment', 'customer_id', 'move'],
            ['ar_adjustment_authorization_log', 'customer_id', 'move'],
            ['ar_ledger', 'customer_id', 'move'],
            ['withholding_tax_line', 'customer_id', 'move'],
            ['withholding_tax_certificate', 'customer_id', 'move'],
            ['cheque_clearance_log', 'customer_id', 'move'],
            ['customer_tag', 'customer_id', 'union'],
            ['customer_wallet', 'customer_id', 'consolidate'],
            ['customer_wallet_transaction', 'customer_id', 'consolidate'],
            ['customer_alias', 'customer_id', 'union'],
            ['customer_alias', 'source_customer_id', 'provenance'],
        ],
    },
    brand: {
        namespace: 730003,
        references: [
            ['brand', 'merged_into_brand_id', 'provenance'],
            ['brand_duplicate_suggestion', 'brand_id', 'workflow'],
            ['brand_duplicate_suggestion', 'duplicate_brand_id', 'workflow'],
            ['part', 'brand_id', 'move'],
            ['brand_alias', 'brand_id', 'union'],
            ['brand_alias', 'source_brand_id', 'provenance'],
        ],
    },
    group: {
        namespace: 730004,
        references: [
            ['group', 'merged_into_group_id', 'provenance'],
            ['group_duplicate_suggestion', 'group_id', 'workflow'],
            ['group_duplicate_suggestion', 'duplicate_group_id', 'workflow'],
            ['part', 'group_id', 'move'],
            ['group_alias', 'group_id', 'union'],
            ['group_alias', 'source_group_id', 'provenance'],
        ],
    },
});

module.exports = POLICY;
