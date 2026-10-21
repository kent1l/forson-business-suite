const { getNextDocumentNumber } = require('../helpers/documentNumberGenerator');
const grnCosting = require('./grnCostingService');
const supplierReceiptReference = require('./supplierReceiptReferenceService');
const { resolveLineIdentities } = require('./grnLineIdentityService');

const DRAFT_PREFIX = 'GRD';

function validateDraftLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    const err = new Error('A receipt needs at least one line item.');
    err.statusCode = 400;
    throw err;
  }
  for (const [index, line] of lines.entries()) {
    if (!line.part_id) {
      const err = new Error(`Line ${index + 1} has no part selected.`);
      err.statusCode = 400;
      throw err;
    }
    const qty = Number(line.quantity);
    const cost = Number(line.cost_price);
    if (!Number.isFinite(qty) || qty <= 0) {
      const err = new Error(`Line ${index + 1} needs a quantity greater than zero.`);
      err.statusCode = 400;
      throw err;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      const err = new Error(`Line ${index + 1} needs a valid cost.`);
      err.statusCode = 400;
      throw err;
    }
    if (line.rejection_reason && !grnCosting.REJECTION_REASONS.includes(line.rejection_reason)) {
      const err = new Error(`'${line.rejection_reason}' is not a rejection reason.`);
      err.statusCode = 400;
      throw err;
    }
  }
}

async function writeDraftFreight(client, grnId, freightCosts = []) {
  await client.query('DELETE FROM goods_receipt_freight WHERE grn_id = $1', [grnId]);
  for (const f of freightCosts) {
    if (f.amount > 0 || f.supplier_id || f.receipt_number) {
      await client.query(
        `INSERT INTO goods_receipt_freight (grn_id, supplier_id, amount, receipt_number, notes, is_paid, payment_method_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [grnId, f.supplier_id || null, f.amount || 0, f.receipt_number || null, f.notes || null, !!f.is_paid, f.payment_method_id || null],
      );
    }
  }
}

async function writeDraftLines(client, grnId, lines, costing, options = {}) {
  const { resolvedLines, identityMappings, isImportedGrn } = await resolveLineIdentities(client, grnId, lines, options);

  await client.query('DELETE FROM goods_receipt_line WHERE grn_id = $1', [grnId]);
  for (const [index, line] of resolvedLines.entries()) {
    const computed = costing.lines[index];
    const salePrice = isImportedGrn && (line.sale_price == null || line.sale_price === '')
      ? null : computed.sale_price;
    await client.query(
      `INSERT INTO goods_receipt_line (line_uuid, grn_id, part_id, quantity, cost_price, sale_price,
                                       line_discount_percent, line_discount_amount, override_freight_amount,
                                       allocated_freight_amount, landed_unit_cost, effective_markup_percent,
                                       return_quantity, rejection_reason, is_free_goods)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [line.line_uuid, grnId, line.part_id, line.quantity, line.cost_price, salePrice,
       line.line_discount_percent ?? null, line.line_discount_amount ?? null, line.override_freight_amount ?? null,
       computed.allocated_freight_amount, computed.landed_unit_cost, computed.effective_markup_percent,
       computed.return_quantity, line.rejection_reason || null, computed.is_free_goods],
    );
  }

  return { resolvedLines, identityMappings };
}

async function createGrnDraft(client, {
  header,
  lines,
  costing,
  employeeId,
  isImportCommit = false,
  lineIdentityVersion = null,
}) {
  validateDraftLines(lines);

  const draftNumber = await getNextDocumentNumber(client, DRAFT_PREFIX);
  const { rows: [draft] } = await client.query(
    `INSERT INTO goods_receipt (grn_number, supplier_id, received_by, po_id, receipt_date, is_backfill,
                                supplier_invoice_no, physical_receipt_no, workflow_status, freight_amount, freight_allocation_method,
                                freight_supplier_id, overall_discount_percent, overall_discount_amount,
                                sync_retail_prices, created_by, bill_id, supplier_document_no, supplier_document_type, another_delivery_confirmed)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, CURRENT_TIMESTAMP), $6, $7, $8, 'Draft',
             $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING grn_id, grn_number`,
    [draftNumber, header.supplier_id, header.received_by || employeeId, header.po_id, header.receipt_date,
     header.is_backfill, header.supplier_invoice_no, header.physical_receipt_no, header.freight_amount, header.freight_allocation_method,
     header.freight_supplier_id, header.overall_discount_percent, header.overall_discount_amount,
     header.sync_retail_prices, employeeId, header.bill_id || null, header.supplier_document_no,
     header.supplier_document_type, header.another_delivery_confirmed],
  );

  await supplierReceiptReference.validateReceivingReference(client, {
    supplierId: header.supplier_id,
    documentNo: header.supplier_document_no,
    documentType: header.supplier_document_type,
    grnId: draft.grn_id,
    billId: header.bill_id,
    anotherDeliveryConfirmed: header.another_delivery_confirmed,
  });

  const { resolvedLines, identityMappings } = await writeDraftLines(client, draft.grn_id, lines, costing, {
    isImportCommit,
    lineIdentityVersion,
  });

  await writeDraftFreight(client, draft.grn_id, header.freight_costs || []);

  return {
    grn_id: draft.grn_id,
    grn_number: draft.grn_number,
    costing,
    resolvedLines,
    identityMappings,
  };
}

module.exports = {
  DRAFT_PREFIX,
  validateDraftLines,
  writeDraftFreight,
  writeDraftLines,
  createGrnDraft,
};
