const toNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const TemplateSettingsForm = ({ template, onChange }) => {
  if (!template) return null;

  const updateTemplate = (patch) => {
    onChange && onChange({ ...template, ...patch });
  };

  const updateSettings = (patch) => {
    onChange && onChange({ ...template, settings: { ...template.settings, ...patch } });
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Template Settings</h3>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="font-medium text-slate-600">
          Paper Width (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.paper_width_mm}
            step="0.5"
            onChange={(event) => updateTemplate({ paper_width_mm: Math.max(50, toNumber(event.target.value, template.paper_width_mm)) })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Paper Height (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.paper_height_mm}
            step="0.5"
            onChange={(event) => updateTemplate({ paper_height_mm: Math.max(50, toNumber(event.target.value, template.paper_height_mm)) })}
          />
        </label>
        <label className="font-medium text-slate-600">
          DPI
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.dpi}
            step="10"
            onChange={(event) => updateTemplate({ dpi: Math.max(72, Math.round(toNumber(event.target.value, template.dpi))) })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Margin Top (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.margin_top_mm || 0}
            step="0.5"
            onChange={(event) => updateTemplate({ margin_top_mm: toNumber(event.target.value, template.margin_top_mm || 0) })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Margin Left (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.margin_left_mm || 0}
            step="0.5"
            onChange={(event) => updateTemplate({ margin_left_mm: toNumber(event.target.value, template.margin_left_mm || 0) })}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="font-medium text-slate-600">
          Currency Symbol
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.settings.currencySymbol || ''}
            maxLength={6}
            onChange={(event) => updateSettings({ currencySymbol: event.target.value })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Currency Label
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.settings.currencyLabel || ''}
            onChange={(event) => updateSettings({ currencyLabel: event.target.value })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Sub-currency Label
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.settings.subCurrencyLabel || ''}
            onChange={(event) => updateSettings({ subCurrencyLabel: event.target.value })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Amount Words Joiner
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.settings.amountWordsJoiner || 'and'}
            onChange={(event) => updateSettings({ amountWordsJoiner: event.target.value })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Amount Words Suffix
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.settings.amountWordsSuffix || 'ONLY'}
            onChange={(event) => updateSettings({ amountWordsSuffix: event.target.value })}
          />
        </label>
        <label className="font-medium text-slate-600">
          Amount Decimals
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={template.settings.decimals ?? 2}
            min="0"
            max="4"
            onChange={(event) => updateSettings({ decimals: Math.max(0, Math.min(4, toNumber(event.target.value, template.settings.decimals ?? 2))) })}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <label className="flex items-center gap-2 font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={template.settings.useThousandsSeparator !== false}
            onChange={(event) => updateSettings({ useThousandsSeparator: event.target.checked })}
          />
          Use thousands separator
        </label>
        <label className="flex items-center gap-2 font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={template.settings.showCurrencyAfter === true}
            onChange={(event) => updateSettings({ showCurrencyAfter: event.target.checked })}
          />
          Show currency after amount
        </label>
        <label className="flex items-center gap-2 font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={template.settings.enforceUppercase !== false}
            onChange={(event) => updateSettings({ enforceUppercase: event.target.checked })}
          />
          Uppercase amount words
        </label>
        <label className="flex items-center gap-2 font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={template.settings.preserveCase === true}
            onChange={(event) => updateSettings({ preserveCase: event.target.checked })}
          />
          Preserve original case
        </label>
      </div>

      <label className="text-xs font-medium text-slate-600">
        Date Format
        <input
          type="text"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          value={template.settings.dateFormat || 'MMMM DD, YYYY'}
          onChange={(event) => updateSettings({ dateFormat: event.target.value })}
          placeholder="e.g. MMMM DD, YYYY"
        />
      </label>
    </div>
  );
};

export default TemplateSettingsForm;
