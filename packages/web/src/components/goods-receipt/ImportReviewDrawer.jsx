import React, { useState, useMemo, useEffect } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { formatCurrency } from '../../utils/currency';
import { REJECTION_REASONS } from '../../utils/grnCosting';
import { aiFilledRowFields, aiFilledHeaderFields, normalizeUom } from '../../utils/grnImportReview';

const importFieldClass = ai => `w-full min-w-0 px-3 py-2 border rounded-lg text-gray-900 dark:text-slate-100 ${ai
  ? 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40'
  : 'border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-800'}`;

function SupplierItemText({ row, sourceLine }) {
  const itemText = sourceLine?.supplier_item_text?.trim() || sourceLine?.description?.trim() || row.description?.trim();

  return (
    <section
      aria-label={`Supplier item text for line ${row.line_no}`}
      className="mb-4 min-w-0 text-xs"
    >
      <div className="mb-1 font-semibold text-gray-600 dark:text-slate-400">
        Cleaned Supplier Text
      </div>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-gray-900 dark:text-slate-100">
        {itemText || 'No cleaned item text is available. You can search the catalog manually.'}
      </div>
    </section>
  );
}

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
  candidateResultsByRow = {},
  autoMatchProgress = {},
  onRetryAutomaticMatching,
  onQueueAction,
  onSaveReview,
  onFetchCandidates,
  onCreatePart,
  onAbandonReview,
  onCommitReview,
}) {
  const [needsAttentionFilter, setNeedsAttentionFilter] = useState(false);
  const [candidateDrawerRowId, setCandidateDrawerRowId] = useState(null);
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');
  const [abandonModalOpen, setAbandonModalOpen] = useState(false);
  const [abandonReason, setAbandonReason] = useState('');

  const header = reviewState?.header || {};
  const headerAiFields = aiFilledHeaderFields(header, sourcePayload?.document);
  const rows = reviewState?.rows || [];
  const issues = reviewState?.issues || [];
  const candidateRow = rows.find(row => row.row_id === candidateDrawerRowId);
  const candidateSourceLine = sourcePayload?.lines?.find(line => line.line_no === candidateRow?.line_no);
  const candidateResult = candidateResultsByRow[candidateDrawerRowId];

  useEffect(() => {
    if (!isOpen || !candidateDrawerRowId) return;
    const timer = setTimeout(() => onFetchCandidates(candidateDrawerRowId, candidateSearchQuery || null), 300);
    return () => clearTimeout(timer);
  }, [isOpen, candidateDrawerRowId, candidateSearchQuery, onFetchCandidates, version]);

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
    return blockers.filter(b => (b.scope === 'header' || b.scope === 'document') && b.code !== 'HEADER_CONFIRMATION_REQUIRED');
  }, [blockers]);

  const filteredRows = useMemo(() => {
    if (!needsAttentionFilter) return rows;
    return rows.filter(r => {
      const hasBlockers = !!blockersByRow[r.row_id]?.length;
      const unconfirmed = r.included && !r.confirmed_row?.row_confirmed;
      return hasBlockers || unconfirmed;
    });
  }, [rows, needsAttentionFilter, blockersByRow]);

  // Handle header field updates
  const updateHeader = (values) => {
    onQueueAction({
      type: 'set_header',
      values,
    });
  };

  // Handle row updates
  const updateRow = (rowId, values, reason = null, selectedPart = null) => {
    onQueueAction({
      type: 'set_row',
      row_id: rowId,
      values,
      reason,
    }, selectedPart);
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
  };

  const handleSelectCandidate = (rowId, candidate) => {
    updateRow(rowId, {
      part_id: candidate.part_id,
      stock_uom: normalizeUom(candidate.stock_uom),
    }, null, candidate);
    setCandidateDrawerRowId(null);
  };

  const handleCreatePart = (rowId) => {
    setCandidateDrawerRowId(null);
    onCreatePart(rowId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-7xl bg-white dark:bg-slate-900 h-full flex flex-col shadow-2xl border-l border-gray-200 dark:border-slate-800">
        {/* Top bar */}
        <div className="p-4 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between gap-4 bg-gray-50 dark:bg-slate-800/60">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
                Review Extracted Document
              </h2>
              {hasUnsavedChanges && (
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  Unsaved changes
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              {rows.filter(r => r.included).length} items included · Highlighted fields were filled by AI.
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
                {header.header_confirmed && <span className="text-xs font-normal text-emerald-700 dark:text-emerald-400">Confirmed</span>}
              </h3>
              {!header.header_confirmed && (
                <button
                  type="button"
                  disabled={saving || committing}
                  onClick={() => onQueueAction({ type: 'confirm_header' })}
                  className="px-3 py-1 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
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
                  data-ai-filled={headerAiFields.includes('supplier_id') || undefined}
                  className={importFieldClass(headerAiFields.includes('supplier_id'))}
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
                  data-ai-filled={headerAiFields.includes('supplier_document_no') || undefined}
                  className={importFieldClass(headerAiFields.includes('supplier_document_no'))}
                />
              </div>

              <div>
                <label className="block text-gray-600 dark:text-slate-400 mb-1">Document Type</label>
                <select
                  value={header.supplier_document_type || 'other'}
                  onChange={(e) => updateHeader({ supplier_document_type: e.target.value })}
                  data-ai-filled={headerAiFields.includes('supplier_document_type') || undefined}
                  className={importFieldClass(headerAiFields.includes('supplier_document_type'))}
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
                <div className={`flex items-center gap-2 p-2 rounded-lg ${headerAiFields.includes('confirmed_currency') ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}>
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

              {header.bill_id && (
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
            <details open={issues.some(issue => blockers.some(blocker => blocker.issue_id === issue.issue_id))} className="p-4 rounded-xl border border-gray-200 dark:border-slate-800 space-y-3">
              <summary className="text-sm font-semibold text-gray-900 dark:text-slate-100 cursor-pointer">
                Extraction notes ({issues.length})
              </summary>
              <p className="text-xs text-gray-500 dark:text-slate-400">Unknown values stay blank. Informational notes do not require an explanation or correction.</p>
              <div className="space-y-2 text-xs">
                {issues.map((iss) => (
                  <div
                    key={iss.issue_id}
                    className={`p-2.5 rounded-lg border flex items-center justify-between gap-3 ${
                      iss.resolved
                        ? 'border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30 text-gray-500'
                        : blockers.some(blocker => blocker.issue_id === iss.issue_id)
                          ? 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                          : 'border-gray-200 dark:border-slate-800 text-gray-600 dark:text-slate-300'
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
                    {!iss.resolved && <span className="text-gray-500 shrink-0">
                      {blockers.some(blocker => blocker.issue_id === iss.issue_id) ? 'Re-extract missing content' : 'Informational'}
                    </span>}
                  </div>
                ))}
              </div>
            </details>
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

          <div className="space-y-4">
            {filteredRows.map(row => {
              const cr = row.confirmed_row || {};
              const isConfirmed = cr.row_confirmed && !(blockersByRow[row.row_id] || []).some(blocker => blocker.code === 'ROW_CONFIRMATION_REQUIRED');
              const sourceLine = sourcePayload?.lines?.find(line => line.line_no === row.line_no) || {};
              const aiFields = aiFilledRowFields(row, sourceLine);
              const fieldClass = field => importFieldClass(aiFields.includes(field));
              const rowBlockers = (blockersByRow[row.row_id] || [])
                .filter(blocker => !['ROW_CONFIRMATION_REQUIRED', 'PART_REQUIRED'].includes(blocker.code));
              return (
                <div key={row.row_id} data-import-row={row.row_id}
                  className={`rounded-xl border p-4 ${row.included ? 'border-gray-200 dark:border-slate-800' : 'border-gray-200 bg-gray-50 opacity-70 dark:border-slate-800 dark:bg-slate-800/30'}`}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input type="checkbox" checked={row.included} onChange={() => toggleInclusion(row.row_id, row.included)} className="rounded border-gray-300" />
                      Line {row.line_no}
                    </label>
                    {row.included && (isConfirmed
                      ? <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><Icon path={ICONS.check} className="w-3.5 h-3.5" /> Confirmed</span>
                      : <button type="button" disabled={saving || committing || !cr.part_id}
                          title={!cr.part_id ? 'Select a catalog part first' : 'Confirm this catalog match and save your changes'}
                          onClick={() => onQueueAction({ type: 'confirm_row', row_id: row.row_id })}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                          Confirm Row
                        </button>)}
                  </div>
                  <SupplierItemText row={row} sourceLine={sourceLine} />
                  {!row.included && <p className="text-xs text-gray-500">Excluded: {row.exclusion_reason}</p>}
                  {row.included && <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
                      <div className="sm:col-span-2 lg:col-span-3 min-w-0">
                        <label className="block text-gray-600 dark:text-slate-400 mb-1" htmlFor={`catalog-${row.row_id}`}>Catalog Part</label>
                        <div className="flex gap-2">
                          <button id={`catalog-${row.row_id}`} type="button" onClick={() => openCandidates(row.row_id)} title={cr.part_display_name || undefined}
                            data-ai-filled={aiFields.includes('part_id') || undefined}
                            className={`${fieldClass('part_id')} flex-1 min-w-0 text-left truncate hover:border-primary-500`}>
                            {cr.part_id ? cr.part_display_name || 'Catalog part unavailable' : 'Select Catalog Part…'}
                          </button>
                          {!cr.part_id && onCreatePart && <button type="button" onClick={() => handleCreatePart(row.row_id)} disabled={saving || committing}
                            className="px-3 py-1.5 rounded-lg border border-primary-300 text-primary-700 dark:text-primary-300 font-semibold hover:bg-primary-50 disabled:opacity-50">Create Part</button>}
                        </div>
                      </div>
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1" htmlFor={`qty-${row.row_id}`}>Delivered Qty</label>
                        <input id={`qty-${row.row_id}`} type="text" inputMode="decimal" value={cr.delivered_quantity || ''}
                          data-ai-filled={aiFields.includes('delivered_quantity') || undefined}
                          onChange={e => updateRow(row.row_id, { delivered_quantity: e.target.value })} className={fieldClass('delivered_quantity')} />
                      </div>
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1" htmlFor={`cost-${row.row_id}`}>Unit Cost</label>
                        <input id={`cost-${row.row_id}`} type="text" inputMode="decimal" placeholder="Optional" value={cr.cost_price ?? ''}
                          data-ai-filled={aiFields.includes('cost_price') || undefined}
                          onChange={e => updateRow(row.row_id, { cost_price: e.target.value, cost_kind: e.target.value === '' ? 'unknown' : Number(e.target.value) === 0 ? 'free' : 'priced' })}
                          className={fieldClass('cost_price')} />
                      </div>
                      <div>
                        <label className="block text-gray-600 dark:text-slate-400 mb-1" htmlFor={`sale-${row.row_id}`}>Sale Price</label>
                        <input id={`sale-${row.row_id}`} type="text" inputMode="decimal" placeholder="Optional" value={cr.sale_price ?? ''}
                          data-ai-filled={aiFields.includes('sale_price') || undefined}
                          onChange={e => updateRow(row.row_id, { sale_price: e.target.value })} className={fieldClass('sale_price')} />
                      </div>
                    </div>
                    {rowBlockers.length > 0 && <div className="mt-3 text-xs text-red-700 dark:text-red-300 space-y-1" role="alert">
                      {rowBlockers.map((blocker, index) => <p key={index}>{blocker.message}</p>)}
                    </div>}
                    <details className="mt-3 text-xs text-gray-600 dark:text-slate-400">
                      <summary className="cursor-pointer w-fit hover:text-primary-600">More details{Number(cr.return_quantity) > 0 ? ` · ${cr.return_quantity} returned` : ''}</summary>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
                        <div>
                          <label className="block mb-1" htmlFor={`return-${row.row_id}`}>Return / Rejected</label>
                          <input id={`return-${row.row_id}`} type="text" inputMode="decimal" value={cr.return_quantity || '0.0000'}
                            onChange={e => updateRow(row.row_id, { return_quantity: e.target.value })} className={fieldClass('return_quantity')} />
                        </div>
                        {Number(cr.return_quantity || 0) > 0 && <div>
                          <label className="block mb-1" htmlFor={`rejection-${row.row_id}`}>Rejection Reason</label>
                          <select id={`rejection-${row.row_id}`} value={cr.rejection_reason || ''} onChange={e => updateRow(row.row_id, { rejection_reason: e.target.value })} className={fieldClass('rejection_reason')}>
                            <option value="">Select Reason</option>
                            {REJECTION_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
                          </select>
                        </div>}
                        <div>
                          <label className="block mb-1" htmlFor={`uom-${row.row_id}`}>Stock Unit</label>
                          <input id={`uom-${row.row_id}`} readOnly value={normalizeUom(cr.stock_uom)} data-ai-filled={aiFields.includes('stock_uom') || undefined} className={fieldClass('stock_uom')} />
                        </div>
                        <div>
                          <label className="block mb-1" htmlFor={`factor-${row.row_id}`}>Units per Supplier Unit</label>
                          <input id={`factor-${row.row_id}`} readOnly value={cr.units_per_source_unit || '1.0000'} className={fieldClass('units_per_source_unit')} />
                        </div>
                      </div>
                      <p className="mt-3">Brand: {sourceLine.brand || '—'} · Part number: {sourceLine.part_number || '—'} · Group: {sourceLine.item_group_hint || '—'}</p>
                      {sourceLine.handwritten_sale_price && <p className="mt-1">Handwritten sale price: {sourceLine.handwritten_sale_price}</p>}
                      <p className="mt-1">Prices can be completed in the GRN draft. A blank unit cost starts at 0.</p>
                    </details>
                  </>}
                </div>
              );
            })}
          </div>
        </div>

        {autoMatchProgress.total > 0 && (
          <div role="status" className="border-t border-gray-200 dark:border-slate-800 px-4 py-2 text-xs text-gray-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
            <span>
              {autoMatchProgress.status === 'running'
                ? `Matching catalog parts… ${autoMatchProgress.processed} / ${autoMatchProgress.total} checked · ${autoMatchProgress.matched} matched`
                : `${autoMatchProgress.matched} automatically matched · ${rows.filter(row => row.included && !row.confirmed_row?.part_id).length} need review`}
              {autoMatchProgress.status === 'error' && ' · Some matches could not be completed or saved.'}
            </span>
            {autoMatchProgress.status !== 'running' && onRetryAutomaticMatching && rows.some(row => row.included && !row.confirmed_row?.part_id) && (
              <button type="button" onClick={onRetryAutomaticMatching} disabled={saving || committing} className="font-semibold text-primary-600 dark:text-primary-400 disabled:opacity-50">Retry automatic matching</button>
            )}
          </div>
        )}

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
            disabled={committing || saving || autoMatchProgress.status === 'running' || blockers.length > 0}
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
        <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 shadow-2xl z-60 flex flex-col p-4">
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

          {candidateRow && <SupplierItemText row={candidateRow} sourceLine={candidateSourceLine} />}

          <div className="py-3">
            <input
              type="text"
              placeholder="Search catalog by group, brand, part number, or details…"
              value={candidateSearchQuery}
              onChange={(e) => {
                setCandidateSearchQuery(e.target.value);
              }}
              className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {candidateResult && candidatesLoadingRow !== candidateDrawerRowId && (
            <div role="status" className="mb-3 rounded-lg bg-gray-50 dark:bg-slate-800 p-3 text-xs text-gray-600 dark:text-slate-300">
              {candidateResult.search_status === 'unavailable'
                ? 'Catalog search is unavailable. Try again before creating a part.'
                : candidateResult.search_status === 'partial'
                ? 'Some catalog lookups are unavailable. Results may be incomplete; try again before creating a part.'
                : candidateResult.verification?.status === 'match'
                ? 'Jev recommends a catalog match below. Review the supplier text before selecting it.'
                : candidateResult.verification?.status === 'no_match'
                ? 'Jev found no reliable match among these results. You can search again or review the alternatives.'
                : candidateResult.verification?.status === 'uncertain'
                ? 'Jev is uncertain whether these items match the supplier text. Review the details carefully.'
                : candidateResult.verification?.status === 'missing_item_text'
                ? 'Cleaned item text is missing. Include supplier_item_text in the import to enable automatic matching, or search manually.'
                : candidateResult.verification?.status === 'no_candidates'
                ? 'No candidates found for Jev to compare. Try another search or create a part.'
                : 'Jev verification is unavailable. Catalog results are available for manual review.'}
            </div>
          )}

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-800">
            {candidatesLoadingRow === candidateDrawerRowId ? (
              <p className="text-xs text-gray-500 py-6 text-center">Searching catalog…</p>
            ) : (candidatesByRow[candidateDrawerRowId] || []).length === 0 ? (
              <p className="text-xs text-gray-500 py-6 text-center">{['unavailable', 'partial'].includes(candidateResult?.search_status) ? 'Search could not be completed.' : candidateResult ? 'No matching catalog items found.' : 'Searching catalog…'}</p>
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
                      UOM: {normalizeUom(cand.stock_uom)}
                    </span>
                  </div>
                  <div className="text-gray-900 dark:text-slate-100 font-medium">{cand.display_name}</div>
                  {cand.part_numbers?.length > 0 && <div className="font-mono text-[11px] text-gray-600 dark:text-slate-400">{cand.part_numbers.join(' · ')}</div>}
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {cand.match_evidence?.identifier && <span className="rounded bg-blue-100 dark:bg-blue-950 px-1.5 py-0.5 text-blue-800 dark:text-blue-200">Part number / SKU</span>}
                    {cand.match_evidence?.brand && <span className="rounded bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5">Brand matches</span>}
                    {cand.match_evidence?.group && <span className="rounded bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5">Group matches</span>}
                    {cand.jev_verification?.status === 'recommended' && <span className="rounded bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-200">Jev recommends · {Math.round(cand.jev_verification.confidence * 100)}%</span>}
                  </div>
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

          {candidateRow?.included && onCreatePart && (
            <div className="pt-3 border-t border-gray-200 dark:border-slate-800">
              <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">Item not in the catalog yet?</p>
              <button
                type="button"
                onClick={() => handleCreatePart(candidateRow.row_id)}
                disabled={saving || committing}
                className="w-full px-3 py-2 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 disabled:opacity-50"
              >
                Create Part
              </button>
            </div>
          )}
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
