import React, { useState, useEffect, useRef } from 'react';
import Modal from '../ui/Modal';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import api from '../../api';

const MAX_PAYLOAD_BYTES = 1048576; // 1 MiB

export default function ImportExtractedJsonDialog({
  isOpen,
  onClose,
  onOpenReview,
  hasDirtyManualForm = false,
  onSaveManualDraftFirst,
}) {
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'saved'
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedReviews, setSavedReviews] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState(null);
  const [confirmManualSave, setConfirmManualSave] = useState(false);
  const fileInputRef = useRef(null);
  const textAreaRef = useRef(null);

  // Fetch saved reviews when switching to 'saved' tab
  useEffect(() => {
    if (isOpen && activeTab === 'saved') {
      setSavedLoading(true);
      setSavedError(null);
      api.get('/goods-receipts/imports', { params: { status: 'IN_REVIEW' } })
        .then(res => {
          setSavedReviews(res.data.items || []);
          setSavedLoading(false);
        })
        .catch(err => {
          setSavedError(err.response?.data?.message || err.message);
          setSavedLoading(false);
        });
    }
  }, [isOpen, activeTab]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_PAYLOAD_BYTES) {
      setParseError(`File size (${(file.size / 1024).toFixed(1)} KB) exceeds 1 MiB limit.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setJsonText(text);
        setParseError(null);
      }
    };
    reader.onerror = () => {
      setParseError('Failed to read file.');
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleStartImport = async () => {
    if (!jsonText.trim()) {
      setParseError('Please paste or upload JSON content.');
      textAreaRef.current?.focus();
      return;
    }

    const byteLen = new Blob([jsonText]).size;
    if (byteLen > MAX_PAYLOAD_BYTES) {
      setParseError(`Payload size (${(byteLen / 1024).toFixed(1)} KB) exceeds 1 MiB limit.`);
      return;
    }

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(jsonText);
    } catch (err) {
      setParseError(`Malformed JSON syntax: ${err.message}`);
      textAreaRef.current?.focus();
      return;
    }

    if (hasDirtyManualForm) {
      setConfirmManualSave(true);
      return;
    }

    await proceedWithPayload(parsedPayload);
  };

  const proceedWithPayload = async (payloadToSubmit) => {
    setSubmitting(true);
    setParseError(null);
    try {
      const requestKey = crypto.randomUUID();
      await onOpenReview({ payload: payloadToSubmit, requestKey });
      onClose();
    } catch (err) {
      const serverMsg = err.response?.data?.message || err.message;
      const path = err.response?.data?.path ? ` [${err.response.data.path}]` : '';
      setParseError(`${serverMsg}${path}`);
      textAreaRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSaveManualAndProceed = async () => {
    setSubmitting(true);
    try {
      if (onSaveManualDraftFirst) {
        await onSaveManualDraftFirst();
      }
      setConfirmManualSave(false);
      const parsed = JSON.parse(jsonText);
      await proceedWithPayload(parsed);
    } catch (err) {
      setSubmitting(false);
      setParseError('Failed to save current work: ' + (err.message || 'unknown error'));
    }
  };

  const handleResumeSavedReview = (importId) => {
    onOpenReview({ importId });
    onClose();
  };

  const handleAbandonSavedReview = async (importId, version) => {
    if (!window.confirm('Are you sure you want to abandon this saved review?')) return;
    try {
      await api.post(`/goods-receipts/imports/${importId}/abandon`, {
        version,
        reason: 'User abandoned from saved reviews list',
      });
      setSavedReviews(prev => prev.filter(r => r.import_id !== importId));
    } catch (err) {
      alert('Failed to abandon review: ' + (err.response?.data?.message || err.message));
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Extracted Document JSON" size="2xl">
      {confirmManualSave ? (
        <div className="space-y-4 py-2">
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-900 dark:text-amber-100 flex items-start gap-3">
            <Icon path={ICONS.warning} className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold">Unsaved Manual Work on Page</h4>
              <p className="text-xs mt-1 text-amber-800 dark:text-amber-200">
                You have active unsaved line items or fields on the goods receipt form. To prevent accidental data loss, save your current work into the draft slot before starting review.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setConfirmManualSave(false)}
              className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmSaveManualAndProceed}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Keep current work and open import'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setActiveTab('new')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                activeTab === 'new'
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400'
              }`}
            >
              New Import
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('saved')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition -mb-px ${
                activeTab === 'saved'
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400'
              }`}
            >
              Saved Reviews
            </button>
          </div>

          {activeTab === 'new' ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                Paste the conforming JSON produced by the vision extraction assistant, or upload a JSON file (max 1 MiB).
              </p>

              {parseError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
                  {parseError}
                </div>
              )}

              <div>
                <textarea
                  ref={textAreaRef}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    if (parseError) setParseError(null);
                  }}
                  rows={10}
                  placeholder='{\n  "schema_version": 1,\n  "document": { ... },\n  "lines": [ ... ],\n  "extraction_issues": [ ... ]\n}'
                  className="w-full p-3 font-mono text-xs border border-gray-300 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
                <div>
                  Payload size: {new Blob([jsonText]).size.toLocaleString()} / {MAX_PAYLOAD_BYTES.toLocaleString()} bytes
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".json,application/json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                  >
                    Upload JSON File
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting || !jsonText.trim()}
                  onClick={handleStartImport}
                  className="px-4 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
                >
                  {submitting ? 'Validating…' : 'Import and Review'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {savedLoading ? (
                <p className="text-xs text-gray-500 dark:text-slate-400 py-4 text-center">Loading saved reviews…</p>
              ) : savedError ? (
                <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg">{savedError}</div>
              ) : savedReviews.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-slate-400 py-8 text-center">
                  No saved reviews in progress.
                </p>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-slate-700 max-h-72 overflow-y-auto">
                  {savedReviews.map((r) => (
                    <div key={r.import_id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-xs font-semibold text-gray-900 dark:text-slate-100">
                          {r.supplier_document_no || 'Untitled document'}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">
                          {r.line_count} line{r.line_count === 1 ? '' : 's'} • Last updated{' '}
                          {new Date(r.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleResumeSavedReview(r.import_id)}
                          className="px-2.5 py-1 text-xs font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-950/40 rounded hover:bg-primary-100"
                        >
                          Resume
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAbandonSavedReview(r.import_id, r.version)}
                          className="px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded"
                        >
                          Abandon
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
