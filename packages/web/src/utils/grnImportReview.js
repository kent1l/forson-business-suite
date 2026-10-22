// Cosmetic provenance only; matching and confirmation remain server decisions.
export function aiFilledRowFields(row, sourceLine = {}) {
  const cr = row.confirmed_row || {};
  return cr.ai_filled_fields || [
    cr.delivered_quantity != null && cr.delivered_quantity === sourceLine.quantity && 'delivered_quantity',
    cr.cost_price != null && cr.cost_price === sourceLine.unit_cost && 'cost_price',
    cr.automatic_match && 'part_id', cr.automatic_match && 'stock_uom',
  ].filter(Boolean);
}

export function aiFilledHeaderFields(header, sourceDocument = {}) {
  return header.ai_filled_fields || Object.entries({ supplier_document_no: 'document_number',
    supplier_document_type: 'document_type', confirmed_currency: 'currency' })
    .filter(([field, source]) => header[field] && header[field] === sourceDocument[source]).map(([field]) => field);
}

export function applyImportAction(review, action, selectedPart = null) {
  if (!review?.review_state) return review;
  const state = { ...review.review_state };
  if (action.type === 'set_header') {
    state.header = { ...state.header, ...action.values, header_confirmed: false,
      ai_filled_fields: aiFilledHeaderFields(state.header, review.source_payload?.document)
        .filter(field => !Object.hasOwn(action.values, field)),
    };
    if (['supplier_id', 'confirmed_currency'].some(field => Object.hasOwn(action.values, field)
      && action.values[field] !== review.review_state.header[field])) {
      state.rows = state.rows.map(row => ({ ...row, confirmed_row: { ...row.confirmed_row, row_confirmed: false } }));
    }
  } else if (action.type === 'set_row') {
    state.rows = state.rows.map(row => {
      if (row.row_id !== action.row_id) return row;
      const origins = new Set(aiFilledRowFields(row, review.source_payload?.lines?.find(line => line.line_no === row.line_no)));
      for (const field of Object.keys(action.values)) {
        if (action.origin === 'automatic_match' && ['part_id', 'stock_uom'].includes(field)) origins.add(field);
        else origins.delete(field);
      }
      const normalizedValues = Object.hasOwn(action.values, 'stock_uom') || action.values.part_id !== undefined
        ? {
            ...action.values,
            stock_uom: action.values.stock_uom?.trim()
              || selectedPart?.stock_uom?.trim()
              || selectedPart?.measurement_unit?.trim()
              || row.confirmed_row.stock_uom
              || 'pcs',
          }
        : action.values;
      const changedMatch = ['part_id', 'stock_uom', 'units_per_source_unit']
        .some(field => Object.hasOwn(normalizedValues, field) && normalizedValues[field] !== row.confirmed_row[field]);
      return {
        ...row,
        confirmed_row: {
          ...row.confirmed_row, ...normalizedValues,
          ai_filled_fields: [...origins],
          row_confirmed: changedMatch ? false : row.confirmed_row.row_confirmed,
          ...(action.values.part_id !== undefined ? {
            part_display_name: selectedPart?.display_name || selectedPart?.detail || selectedPart?.internal_sku || null,
            automatic_match: selectedPart?.automatic_match || null,
          } : {}),
        },
      };
    });
  } else if (action.type === 'set_inclusion') {
    state.rows = state.rows.map(row => row.row_id !== action.row_id ? row : {
      ...row, included: action.included, exclusion_reason: action.reason || null,
      confirmed_row: { ...row.confirmed_row, row_confirmed: action.included ? false : row.confirmed_row.row_confirmed },
    });
  }
  return { ...review, review_state: state };
}

export function importRowMatchKey(review, row) {
  const source = review.source_payload?.lines?.find(line => line.line_no === row.line_no) || {};
  return JSON.stringify([row.row_id, source.supplier_item_text || source.description || '',
    source.brand, source.part_number, source.item_group_hint, row.corrections]);
}

export function canAutomaticallyMatch(review, row) {
  const source = review.source_payload?.lines?.find(line => line.line_no === row.line_no);
  return row.included && !row.confirmed_row?.part_id && !row.confirmed_row?.row_confirmed
    && Boolean(source?.supplier_item_text?.trim() || source?.description?.trim());
}
