import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';

/**
 * ApplicationSearchCombobox
 * - Fetches applications once and filters client-side as the user types.
 * - value: selected application object or null
 * - onChange: callback(selectedApp)
 * - placeholder: input placeholder text
 */
const ApplicationSearchCombobox = ({ value, onChange, placeholder = 'Search make model engine…', disabled = false, refreshKey = 0 }) => {
  const [apps, setApps] = useState([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debTimer = useRef(null);

  const labelFor = (app) => [app.make, app.model, app.engine].filter(Boolean).join(' ');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/applications');
      setApps(data || []);
    } catch (e) {
      console.error('Failed to load applications:', e);
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = (input || '').trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(a => labelFor(a).toLowerCase().includes(q));
  }, [apps, input]);

  // Debounced remote search via Meilisearch endpoint
  useEffect(() => {
    const q = input.trim();
    if (!open) return; // only search when dropdown is open
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(async () => {
      if (!q) return; // rely on initial load for empty query
      try {
        setLoading(true);
        const { data } = await api.get('/application-search', { params: { q, limit: 15 } });
        if (Array.isArray(data)) setApps(data);
  } catch {
        // silent fallback to local filter
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => debTimer.current && clearTimeout(debTimer.current);
  }, [input, open]);

  const selectedLabel = value ? labelFor(value) : '';

  return (
    <div className="relative">
      <input
        type="text"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        value={open ? input : selectedLabel}
        onChange={(e) => { setInput(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
      />
    {open && !disabled && (
        <ul className="absolute z-10 w-full bg-white border rounded-md mt-1 shadow-lg max-h-60 overflow-y-auto">
          {loading && <li className="px-4 py-2 text-gray-500">Loading…</li>}
      {!loading && filtered.map(app => (
            <li
              key={app.application_id}
              className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
              onMouseDown={() => { onChange(app); setInput(''); setOpen(false); }}
            >
              {labelFor(app)}
            </li>
          ))}
          {!loading && filtered.length === 0 && (
            <li className="px-4 py-2 text-gray-500">No applications found</li>
          )}
        </ul>
      )}
    </div>
  );
};

export default ApplicationSearchCombobox;
