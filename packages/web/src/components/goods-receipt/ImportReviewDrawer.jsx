import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../ui/Icon';
import Combobox from '../ui/Combobox';
import { ICONS } from '../../constants';
import { formatCurrency } from '../../utils/currency';
import { REJECTION_REASONS } from '../../utils/grnCosting';

export default function ImportReviewDrawer({
  isOpen,
  onClose,
  reviewState,
  sourcePayload,
  version,
  blockers = [],
  suppliers = [],
  saving = false,
  committing = false,
  hasUnsavedChanges = false,
  candidatesByRow = {},
  candidatesLoadingRow = null,
  onQueueAction,
  onSaveReview,
  onFetchCandidates,
  onAbandonReview,
  onCommitReview,
}) {
  const [needsAttentionFilter, setNeedsAttentionFilter] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState({});
  const [candidateDrawerRowId, setCandidateDrawerRowId] = useState(null);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');
  const [abandonModalOpen, setAbandonModalOpen] = useState(false);
  const [abandonReason, setAbandonReason] = useState('');

  const header = reviewState?.header || {};
  const rows = reviewState?.rows || [];
  const issues = reviewState?.issues || [];

  // Group blockers by row_id and header
  const blockersByRow = useMemo(() => {
    const map = {};
    for (const b of blockers) {
      if (b.row_id) {
        if (!map[b.row_id]) map[b.row_id] = [];
        map[b.row_id].push(b);
      }
    }
    return map;
  }, [blockers]);

  const headerBlockers = useMemo(() => {
    return blockers.filter(b => b.scope === 'header' || b.scope === 'document');
  }, [blockers]);

  const filteredRows = useMemo(() => {
    if (!needsAttentionFilter) return rows;
    return rows.filter(r => {
      const hasBlockers = !!blockersByRow[r.row_id]?.length;
      const unconfirmed = r.included && !r.confirmed_row?.row_confirmed;
      const hasUnresolvedIssues = issues.some(iss => iss.line_no === r.line_no && !iss.resolved);
      return hasBlockers || unconfirmed || hasUnresolvedIssues;
    });
  }, [rows, needsAttentionFilter, blockersByRow, issues]);

  // Handle header field updates
  const updateHeader = (values) => {
    onQueueAction({
      type: 'set_header',
      values,
    });
  };

  // Handle row updates
  const updateRow = (rowId, values, reason = null) => {
    onQueueAction({
      type: 'set_row',
      row_id: rowId,
      values,
      reason,
    });
  };

  // Toggle inclusion
  const toggleInclusion = (rowId, currentIncluded) => {
    const newIncluded = !currentIncluded;
    let reason = null;
    if (!newIncluded) {
      reason = window.prompt('Enter reason for excluding this row (minimum 5 characters):');
      if (!reason || reason.trim().length < 5) {
        alert('Exclusion reason of at least 5 characters is required.');
        return;
      }
    }
    onQueueAction({
      type: 'set_inclusion',
      row_id: rowId,
      included: newIncluded,
      reason,
    });
  };

  // Open candidate drawer for a row
  const openCandidates = (rowId) => {
    setCandidateDrawerRowId(rowId);
    setCandidateSearchQuery('');
    onFetchCandidates(rowId);
  };

  const handleSelectCandidate = (rowId, candidate) => {
    updateRow(rowId, {
      part_id: candidate.part_id,
      stock_uom: candidate.stock_uom,
    });
    setCandidateDrawerRowId(null);
  };

  const handleResolveIssue = (issueId) => {
    const reason = window.prompt('Enter explanation for resolving this issue (minimum 5 characters):');
    if (!reason || reason.trim().length < 5) {
      alert('Explanation of at least 5 characters is required.');
      return;
    }
    onQueueAction({
      type: 'resolve_issue',
      issue_id: issueId,
      reason,
    });
  };

  const handleExplainTotalMismatch = (issueId) => {
    const explanation = window.prompt('Enter reviewed explanation for this total discrepancy:');
    if (!explanation || explanation.trim().length < 5) {
      alert('Explanation of at least 5 characters is required.');
      return;
    }
    onQueueAction({
      type: 'explain_total_warning',
      issue_id: issueId,
      explanation,
    });
  };

  const toggleEvidence = (rowId) => {
    setExpandedEvidence(prev => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 h-full flex flex-col shadow-2xl border-l border-gray-200 dark:border-slate-800">
        {/* Top bar */}
        <div className="p-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-gray-50 dark:bg-slate-800/60">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
                Review Extracted Document
              </h2>
              <span className="px-2 py-0.5 text-xs font-mono font-medium rounded bg-primary-100 dark:bg-primary-950 text-primary-800 dark:text-primary-200">
                v{version}
              </span>
              {hasUnsavedChanges && (
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {rows.length} extracted lines ({rows.filter(r => r.included).length} included, {rows.filter(r => !r.included).length} excluded)
            </div>
          </div>

          <div className="flex items-center gap-3">
            {blockers.length > 0 ? (
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 flex items-center gap-1">
                <Icon path={ICONS.warning} className="w-3.5 h-3.5" />
                {blockers.length} blocker{blockers.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                <Icon path={ICONS.check} className="w-3.5 h-3.5" /> Ready to Commit
              </span>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              <Icon path={ICONS.close} className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Header confirmation card */}
          <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                Document Header
                {header.header_confirmed ? (
                  <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Confirmed
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    Needs Confirmation
                  </span>
                )}
              </h3>
              {!header.header_confirmed && (
                <button
                  type="button"
                  onClick={() => onQueueAction({ type: 'confirm_header' })}
                  className="px-3 py-1 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg"
                >
                  Confirm Header
                </button>
              )}
            </div>

            {headerBlockers.length > 0 && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 space-y-1">
                {headerBlockers.map((b, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span>•</span>
                    <span>{b.message}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-gray-600 dark:text-slate-400 mb-1">Supplier</label>
                <select
                  value={header.supplier_id || ''}
                  disabled={!!header.context_locked_supplier_id}
                  onChange={(e) => updateHeader({ supplier_id: e.target.value ? Number(e.target.value) : null })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                >
                  <option value="">Select Supplier</option>
                  {suppliers.map(s => (
                    <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-600 dark:text-slate-400 mb-1">Document Number</label>
                <input
                  type="text"
                  value={header.supplier_document_no || ''}
                  onChange={(e) => updateHeader({ supplier_document_no: e.target.value })}
                  className="w-full px-2.5 py-1.5 font-mono border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-gray-600 dark:text-slate-400 mb-1">Document Type</label>
                <select
                  value={header.supplier_document_type || 'other'}
                  onChange={(e) => updateHeader({ supplier_document_type: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                >
                  <option value="delivery_receipt">Delivery Receipt</option>
                  <option value="invoice">Invoice</option>
                  <option value="other">Other / Unspecified</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-600 dark:text-slate-400 mb-1">Receipt Date (Manila)</label>
                <input
                  type="date"
                  value={header.receipt_date || ''}
                  onChange={(e) => updateHeader({ receipt_date: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-gray-600 dark:text-slate-400 mb-1">Confirmed Currency</label>
                <div className="flex items-center gap-2 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={header.confirmed_currency === 'PHP'}
                      onChange={(e) => updateHeader({ confirmed_currency: e.target.checked ? 'PHP' : null })}
                      className="rounded border-gray-300"
                    />
                    <span>PHP (Philippine Peso)</span>
                  </label>
                </div>
              </div>

              {header.another_delivery_confirmed !== undefined && (
                <div className="flex items-center gap-2 pt-5">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!header.another_delivery_confirmed}
                      onChange={(e) => updateHeader({ another_delivery_confirmed: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span>Acknowledge Further Delivery</span>
                  </label>
                </div>
              )}
            </div>

            {sourcePayload?.document?.currency !== 'PHP' && (
              <div className="pt-2">
                <label className="block text-xs text-gray-600 dark:text-slate-400 mb-1">
                  Currency Reason (required when source currency is unknown):
                </label>
                <input
                  type="text"
                  value={header.currency_reason || ''}
                  placeholder="e.g. Document prices confirmed in PHP by supplier representative"
                  onChange={(e) => updateHeader({ currency_reason: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          {/* Document Issues section */}
          {issues.length > 0 && (
            <div className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                Extraction & Reconciliation Issues ({issues.length})
              </h3>
              <div className="space-y-2 text-xs">
                {issues.map((iss) => (
                  <div
                    key={iss.issue_id}
                    className={`p-2.5 rounded-lg border flex items-center justify-between gap-3 ${
                      iss.resolved
                        ? 'border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 text-gray-500'
                        : 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-semibold">
                        <span>{iss.code}</span>
                        {iss.line_no && <span>(Line {iss.line_no})</span>}
                        {iss.resolved && (
                          <span className="text-emerald-600 dark:text-emerald-400 font-normal">
                            ✓ Resolved: {iss.resolution_reason}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] mt-0.5">{iss.message}</div>
                    </div>
                    {!iss.resolved && (
                      <div>
                        {iss.code === 'TOTAL_MISMATCH' ? (
                          <button
                            type="button"
                            onClick={() => handleExplainTotalMismatch(iss.issue_id)}
                            className="px-2.5 py-1 font-semibold rounded bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-800 dark:text-amber-100"
                          >
                            Explain Mismatch
                          </button>
                        ) : iss.code !== 'SKIPPED_ROW' && iss.code !== 'CROPPED_OR_MISSING_PAGE' ? (
                          <button
                            type="button"
                            onClick={() => handleResolveIssue(iss.issue_id)}
                            className="px-2.5 py-1 font-semibold rounded bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-800 dark:text-amber-100"
                          >
                            Resolve Issue
                          </button>
                        ) : (
                          <span className="text-red-600 font-medium">Unresolvable Blocker</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filter toggle bar */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-slate-100">
              Line Items ({filteredRows.length} displayed)
            </h3>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={needsAttentionFilter}
                onChange={(e) => setNeedsAttentionFilter(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span>Needs Attention Only</span>
            </label>
          </div>

          {/* Rows list */}
          <div className="space-y-4">
            {filteredRows.map((row) => {
              const rowBlockers = blockersByRow[row.row_id] || [];
              const cr = row.confirmed_row || {};
              const isConfirmed = cr.row_confirmed;
              const sourceLine = sourcePayload?.lines?.find(l => l.line_no === row.line_no) || {};

              return (
                <div
                  key={row.row_id}
                  className={`p-4 rounded-xl border transition ${
                    !row.included
                      ? 'border-gray-200 dark:border-slate-800 bg-gray-100/50 dark:bg-slate-800/20 opacity-70'
                      : isConfirmed
                      ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/20 dark:bg-emerald-950/10'
                      : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Row header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                        <input
                          type="checkbox"
                          checked={row.included}
                          onChange={() => toggleInclusion(row.row_id, row.included)}
                          className="rounded border-gray-300"
                        />
                        <span>Line {row.line_no}</span>
                      </label>

                      {isConfirmed && (
                        <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                          <Icon path={ICONS.check} className="w-3 h-3" /> Confirmed
                        </span>
                      )}

                      {!row.included && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300">
                          Excluded: {row.exclusion_reason}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleEvidence(row.row_id)}
                        className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
                      >
                        {expandedEvidence[row.row_id] ? 'Hide Evidence' : 'Show Evidence'}
                      </button>

                      {row.included && !isConfirmed && (
                        <button
                          type="button"
                          onClick={() => onQueueAction({ type: 'confirm_row', row_id: row.row_id })}
                          className="px-2.5 py-1 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-md"
                        >
                          Confirm Row
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row blockers alert */}
                  {rowBlockers.length > 0 && row.included && (
                    <div className="mb-3 p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300 space-y-0.5">
                      {rowBlockers.map((b, i) => (
                        <div key={i}>• {b.message}</div>
                      ))}
                    </div>
                  )}

                  {/* Expanded evidence drawer */}
                  {expandedEvidence[row.row_id] && (
                    <div className="mb-3 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg text-xs space-y-2 border border-gray-200 dark:border-slate-700 font-mono">
                      <div>
                        <span className="text-gray-500 font-sans font-semibold">Raw Text:</span>{' '}
                        <span>{sourceLine.raw_text || row.raw_text}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                        <div>Description: {sourceLine.description || '—'}</div>
                        <div>Brand: {sourceLine.brand || '—'}</div>
                        <div>Part Number: {sourceLine.part_number || '—'}</div>
                        <div>Printed Total: {sourceLine.printed_line_total || '—'}</div>
                      </div>
                      {sourceLine.enrichment?.status && (
                        <div className="pt-1 text-[11px]">
                          <span className="font-sans font-semibold text-gray-600 dark:text-slate-400">Enrichment:</span>{' '}
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                            {sourceLine.enrichment.status === 'verified_suggestion' ? 'External Source Claim' : sourceLine.enrichment.status}
                          </span>
                          {sourceLine.enrichment.suggested_description && (
                            <div className="mt-1">Suggested: {sourceLine.enrichment.suggested_description}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Row confirmed fields */}
                  {row.included && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                      {/* Part selector */}
                      <div className="md:col-span-2">
                        <label className="block text-gray-600 dark:text-slate-400 mb-1">Catalog Part</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => openCandidates(row.row_id)}
                            className="flex-1 px-3 py-1.5 text-left border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 hover:border-primary-500 truncate"
                          >
                            {cr.part_id ? `Part ID: ${cr.part_id} (${cr.stock_uom})` : 'Select Catalog Part…'}
                          </button>
                        </div>
                      </div>

                      {/* Delivered Qty */}
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1">Delivered Qty</label>
                        <input
                          type="text"
                          value={cr.delivered_quantity || ''}
                          onChange={(e) => updateRow(row.row_id, { delivered_quantity: e.target.value })}
                          className="w-full px-2.5 py-1.5 font-mono border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                        />
                      </div>

                      {/* Cost Classification & Price */}
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1">Unit Cost</label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            disabled={cr.cost_kind === 'free'}
                            value={cr.cost_price || ''}
                            onChange={(e) => updateRow(row.row_id, { cost_price: e.target.value, cost_kind: 'priced' })}
                            className="flex-1 px-2.5 py-1.5 font-mono border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 disabled:opacity-50"
                          />
                          <select
                            value={cr.cost_kind || 'priced'}
                            onChange={(e) => {
                              const kind = e.target.value;
                              updateRow(row.row_id, {
                                cost_kind: kind,
                                cost_price: kind === 'free' ? '0.00' : cr.cost_price,
                              });
                            }}
                            className="px-1.5 py-1.5 text-[11px] border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                          >
                            <option value="priced">Priced</option>
                            <option value="free">Free</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </div>
                      </div>

                      {/* Return Qty and Rejection Reason */}
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1">Return / Rejected</label>
                        <input
                          type="text"
                          value={cr.return_quantity || '0.0000'}
                          onChange={(e) => updateRow(row.row_id, { return_quantity: e.target.value })}
                          className="w-full px-2.5 py-1.5 font-mono border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                        />
                      </div>

                      {Number(cr.return_quantity || 0) > 0 && (
                        <div>
                          <label className="block text-gray-600 dark:text-slate-400 mb-1">Rejection Reason</label>
                          <select
                            value={cr.rejection_reason || ''}
                            onChange={(e) => updateRow(row.row_id, { rejection_reason: e.target.value })}
                            className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                          >
                            <option value="">Select Reason</option>
                            {REJECTION_REASONS.map(r => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Handwritten Price Suggestion and Sale Price */}
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1">Sale Price</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Optional"
                            value={cr.sale_price || ''}
                            onChange={(e) => updateRow(row.row_id, { sale_price: e.target.value })}
                            className="flex-1 px-2.5 py-1.5 font-mono border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                          />
                          {sourceLine.handwritten_sale_price && (
                            <span className="text-[11px] text-gray-500 font-mono" title="Handwritten on document">
                              Doc: {sourceLine.handwritten_sale_price}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => onSaveReview()}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Review'}
            </button>
            <button
              type="button"
              onClick={() => setAbandonModalOpen(true)}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              Abandon
            </button>
          </div>

          <button
            type="button"
            disabled={committing || blockers.length > 0}
            onClick={() => onCommitReview()}
            className="px-5 py-2 text-sm font-semibold rounded-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {committing
              ? 'Creating GRN Draft…'
              : blockers.length > 0
              ? `Cannot Continue (${blockers.length} Blockers)`
              : 'Continue to GRN Draft'}
          </button>
        </div>
      </div>

      {/* Candidate Picker Slide-out */}
      {candidateDrawerRowId && (
        <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shadow-2xl z-60 flex flex-col p-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-slate-800">
            <h4 className="text-sm font-bold text-gray-900 dark:text-slate-100">
              Select Catalog Item
            </h4>
            <button
              type="button"
              onClick={() => setCandidateDrawerRowId(null)}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
            >
              <Icon path={ICONS.close} className="w-4 h-4" />
            </button>
          </div>

          <div className="py-3">
            <input
              type="text"
              placeholder="Search catalog by SKU, detail, or part number…"
              value={candidateSearchQuery}
              onChange={(e) => {
                setCandidateSearchQuery(e.target.value);
                onFetchCandidates(candidateDrawerRowId, e.target.value);
              }}
              className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800">
            {candidatesLoadingRow === candidateDrawerRowId ? (
              <p className="text-xs text-gray-500 py-6 text-center">Searching catalog…</p>
            ) : (candidatesByRow[candidateDrawerRowId] || []).length === 0 ? (
              <p className="text-xs text-gray-500 py-6 text-center">No matching catalog items found.</p>
            ) : (
              (candidatesByRow[candidateDrawerRowId] || []).map((cand) => (
                <div
                  key={cand.part_id}
                  onClick={() => handleSelectCandidate(candidateDrawerRowId, cand)}
                  className="py-2.5 px-2 hover:bg-gray-50 dark:hover:bg-slate-800/60 rounded cursor-pointer transition text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-primary-600 dark:text-primary-400">
                      {cand.internal_sku}
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-slate-400">
                      UOM: {cand.stock_uom}
                    </span>
                  </div>
                  <div className="text-gray-900 dark:text-slate-100 font-medium">{cand.display_name}</div>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span>{cand.brand_name || 'No Brand'}</span>
                    <span>•</span>
                    <span>{cand.group_name || 'No Group'}</span>
                    {cand.last_cost != null && (
                      <>
                        <span>•</span>
                        <span>Last: {formatCurrency(cand.last_cost)}</span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Abandon Modal */}
      {abandonModalOpen && (
        <div className="fixed inset-0 z-70 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-6 space-y-4 border border-gray-200 dark:border-slate-800 shadow-xl">
            <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">
              Abandon Review
            </h4>
            <p className="text-xs text-gray-600 dark:text-slate-400">
              Abandoning this review stops progress. The review is marked abandoned and cannot be committed.
            </p>
            <textarea
              rows={3}
              value={abandonReason}
              onChange={(e) => setAbandonReason(e.target.value)}
              placeholder="Enter reason for abandonment…"
              className="w-full p-2.5 text-xs border border-gray-300 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100"
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAbandonModalOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onAbandonReview(abandonReason || 'User abandoned');
                  setAbandonModalOpen(false);
                  onClose();
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
              >
                Confirm Abandon
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
