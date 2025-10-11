import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import TemplateCanvas from '../components/cheque/TemplateCanvas';
import FieldInspector from '../components/cheque/FieldInspector';
import TemplateSettingsForm from '../components/cheque/TemplateSettingsForm';
import {
  amountToWords,
  defaultTemplate,
  formatAmountNumeric,
  formatChequeDate,
  normalizeTemplate
} from '../helpers/cheque';
import { useAuth } from '../contexts/AuthContext';

const emptyPrintForm = () => ({
  templateId: '',
  payeeName: '',
  chequeDate: new Date().toISOString().slice(0, 10),
  amount: '',
  memo: '',
  chequeNumber: ''
});

const buildPayloadFromForm = (form, template) => {
  const amountNumeric = Number(form.amount || 0) || 0;
  const settings = template?.settings || {};
  const amountWords = amountToWords(amountNumeric, settings);
  return {
    payee_name: form.payeeName,
    cheque_date: form.chequeDate,
    amount_numeric: amountNumeric,
    amount_in_words: amountWords,
    memo: form.memo,
    cheque_number: form.chequeNumber
  };
};

const sanitizeBase64 = (value) => (typeof value === 'string' ? value.replace(/\s+/g, '') : '');

const createPrintWindowShell = () => {
  const placeholder = window.open('', '_blank', 'noopener,noreferrer');
  if (!placeholder) {
    toast.error('Unable to open print window. Allow pop-ups and try again.');
    return null;
  }

  placeholder.document.write(
    `<!doctype html><html><head><title>Preparing cheque…</title></head><body style="margin:0;padding:2rem;font-family:system-ui;color:#334155;background:#f8fafc;">
      <div style="max-width:340px;margin:auto;text-align:center;">
        <h1 style="font-size:1.1rem;margin-bottom:0.75rem;">Preparing cheque preview…</h1>
        <p style="font-size:0.85rem;line-height:1.4;">This window will update automatically once the cheque layout is ready.</p>
      </div>
    </body></html>`
  );
  placeholder.document.close();
  return placeholder;
};

const renderPrintWindow = (html, existingWindow) => {
  const printWindow = existingWindow && !existingWindow.closed
    ? existingWindow
    : window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    toast.error('Unable to open print window. Allow pop-ups and try again.');
    return null;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  const triggerPrint = () => {
    try {
      printWindow.print();
    } catch (error) {
      console.error('Failed to trigger print dialog', error);
      toast.error('Cheque ready, but the browser blocked the print dialog.');
    }
  };

  if (printWindow.document.readyState === 'complete') {
    triggerPrint();
  } else {
    printWindow.onload = triggerPrint;
  }

  return printWindow;
};

const downloadPdfFromBase64 = (base64, mimeType, fileName) => {
  if (!base64) return;
  try {
    const cleaned = sanitizeBase64(base64);
    const binary = atob(cleaned);
    const byteNumbers = new Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      byteNumbers[index] = binary.charCodeAt(index);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType || 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'cheque.pdf';
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to decode cheque PDF', error);
    toast.error('Cheque created but the PDF could not be downloaded.');
  }
};

const ChequePrinterPage = () => {
  const { hasPermission } = useAuth();
  const canManageTemplates = hasPermission('cheque:template_manage');
  const canPrint = hasPermission('cheque:print');
  const canViewHistory = hasPermission('cheque:records_view');

  const [view, setView] = useState('print');
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [printForm, setPrintForm] = useState(emptyPrintForm);
  const [previewPayload, setPreviewPayload] = useState(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTemplate, setEditorTemplate] = useState(null);
  const [selectedElementKey, setSelectedElementKey] = useState('payee_name');

  const selectedTemplate = useMemo(() => {
    if (!printForm.templateId) return null;
    return templates.find((tpl) => tpl.template_id === printForm.templateId) || null;
  }, [printForm.templateId, templates]);

  const loadTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true);
      const { data } = await api.get('/cheque-templates');
      const normalized = (data || []).map((tpl) => normalizeTemplate(tpl));
      setTemplates(normalized);
      setPrintForm((state) => {
        if (state.templateId && normalized.some((tpl) => tpl.template_id === state.templateId)) {
          return state;
        }
        return { ...state, templateId: normalized[0]?.template_id || '' };
      });
    } catch (error) {
      console.error('Failed to load cheque templates', error);
      toast.error('Failed to load cheque templates');
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      const { data } = await api.get('/cheque-prints', { params: { limit: 50 } });
      setHistory(data || []);
    } catch (error) {
      console.error('Failed to load cheque history', error);
      toast.error('Failed to load cheque history');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (canPrint || canManageTemplates) {
      loadTemplates();
    }
  }, [canPrint, canManageTemplates, loadTemplates]);

  useEffect(() => {
    if (canViewHistory) {
      loadHistory();
    }
  }, [canViewHistory, loadHistory]);

  useEffect(() => {
    if (selectedTemplate) {
      const payload = buildPayloadFromForm(printForm, selectedTemplate);
      setPreviewPayload(payload);
    } else {
      setPreviewPayload(null);
    }
  }, [printForm, selectedTemplate]);

  const handlePrintFormChange = (field) => (event) => {
    const value = event.target ? event.target.value : event;
    setPrintForm((state) => ({ ...state, [field]: value }));
  };

  const handleTemplateEditorChange = (patch) => {
    setEditorTemplate((current) => ({ ...current, ...patch }));
  };

  const handleElementChange = (key, updatedElement) => {
    setEditorTemplate((current) => ({
      ...current,
      elements: current.elements.map((el) => (el.key === key ? { ...el, ...updatedElement } : el))
    }));
  };

  const handleElementReplace = (nextElement) => {
    setEditorTemplate((current) => ({
      ...current,
      elements: current.elements.map((el) => (el.key === nextElement.key ? nextElement : el))
    }));
  };

  const handleCreateTemplate = () => {
    const base = defaultTemplate();
    base.template_name = `Cheque Template ${templates.length + 1}`;
    setEditorTemplate(base);
    setSelectedElementKey('payee_name');
    setEditorOpen(true);
  };

  const handleEditTemplate = (template) => {
    setEditorTemplate(normalizeTemplate(template));
    setSelectedElementKey('payee_name');
    setEditorOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!editorTemplate) return;
    const payload = {
      template_name: editorTemplate.template_name,
      description: editorTemplate.description,
      paper_width_mm: editorTemplate.paper_width_mm,
      paper_height_mm: editorTemplate.paper_height_mm,
      dpi: editorTemplate.dpi,
      margin_top_mm: editorTemplate.margin_top_mm,
      margin_left_mm: editorTemplate.margin_left_mm,
      elements: editorTemplate.elements,
      settings: editorTemplate.settings,
      is_default: editorTemplate.is_default || false
    };

    try {
      const isNew = !editorTemplate.template_id;
      if (isNew) {
        const { data } = await api.post('/cheque-templates', payload);
        toast.success('Template created');
        setTemplates((current) => [...current, normalizeTemplate(data)]);
      } else {
        const { data } = await api.put(`/cheque-templates/${editorTemplate.template_id}`, payload);
        toast.success('Template updated');
        setTemplates((current) => current.map((tpl) => (tpl.template_id === data.template_id ? normalizeTemplate(data) : tpl)));
      }
      setEditorOpen(false);
    } catch (error) {
      console.error('Failed to save template', error);
      toast.error(error?.response?.data?.message || 'Failed to save template');
    }
  };

  const handleDeleteTemplate = async (template) => {
    if (!template?.template_id) return;
    const confirmDelete = window.confirm(`Archive template "${template.template_name}"?`);
    if (!confirmDelete) return;

    try {
      await api.delete(`/cheque-templates/${template.template_id}`);
      toast.success('Template archived');
      setTemplates((current) => {
        const next = current.filter((tpl) => tpl.template_id !== template.template_id);
        setPrintForm((state) => {
          if (state.templateId !== template.template_id) return state;
          return { ...state, templateId: next[0]?.template_id || '' };
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to archive template', error);
      toast.error('Failed to archive template');
    }
  };

  const handleSubmitPrint = async () => {
    if (!selectedTemplate) {
      toast.error('Select a template first');
      return;
    }
    if (!printForm.payeeName.trim()) {
      toast.error('Payee name is required');
      return;
    }
    if (!printForm.amount || Number(printForm.amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    const payload = {
      templateId: selectedTemplate.template_id,
      payeeName: printForm.payeeName.trim(),
      chequeDate: printForm.chequeDate,
      amount: Number(printForm.amount),
      memo: printForm.memo,
      chequeNumber: printForm.chequeNumber
    };

    const pendingPrintWindow = createPrintWindowShell();

    try {
      const { data } = await api.post('/cheque-prints', payload);
      toast.success('Cheque print recorded');

      if (data?.previewHtml) {
        renderPrintWindow(data.previewHtml, pendingPrintWindow);
      } else if (pendingPrintWindow && !pendingPrintWindow.closed) {
        pendingPrintWindow.close();
      }

      if (data?.pdf) {
        downloadPdfFromBase64(data.pdf, data.pdfMimeType, `${payload.chequeNumber || 'cheque'}.pdf`);
      }

      if (canViewHistory) {
        setHistory((current) => [data.chequePrint, ...current]);
      }
    } catch (error) {
      if (pendingPrintWindow && !pendingPrintWindow.closed) {
        pendingPrintWindow.close();
      }
      console.error('Failed to create cheque print', error);
      toast.error(error?.response?.data?.message || 'Failed to create cheque');
    }
  };

  const handleDownloadPdf = async (record) => {
    try {
      const response = await api.get(`/cheque-prints/${record.cheque_print_id}/pdf`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${record.cheque_number || record.cheque_print_id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download cheque PDF', error);
      toast.error('Failed to download PDF');
    }
  };

  const editorSelectedElement = useMemo(() => {
    if (!editorTemplate) return null;
    return editorTemplate.elements.find((el) => el.key === selectedElementKey) || editorTemplate.elements[0];
  }, [editorTemplate, selectedElementKey]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Cheque Printer</h1>
          <p className="text-sm text-slate-500">Configure cheque templates, print cheques, and review print history.</p>
        </div>
        <div className="flex gap-2 text-sm">
          {canPrint && (
            <button
              type="button"
              onClick={() => setView('print')}
              className={`rounded-full px-3 py-1 ${view === 'print' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}
            >
              Print
            </button>
          )}
          {canManageTemplates && (
            <button
              type="button"
              onClick={() => setView('templates')}
              className={`rounded-full px-3 py-1 ${view === 'templates' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}
            >
              Templates
            </button>
          )}
          {canViewHistory && (
            <button
              type="button"
              onClick={() => setView('history')}
              className={`rounded-full px-3 py-1 ${view === 'history' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}
            >
              History
            </button>
          )}
        </div>
      </header>

      {view === 'print' && canPrint && (
        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-700">Cheque Details</h2>
              <div className="mt-4 space-y-3 text-sm">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Template</span>
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                    value={printForm.templateId}
                    onChange={(event) => setPrintForm((state) => ({ ...state, templateId: event.target.value }))}
                  >
                    <option value="">Select template</option>
                    {templates.map((tpl) => (
                      <option key={tpl.template_id} value={tpl.template_id}>
                        {tpl.template_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Payee Name</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                    value={printForm.payeeName}
                    onChange={handlePrintFormChange('payeeName')}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Date</span>
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                    value={printForm.chequeDate}
                    onChange={handlePrintFormChange('chequeDate')}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Amount</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                    value={printForm.amount}
                    onChange={handlePrintFormChange('amount')}
                    step="0.01"
                    min="0"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Cheque Number</span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                    value={printForm.chequeNumber}
                    onChange={handlePrintFormChange('chequeNumber')}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Memo / Notes</span>
                  <textarea
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                    rows={3}
                    value={printForm.memo}
                    onChange={handlePrintFormChange('memo')}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-col gap-2 text-xs text-slate-600">
                {selectedTemplate && (
                  <>
                    <p>
                      <strong>Amount (formatted):</strong> {formatAmountNumeric(printForm.amount || 0, selectedTemplate.settings)}
                    </p>
                    <p>
                      <strong>Amount in Words:</strong> {previewPayload?.amount_in_words || '—'}
                    </p>
                    <p>
                      <strong>Date Rendered:</strong> {formatChequeDate(printForm.chequeDate, selectedTemplate.settings?.dateFormat || 'MMMM DD, YYYY')}
                    </p>
                  </>
                )}
              </div>
              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={handleSubmitPrint}
                  className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                  disabled={!selectedTemplate || loadingTemplates}
                >
                  Print Cheque
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                  onClick={() => setPrintForm(emptyPrintForm())}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-slate-700">Preview</h2>
              {selectedTemplate ? (
                <TemplateCanvas
                  template={selectedTemplate}
                  elements={selectedTemplate.elements}
                  payload={previewPayload}
                  readOnly
                />
              ) : (
                <div className="flex h-64 items-center justify-center rounded border border-dashed border-slate-300 text-sm text-slate-500">
                  Select a template to preview cheque layout
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {view === 'templates' && canManageTemplates && (
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700">Cheque Templates</h2>
            <button
              type="button"
              onClick={handleCreateTemplate}
              className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              New Template
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((tpl) => (
              <div key={tpl.template_id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-slate-700">{tpl.template_name}</h3>
                <p className="text-xs text-slate-500">{tpl.description || 'No description provided'}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                  <div>
                    <dt className="font-medium">Size</dt>
                    <dd>{tpl.paper_width_mm} × {tpl.paper_height_mm} mm</dd>
                  </div>
                  <div>
                    <dt className="font-medium">DPI</dt>
                    <dd>{tpl.dpi}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Created</dt>
                    <dd>{new Date(tpl.created_at).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Updated</dt>
                    <dd>{new Date(tpl.updated_at).toLocaleString()}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => handleEditTemplate(tpl)}
                    className="flex-1 rounded border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(tpl)}
                    className="rounded border border-red-200 px-2 py-1 text-red-500 hover:bg-red-50"
                  >
                    Archive
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editorOpen && editorTemplate && (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm text-sm">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Template Name</span>
                      <input
                        type="text"
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                        value={editorTemplate.template_name}
                        onChange={(event) => handleTemplateEditorChange({ template_name: event.target.value })}
                      />
                    </label>
                    <label className="mt-3 block">
                      <span className="text-xs font-medium text-slate-600">Description</span>
                      <textarea
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 focus:border-blue-500 focus:outline-none"
                        rows={3}
                        value={editorTemplate.description || ''}
                        onChange={(event) => handleTemplateEditorChange({ description: event.target.value })}
                      />
                    </label>
                  </div>
                  <TemplateSettingsForm template={editorTemplate} onChange={setEditorTemplate} />
                </div>
                <div className="space-y-4">
                  <FieldInspector element={editorSelectedElement} onChange={handleElementReplace} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <TemplateCanvas
                  template={editorTemplate}
                  elements={editorTemplate.elements}
                  payload={previewPayload}
                  selectedKey={selectedElementKey}
                  onSelect={setSelectedElementKey}
                  onChange={handleElementChange}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
                >
                  Save Template
                </button>
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {view === 'history' && canViewHistory && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-700">Print History</h2>
            <button
              type="button"
              onClick={loadHistory}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Template</th>
                  <th className="px-3 py-2 text-left">Payee</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Cheque #</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingHistory && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                      Loading history…
                    </td>
                  </tr>
                )}
                {!loadingHistory && history.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                      No cheques printed yet.
                    </td>
                  </tr>
                )}
                {!loadingHistory && history.map((record) => (
                  <tr key={record.cheque_print_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">{new Date(record.printed_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{record.template_name}</td>
                    <td className="px-3 py-2">{record.payee_name}</td>
                    <td className="px-3 py-2 text-right">{formatAmountNumeric(record.amount_numeric)}</td>
                    <td className="px-3 py-2">{record.cheque_number || '—'}</td>
                    <td className="px-3 py-2 capitalize">{record.status}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          onClick={() => handleDownloadPdf(record)}
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                          onClick={async () => {
                            try {
                              const { data } = await api.get(`/cheque-prints/${record.cheque_print_id}/preview`);
                              if (data?.html) renderPrintWindow(data.html);
                            } catch (error) {
                              console.error('Failed to load preview', error);
                              toast.error('Preview unavailable');
                            }
                          }}
                        >
                          Preview
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(!canPrint && !canManageTemplates && !canViewHistory) && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          You do not have permissions to access the cheque printer module. Contact an administrator to request access.
        </div>
      )}
    </div>
  );
};

export default ChequePrinterPage;
