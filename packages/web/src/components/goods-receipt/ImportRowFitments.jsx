import { useEffect, useState } from 'react';
import api from '../../api';
import { fitmentSavePayload } from '../../utils/engineCodeFormat';
import { formatSearchFitments } from '../../helpers/searchFitmentText';

const describe = c => formatSearchFitments({ fitment_rules: [c] });
const identity = c => JSON.stringify(['make_id', 'model_id', 'engine_id', 'chassis_id', 'year_start', 'year_end']
  .map(k => c[k] ?? c[k === 'year_start' ? 'link_year_start' : k === 'year_end' ? 'link_year_end' : k] ?? null));

/**
 * Shows AI-extracted vehicle applications for an import line. Once the catalog part
 * is confirmed, applications the part lacks are linked automatically.
 */
export default function ImportRowFitments({ text, partId, confirmed, canEdit }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!text?.trim()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post('/applications/parse-fitment-text', { text: text.trim().slice(0, 2000) });
        let list = (data.fitments || []).map(c => ({ ...c, state: c.confidence_label === 'unresolved' || c.alternative_group_id ? 'review' : 'new' }));
        if (partId) {
          const { data: linked } = await api.get(`/parts/${partId}/applications`);
          const have = new Set(linked.map(identity));
          list = list.map(c => (c.state === 'new' && have.has(identity(c)) ? { ...c, state: 'linked' } : c));
          if (confirmed && canEdit) {
            for (const c of list) {
              if (c.state !== 'new') continue;
              try {
                await api.post(`/parts/${partId}/applications`, fitmentSavePayload(c));
                c.state = 'linked';
              } catch (err) {
                c.state = 'failed';
                c.error = err.response?.data?.message || err.message;
              }
            }
          }
        }
        if (!cancelled) { setItems(list); setError(''); }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [text, partId, confirmed, canEdit]);

  if (!text?.trim()) return null;
  const label = { linked: 'Linked', new: partId ? 'Links on confirm' : 'Links when part is created', review: 'Needs manual review', failed: 'Failed' };
  return (
    <div className="mt-3 text-xs" data-import-fitments>
      <p className="font-semibold text-gray-600 dark:text-slate-400 mb-1">Vehicle applications</p>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {!items && !error && <p className="text-gray-500">Reading applications…</p>}
      {items?.length === 0 && <p className="text-gray-500">No vehicles recognized: {text}</p>}
      <ul className="space-y-1">
        {items?.map((c, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span>{describe(c)}</span>
            <span className={c.state === 'linked' ? 'text-emerald-600' : c.state === 'failed' ? 'text-red-600' : 'text-gray-500'}
              title={c.error}>{label[c.state]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
