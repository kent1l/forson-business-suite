import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

export default function CycleCountControlsTab() {
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [employees, setEmployees] = useState([]);
    const [empLoading, setEmpLoading] = useState(true);
    const [partSearch, setPartSearch] = useState('');
    const [partResults, setPartResults] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [selectedPart, setSelectedPart] = useState(null);
    const [assigning, setAssigning] = useState(false);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        setEmpLoading(true);
        api.get('/inventory/cycle-count/employees')
            .then(res => setEmployees(res.data))
            .catch(() => toast.error('Failed to load employees.'))
            .finally(() => setEmpLoading(false));
    }, []);

    const handleTriggerBatch = async () => {
        if (!window.confirm('Manually trigger batch generation now? This will run the priority algorithm and assign items to eligible employees.')) return;
        setTriggerLoading(true);
        try {
            const res = await api.post('/inventory/cycle-count/trigger-batch');
            toast.success(res.data.message || 'Batch generation triggered.');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to trigger batch generation.');
        } finally {
            setTriggerLoading(false);
        }
    };

    const handlePartSearch = async (e) => {
        e.preventDefault();
        if (!partSearch.trim()) return;
        setSearching(true);
        setPartResults([]);
        setSelectedPart(null);
        try {
            const res = await api.get(`/parts?search=${encodeURIComponent(partSearch)}&limit=20`);
            // Support both array and paginated shapes
            const items = Array.isArray(res.data) ? res.data : (res.data.rows || res.data.data || []);
            setPartResults(items);
            if (items.length === 0) toast('No parts found.', { icon: 'ℹ️' });
        } catch {
            toast.error('Part search failed.');
        } finally {
            setSearching(false);
        }
    };

    const handleAssign = async () => {
        if (!selectedEmployee || !selectedPart) {
            toast.error('Select both an employee and a part.');
            return;
        }
        setAssigning(true);
        try {
            await api.post('/inventory/cycle-count/assign-item', {
                employee_id: parseInt(selectedEmployee, 10),
                part_id: selectedPart.part_id,
            });
            toast.success(`Assigned "${selectedPart.display_name || selectedPart.detail}" to employee.`);
            setSelectedPart(null);
            setPartResults([]);
            setPartSearch('');
            // Refresh employee list to update pending count
            const updated = await api.get('/inventory/cycle-count/employees');
            setEmployees(updated.data);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Assignment failed.');
        } finally {
            setAssigning(false);
        }
    };

    return (
        <div className="cycle-count-controls space-y-8">
            {/* ── Manual Batch Trigger ── */}
            <section className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-base font-semibold mb-1">Manual Batch Generation</h3>
                <p className="text-sm text-gray-500 mb-4">
                    Runs the priority-scoring algorithm immediately and distributes items to eligible employees.
                    Normally this runs on the configured cron schedule.
                </p>
                <button
                    onClick={handleTriggerBatch}
                    disabled={triggerLoading}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg shadow-sm transition-colors"
                >
                    {triggerLoading ? (
                        <><span className="animate-spin">⟳</span> Triggering…</>
                    ) : (
                        <>⚡ Trigger Batch Now</>
                    )}
                </button>
            </section>

            {/* ── Manual Item Assignment ── */}
            <section className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-base font-semibold mb-1">Manual Item Assignment</h3>
                <p className="text-sm text-gray-500 mb-4">
                    Directly assign a specific part to an employee's pending batch queue.
                </p>

                {/* Employee picker */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                    {empLoading ? (
                        <p className="text-sm text-gray-400">Loading employees…</p>
                    ) : (
                        <select
                            value={selectedEmployee}
                            onChange={e => setSelectedEmployee(e.target.value)}
                            className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">— Select Employee —</option>
                            {employees.map(emp => (
                                <option key={emp.employee_id} value={emp.employee_id}>
                                    {emp.employee_name} ({emp.pending_items || 0} pending)
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                {/* Part search */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Part Search</label>
                    <form onSubmit={handlePartSearch} className="flex gap-2 max-w-lg">
                        <input
                            type="text"
                            value={partSearch}
                            onChange={e => setPartSearch(e.target.value)}
                            placeholder="Search by SKU, name, or barcode…"
                            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            type="submit"
                            disabled={searching}
                            className="bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            {searching ? '…' : 'Search'}
                        </button>
                    </form>

                    {partResults.length > 0 && (
                        <ul className="mt-2 border border-gray-200 rounded-lg divide-y max-w-lg max-h-48 overflow-y-auto">
                            {partResults.map(p => (
                                <li
                                    key={p.part_id}
                                    onClick={() => { setSelectedPart(p); setPartResults([]); setPartSearch(p.display_name || p.detail || ''); }}
                                    className={`px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm flex items-center gap-2 ${selectedPart?.part_id === p.part_id ? 'bg-blue-50 font-semibold' : ''}`}
                                >
                                    <span className="font-mono text-xs text-gray-500 shrink-0">{p.internal_sku}</span>
                                    <span className="truncate">{p.display_name || p.detail}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Selected summary */}
                {selectedPart && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 max-w-lg">
                        <strong>Selected:</strong> {selectedPart.display_name || selectedPart.detail}{' '}
                        <span className="font-mono text-xs">({selectedPart.internal_sku})</span>
                    </div>
                )}

                <button
                    onClick={handleAssign}
                    disabled={assigning || !selectedEmployee || !selectedPart}
                    className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white font-semibold py-2 px-5 rounded-lg shadow-sm transition-colors"
                >
                    {assigning ? 'Assigning…' : '➕ Assign Item'}
                </button>
            </section>

            {/* ── Employee Workload Overview ── */}
            <section className="border border-gray-200 rounded-lg p-5">
                <h3 className="text-base font-semibold mb-3">Employee Workload</h3>
                {empLoading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                ) : employees.length === 0 ? (
                    <p className="text-sm text-gray-500">No eligible employees found.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm border border-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="py-2 px-3 border-b text-left">Employee</th>
                                    <th className="py-2 px-3 border-b text-center">Active Batches</th>
                                    <th className="py-2 px-3 border-b text-center">Pending Items</th>
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(emp => (
                                    <tr key={emp.employee_id} className="border-b hover:bg-gray-50">
                                        <td className="py-2 px-3 font-medium">{emp.employee_name}</td>
                                        <td className="py-2 px-3 text-center">{emp.active_batches || 0}</td>
                                        <td className="py-2 px-3 text-center">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${parseInt(emp.pending_items) > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {emp.pending_items || 0}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
