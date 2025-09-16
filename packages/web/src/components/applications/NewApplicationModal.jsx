import { useState } from 'react';
import api from '../../api';
// eslint-disable-next-line no-unused-vars
import Modal from '../ui/Modal';

const NewApplicationModal = ({ isOpen, onClose, onCreated }) => {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [engine, setEngine] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!make || !model) return;
    setSaving(true);
    try {
      const { data } = await api.post('/applications', { make, model, engine: engine || undefined });
      onCreated?.(data);
      onClose?.();
      setMake(''); setModel(''); setEngine('');
    } catch (e) {
      alert(e.response?.data?.message || e.message || 'Failed to create application');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add New Application">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
          <input className="w-full px-3 py-2 border rounded-lg" value={make} onChange={e => setMake(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
          <input className="w-full px-3 py-2 border rounded-lg" value={model} onChange={e => setModel(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Engine (optional)</label>
          <input className="w-full px-3 py-2 border rounded-lg" value={engine} onChange={e => setEngine(e.target.value)} />
        </div>
        <div className="mt-6 flex justify-end space-x-3">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg">{saving ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
};

export default NewApplicationModal;
