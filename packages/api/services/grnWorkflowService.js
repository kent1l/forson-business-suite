'use strict';

/**
 * The goods receipt workflow state machine.
 *
 * A receipt now travels Draft → Submitted → Posted, and can be Cancelled from either
 * of the first two. Posted and Cancelled are terminal here: a posted receipt is
 * unwound through the void flow (DELETE /goods-receipts/:id), which is a separate,
 * accounting-style reversal recorded on goods_receipt.status rather than a move
 * backwards through this machine.
 *
 * The rule this file exists to protect: Draft, Submitted and Cancelled receipts have
 * NO financial effect at all — no inventory_transaction, no WAC recalculation, no
 * supplier_bill, no ap_ledger entry, no purchase order movement. That is enforced
 * structurally rather than by checking a flag in a dozen places: every one of those
 * writes lives in grnPostingService.postReceipt(), which is only ever reached by the
 * post transition.
 */

const DRAFT = 'Draft';
const SUBMITTED = 'Submitted';
const POSTED = 'Posted';
const CANCELLED = 'Cancelled';

const STATUSES = [DRAFT, SUBMITTED, POSTED, CANCELLED];

/** Statuses a receipt can still be edited in. */
const EDITABLE_STATUSES = [DRAFT, SUBMITTED];

const TRANSITIONS = Object.freeze({
  // Submitted → Draft is the reviewer sending it back for correction.
  [DRAFT]: [SUBMITTED, CANCELLED],
  [SUBMITTED]: [POSTED, DRAFT, CANCELLED],
  [POSTED]: [],
  [CANCELLED]: [],
});

class WorkflowError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = 'WorkflowError';
    this.statusCode = statusCode;
  }
}

function isEditable(status) {
  return EDITABLE_STATUSES.includes(status);
}

/**
 * Throw unless `from → to` is a legal move.
 * @throws {WorkflowError} with statusCode 409, so routes can surface it as a conflict
 *   rather than a generic 500.
 */
function assertTransition(from, to) {
  if (!STATUSES.includes(to)) {
    throw new WorkflowError(`'${to}' is not a goods receipt status.`, 400);
  }
  if (!STATUSES.includes(from)) {
    throw new WorkflowError(`This receipt has an unrecognised status ('${from}').`, 409);
  }
  if (from === to) {
    throw new WorkflowError(`This receipt is already ${to.toLowerCase()}.`);
  }
  if (!TRANSITIONS[from].includes(to)) {
    if (from === POSTED) {
      throw new WorkflowError('This receipt has already been posted. Void it instead of changing its status.');
    }
    if (from === CANCELLED) {
      throw new WorkflowError('This receipt was cancelled and can no longer be changed.');
    }
    throw new WorkflowError(`A ${from.toLowerCase()} receipt cannot be moved to ${to.toLowerCase()}.`);
  }
}

/**
 * Guard for edit endpoints: refuse to modify anything that has left the draft stage.
 * @throws {WorkflowError}
 */
function assertEditable(status) {
  if (!isEditable(status)) {
    if (status === POSTED) {
      throw new WorkflowError('This receipt has been posted. Edit it through the receipt history, or void and re-enter it.');
    }
    throw new WorkflowError(`A ${String(status).toLowerCase()} receipt cannot be edited.`);
  }
}

module.exports = {
  DRAFT,
  SUBMITTED,
  POSTED,
  CANCELLED,
  STATUSES,
  EDITABLE_STATUSES,
  TRANSITIONS,
  WorkflowError,
  assertTransition,
  assertEditable,
  isEditable,
};
