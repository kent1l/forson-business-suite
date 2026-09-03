'use strict';

/**
 * Goods receipt landed-cost arithmetic.
 *
 * This module is deliberately pure: no database, no I/O, no dates. Everything the
 * goods receipt document computes — discounts, freight allocation, landed unit cost,
 * suggested retail price — lives here so it can be unit-tested exhaustively and so the
 * API and the web UI agree on the numbers. The web mirrors it at
 * packages/web/src/utils/grnCosting.js, and both are driven from the shared fixture
 * file packages/api/tests/fixtures/grnCostingCases.json so they cannot drift apart.
 *
 * Order of operations, which matters and is not negotiable:
 *
 *   1. accepted quantity  = quantity − return_quantity
 *   2. gross line         = accepted quantity × unit cost
 *   3. line discount      (percent OR amount, never both)
 *   4. net line           = gross − line discount
 *   5. freight allocation over net line values, heavy-item overrides reserved first
 *   6. header discount    pro-rated over net line values
 *   7. landed line total  = net + freight share − header discount share
 *   8. landed unit cost   = landed line total ÷ accepted quantity
 *
 * Freight comes BEFORE the header discount because the header discount is a
 * negotiated reduction of the supplier's own invoice, and the supplier's invoice does
 * not include the carrier's charge. Discounting freight would credit the buyer for
 * money the supplier never charged.
 */

/** Default retail markup applied to landed cost when a line does not override it. */
const DEFAULT_MARKUP_PERCENT = 70;

/** Below this, a suggested price is flagged; posting refuses it. */
const MIN_MARKUP_PERCENT = 30;

/**
 * Suggested retail prices are rounded up to a multiple of this.
 *
 * A counter that deals in cash wants prices it can make change for, and a shelf label
 * reading 195.50 is worse than one reading 200 for no gain. Rounding *up* rather than
 * to the nearest multiple is deliberate: it can only ever widen the margin, so the
 * markup floor stays a floor and no line is quietly priced below the cost the
 * receiver was working to.
 */
const PRICE_ROUNDING_INCREMENT = 5;

/** Pro-rata by net invoice value. The only method implemented. */
const METHOD_A = 'METHOD_A';

/**
 * Weight/volume allocation. Reserved, not implemented: the parts catalogue carries no
 * weight or dimension data, so there is nothing to allocate on. Requesting it falls
 * back to METHOD_A and reports a warning rather than failing, so a document saved
 * against a future schema never becomes uncomputable.
 */
const METHOD_B = 'METHOD_B';

const REJECTION_REASONS = ['Damaged', 'Wrong Part', 'Defective', 'Supplier Error', 'Other'];

const CENTS = 100;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  // Scale-and-round rather than toFixed: toFixed inherits binary float surprises at
  // the half-cent boundary, and these figures become money in the ledger.
  return Math.round((num(value) + Number.EPSILON) * CENTS) / CENTS;
}

function round4(value) {
  return Math.round((num(value) + Number.EPSILON) * 10000) / 10000;
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total` at two decimals.
 *
 * Naive per-line rounding loses or invents cents, which would leave the freight
 * actually charged to inventory different from the freight actually owed to the
 * carrier. Largest-remainder assigns every whole cent, then hands the leftovers to the
 * lines with the biggest fractional claim — so the split is both exact and stable.
 *
 * @param {number} total
 * @param {number[]} weights  — non-negative; all-zero means an even split
 * @returns {number[]} amounts in the same order as `weights`
 */
function distributeByWeight(total, weights) {
  const n = weights.length;
  if (n === 0) return [];

  const cents = Math.round(num(total) * CENTS);
  if (cents === 0) return new Array(n).fill(0);

  const safeWeights = weights.map((w) => Math.max(0, num(w)));
  let weightSum = safeWeights.reduce((a, b) => a + b, 0);

  // No basis to allocate on (every line free of charge, say) — spread it evenly so the
  // money still lands somewhere rather than vanishing.
  const basis = weightSum > 0 ? safeWeights : new Array(n).fill(1);
  weightSum = weightSum > 0 ? weightSum : n;

  const exact = basis.map((w) => (cents * w) / weightSum);
  const floors = exact.map((e) => Math.floor(e));
  let remainder = cents - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = floors.slice();
  for (let k = 0; remainder > 0; k = (k + 1) % n) {
    result[order[k].i] += 1;
    remainder -= 1;
  }

  return result.map((c) => c / CENTS);
}

/**
 * The discount a line or header carries, resolved to an amount.
 * Percent and amount are mutually exclusive; percent wins if both somehow arrive,
 * matching the database CHECK constraint that should have prevented it.
 */
function resolveDiscount(base, percent, amount) {
  if (percent !== null && percent !== undefined && percent !== '') {
    return round2((num(base) * num(percent)) / 100);
  }
  if (amount !== null && amount !== undefined && amount !== '') {
    return round2(num(amount));
  }
  return 0;
}

/**
 * Round up to the next multiple of `increment`, in cents so the ceiling is not thrown
 * off by a float landing a hair above an exact multiple. A price already on a multiple
 * is left alone, and zero stays zero.
 * @returns {number}
 */
function roundUpTo(value, increment = PRICE_ROUNDING_INCREMENT) {
  const step = Math.round(num(increment) * CENTS);
  if (step <= 0) return round2(value);
  const cents = Math.round(num(value) * CENTS);
  if (cents <= 0) return 0;
  return (Math.ceil(cents / step) * step) / CENTS;
}

/**
 * Suggested retail price from a landed cost and a markup, rounded up to the next whole
 * PRICE_ROUNDING_INCREMENT. Only prices the system suggests are rounded — a price the
 * user types is theirs and is left exactly as entered.
 * @returns {number}
 */
function priceFromMarkup(landedUnitCost, markupPercent) {
  const raw = round2(num(landedUnitCost) * (1 + num(markupPercent, DEFAULT_MARKUP_PERCENT) / 100));
  return roundUpTo(raw);
}

/**
 * The inverse: what markup does this price imply over this landed cost? Used when the
 * user types a price directly and the markup column has to follow.
 * @returns {number|null} null when landed cost is zero, where markup is undefined
 */
function markupFromPrice(salePrice, landedUnitCost) {
  const cost = num(landedUnitCost);
  if (cost <= 0) return null;
  return round2((num(salePrice) / cost - 1) * 100);
}

/**
 * Compute the whole document.
 *
 * @param {object} input
 * @param {Array<object>} input.lines — each `{ quantity, cost_price, return_quantity?,
 *   line_discount_percent?, line_discount_amount?, override_freight_amount?,
 *   effective_markup_percent?, sale_price? }`
 * @param {number} [input.freightAmount=0]
 * @param {string} [input.freightMethod='METHOD_A']
 * @param {number|null} [input.overallDiscountPercent]
 * @param {number|null} [input.overallDiscountAmount]
 * @param {boolean} [input.recomputeSalePrice=true] — when false, an existing sale_price
 *   is kept and the markup is derived backwards from it instead.
 * @returns {{lines: object[], totals: object, warnings: object[], errors: object[]}}
 */
function computeCosting({
  lines = [],
  freightAmount = 0,
  freightMethod = METHOD_A,
  overallDiscountPercent = null,
  overallDiscountAmount = null,
  recomputeSalePrice = true,
} = {}) {
  const errors = [];
  const warnings = [];

  if (freightMethod === METHOD_B) {
    warnings.push({
      code: 'METHOD_B_UNAVAILABLE',
      message: 'Weight-based freight allocation needs part weights, which the catalogue does not record yet. Allocated by invoice value instead.',
    });
  }

  const freight = round2(Math.max(0, num(freightAmount)));

  // ── Steps 1–4: accepted quantity, gross, line discount, net ────────────────
  const rows = lines.map((line, index) => {
    const quantity = num(line.quantity);
    const returnQuantity = Math.min(Math.max(0, num(line.return_quantity)), quantity);
    const acceptedQty = round4(quantity - returnQuantity);
    const unitCost = num(line.cost_price);

    if (line.line_discount_percent != null && line.line_discount_amount != null) {
      errors.push({
        code: 'LINE_DISCOUNT_BOTH',
        index,
        message: `Line ${index + 1} has both a discount percentage and a discount amount. Use one or the other.`,
      });
    }

    const grossAsDelivered = round2(quantity * unitCost);
    const grossAccepted = round2(acceptedQty * unitCost);
    const lineDiscount = resolveDiscount(grossAccepted, line.line_discount_percent, line.line_discount_amount);

    if (lineDiscount > grossAccepted) {
      errors.push({
        code: 'LINE_DISCOUNT_EXCEEDS_VALUE',
        index,
        message: `Line ${index + 1}'s discount is larger than the line itself.`,
      });
    }

    return {
      index,
      quantity,
      returnQuantity,
      acceptedQty,
      unitCost,
      grossAsDelivered,
      grossAccepted,
      lineDiscount,
      netLine: round2(grossAccepted - lineDiscount),
      overrideFreight: line.override_freight_amount == null || line.override_freight_amount === ''
        ? null
        : round2(Math.max(0, num(line.override_freight_amount))),
      markupPercent: line.effective_markup_percent == null
        ? DEFAULT_MARKUP_PERCENT
        : num(line.effective_markup_percent, DEFAULT_MARKUP_PERCENT),
      salePrice: line.sale_price == null || line.sale_price === '' ? null : num(line.sale_price),
    };
  });

  if (overallDiscountPercent != null && overallDiscountAmount != null) {
    errors.push({
      code: 'HEADER_DISCOUNT_BOTH',
      message: 'The receipt has both an overall discount percentage and an overall discount amount. Use one or the other.',
    });
  }

  // ── Step 5: freight, overrides reserved before anything is pro-rated ───────
  const reservedTotal = round2(
    rows.reduce((sum, r) => sum + (r.overrideFreight ?? 0), 0),
  );

  if (reservedTotal > freight + 0.0001) {
    errors.push({
      code: 'FREIGHT_OVERRIDE_EXCEEDS_TOTAL',
      message: `Heavy-item freight overrides total ${reservedTotal.toFixed(2)}, which is more than the ${freight.toFixed(2)} freight on this shipment.`,
    });
  }

  const remainingFreight = round2(Math.max(0, freight - reservedTotal));
  const proRataRows = rows.filter((r) => r.overrideFreight == null);

  // When every line carries an override, any remainder still has to land somewhere;
  // spreading it over all lines is the only choice that keeps the total exact.
  const targetRows = proRataRows.length > 0 ? proRataRows : rows;

  // Fall back to quantity share when the lines being allocated over are worth nothing
  // (free-of-charge goods still cost money to ship).
  const netBasisSum = targetRows.reduce((sum, r) => sum + r.netLine, 0);
  const freightWeights = netBasisSum > 0
    ? targetRows.map((r) => r.netLine)
    : targetRows.map((r) => r.acceptedQty);

  const freightShares = distributeByWeight(remainingFreight, freightWeights);
  rows.forEach((r) => { r.allocatedFreight = r.overrideFreight ?? 0; });
  targetRows.forEach((r, i) => {
    r.allocatedFreight = round2(r.allocatedFreight + freightShares[i]);
  });

  // ── Step 6: header discount, pro-rated over net line value ─────────────────
  const netSubtotal = round2(rows.reduce((sum, r) => sum + r.netLine, 0));
  const headerDiscount = resolveDiscount(netSubtotal, overallDiscountPercent, overallDiscountAmount);

  if (headerDiscount > netSubtotal + 0.0001) {
    errors.push({
      code: 'HEADER_DISCOUNT_EXCEEDS_VALUE',
      message: `The overall discount of ${headerDiscount.toFixed(2)} is larger than the ${netSubtotal.toFixed(2)} value of the receipt.`,
    });
  }

  const headerWeights = netSubtotal > 0
    ? rows.map((r) => r.netLine)
    : rows.map((r) => r.acceptedQty);
  const headerShares = distributeByWeight(Math.min(headerDiscount, netSubtotal), headerWeights);

  // ── Steps 7–8: landed cost, then the price it suggests ─────────────────────
  const outLines = rows.map((r, i) => {
    const headerDiscountShare = headerShares[i] ?? 0;
    const landedLineTotal = round2(r.netLine + r.allocatedFreight - headerDiscountShare);
    const landedUnitCost = r.acceptedQty > 0 ? round4(landedLineTotal / r.acceptedQty) : 0;

    // A price someone deliberately typed is authoritative and is never silently
    // overwritten — the markup column follows it instead. A line that has not been
    // priced yet always gets one derived, so adding a line to an existing draft does
    // not leave it at zero.
    let markupPercent = r.markupPercent;
    let salePrice;
    if (!recomputeSalePrice && r.salePrice != null) {
      salePrice = round2(r.salePrice);
    } else {
      salePrice = priceFromMarkup(landedUnitCost, markupPercent);
    }

    // The markup reported is always the one the returned price actually realises, never
    // the one that was asked for. Those differ whenever a suggested price is rounded up
    // to the next PRICE_ROUNDING_INCREMENT, and a screen showing 70% beside a price that
    // is really 70.11% is a screen nobody can reconcile against the shelf label.
    const derived = markupFromPrice(salePrice, landedUnitCost);
    if (derived != null) markupPercent = derived;

    if (landedUnitCost > 0 && markupPercent < MIN_MARKUP_PERCENT) {
      warnings.push({
        code: 'BELOW_MIN_MARKUP',
        index: r.index,
        message: `Line ${r.index + 1} is priced at ${round2(markupPercent)}% markup, below the ${MIN_MARKUP_PERCENT}% minimum.`,
      });
    }

    return {
      index: r.index,
      quantity: r.quantity,
      return_quantity: r.returnQuantity,
      accepted_quantity: r.acceptedQty,
      cost_price: r.unitCost,
      gross_as_delivered: r.grossAsDelivered,
      gross_accepted: r.grossAccepted,
      line_discount_value: r.lineDiscount,
      net_line_value: r.netLine,
      override_freight_amount: r.overrideFreight,
      allocated_freight_amount: r.allocatedFreight,
      header_discount_share: headerDiscountShare,
      landed_line_total: landedLineTotal,
      landed_unit_cost: landedUnitCost,
      effective_markup_percent: round2(markupPercent),
      sale_price: salePrice,
    };
  });

  // ── The totals ladder ──────────────────────────────────────────────────────
  //
  // This is shaped to be read against the supplier's own paperwork, top to bottom, so
  // an encoder holding the delivery receipt can check their entry one figure at a
  // time. supplier_invoice_total is the control figure: it is computed from what was
  // DELIVERED, before any return, because that is the number printed on the document.
  // Returns, freight and the resulting inventory value sit below it.
  const grossAsDelivered = round2(rows.reduce((s, r) => s + r.grossAsDelivered, 0));
  const lineDiscountTotal = round2(rows.reduce((s, r) => s + r.lineDiscount, 0));
  const returnedValue = round2(rows.reduce((s, r) => s + round2(r.returnQuantity * r.unitCost), 0));
  const appliedHeaderDiscount = round2(headerShares.reduce((s, v) => s + v, 0));
  const netGoodsValue = round2(netSubtotal - appliedHeaderDiscount);

  const totals = {
    gross_as_delivered: grossAsDelivered,
    line_discount_total: lineDiscountTotal,
    header_discount_total: appliedHeaderDiscount,
    // What the supplier's document should say, before anything was sent back.
    supplier_invoice_total: round2(grossAsDelivered - lineDiscountTotal - appliedHeaderDiscount),
    returned_value: returnedValue,
    // What is actually owed for the goods, after returns.
    net_goods_value: netGoodsValue,
    freight_amount: freight,
    freight_reserved_by_overrides: reservedTotal,
    freight_pro_rated: remainingFreight,
    freight_allocated: round2(outLines.reduce((s, l) => s + l.allocated_freight_amount, 0)),
    // What lands in inventory: goods plus the delivery cost capitalised into it.
    total_inventory_value: round2(netGoodsValue + freight),
  };

  return { lines: outLines, totals, warnings, errors };
}

module.exports = {
  computeCosting,
  distributeByWeight,
  priceFromMarkup,
  markupFromPrice,
  roundUpTo,
  resolveDiscount,
  DEFAULT_MARKUP_PERCENT,
  MIN_MARKUP_PERCENT,
  PRICE_ROUNDING_INCREMENT,
  METHOD_A,
  METHOD_B,
  REJECTION_REASONS,
};
