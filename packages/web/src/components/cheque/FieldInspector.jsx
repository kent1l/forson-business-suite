const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const FieldInspector = ({ element, onChange }) => {
  if (!element) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
        Select a field on the cheque canvas to adjust its properties.
      </div>
    );
  }

  const handleChange = (key, transformer = (v) => v) => (event) => {
    const value = transformer(event.target.value);
    onChange && onChange({ ...element, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-700">Field Details</h3>
        <p className="text-xs text-slate-500">{element.label}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          X (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.x_mm}
            step="0.5"
            onChange={handleChange('x_mm', (v) => toNumber(v, element.x_mm))}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Y (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.y_mm}
            step="0.5"
            onChange={handleChange('y_mm', (v) => toNumber(v, element.y_mm))}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Width (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.width_mm}
            step="0.5"
            onChange={handleChange('width_mm', (v) => Math.max(1, toNumber(v, element.width_mm)))}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Height (mm)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.height_mm}
            step="0.5"
            onChange={handleChange('height_mm', (v) => Math.max(1, toNumber(v, element.height_mm)))}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          Font Family
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.fontFamily || ''}
            onChange={handleChange('fontFamily')}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Font Size (pt)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.fontSizePt}
            min="6"
            step="0.5"
            onChange={handleChange('fontSizePt', (v) => Math.max(6, toNumber(v, element.fontSizePt)))}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Line Height
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.lineHeight || 1.2}
            min="0.8"
            step="0.05"
            onChange={handleChange('lineHeight', (v) => Math.max(0.5, toNumber(v, element.lineHeight || 1.2)))}
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Letter Spacing (pt)
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.letterSpacing || 0}
            step="0.1"
            onChange={handleChange('letterSpacing', (v) => toNumber(v, element.letterSpacing || 0))}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium text-slate-600">
          Font Weight
          <select
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.fontWeight || 'normal'}
            onChange={handleChange('fontWeight')}
          >
            <option value="normal">Normal</option>
            <option value="bold">Bold</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Font Style
          <select
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.fontStyle || 'normal'}
            onChange={handleChange('fontStyle')}
          >
            <option value="normal">Normal</option>
            <option value="italic">Italic</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Text Align
          <select
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            value={element.textAlign || 'left'}
            onChange={handleChange('textAlign')}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            checked={Boolean(element.uppercase)}
            onChange={(event) => onChange && onChange({ ...element, uppercase: event.target.checked })}
          />
          Uppercase text
        </label>
      </div>
      <label className="text-xs font-medium text-slate-600">
        Fallback Text
        <input
          type="text"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          value={element.fallbackText || ''}
          onChange={handleChange('fallbackText')}
          placeholder="Displayed if no value provided"
        />
      </label>
    </div>
  );
};

export default FieldInspector;
