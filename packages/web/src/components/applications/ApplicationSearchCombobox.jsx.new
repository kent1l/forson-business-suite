import { useEffect, useRef, useState } from 'react';
import api from '../../api';

/**
 * ApplicationSearchCombobox
 * - Uses Meilisearch for real-time search as you type
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

  // Load initial data (recent/popular items) when empty
  const loadInitial = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/application-search', { params: { limit: 15 } });
      setApps(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load applications:', e);
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInitial(); }, [refreshKey]);

  // Debounced search using Meilisearch
  useEffect(() => {
    const q = input.trim();
    if (!open) return; // only search when dropdown is open
    if (debTimer.current) clearTimeout(debTimer.current);

    debTimer.current = setTimeout(async () => {
      try {
        setLoading(true);
        const { data } = await api.get('/application-search', { 
          params: { 
            q,
            limit: 15 
          } 
        });
        if (Array.isArray(data)) setApps(data);
      } catch (error) {
        console.error('Search failed:', error);
        setApps([]);
      } finally {
        setLoading(false);
      }
    }, 150);

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
          {!loading && apps.map(app => (
            <li
              key={app.application_id}
              className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
              onMouseDown={() => { onChange(app); setInput(''); setOpen(false); }}
            >
              {labelFor(app)}
            </li>
          ))}
          {!loading && apps.length === 0 && (
            <li className="px-4 py-2 text-gray-500">No applications found</li>
          )}
        </ul>
      )}
    </div>
  );
};

export default ApplicationSearchCombobox;
