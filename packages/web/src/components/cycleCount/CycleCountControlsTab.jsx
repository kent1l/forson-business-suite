import React, { useState, useEffect, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

export default function CycleCountControlsTab() {
    const [triggerLoading, setTriggerLoading] = useState(false);
    const [employees, setEmployees] = useState([]);
    const [empLoading, setEmpLoading] = useState(true);

    // Part search state
    const [partQuery, setPartQuery] = useState('');
    const [partSuggestions, setPartSuggestions] = useState([]);
    const [searching, setSearching] = useState(false);
    const [selectedPart, setSelectedPart] = useState(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const searchRef = useRef(null);

    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [assigning, setAssigning] = useState(false);

    const fetchEmployees = async () => {
        setEmpLoading(true);
        try {
            const res = await api.get('/inventory/cycle-count/employees');
            setEmployees(res.data);
        } catch {
            toast.error('Failed to load employees.');
        } finally {
            setEmpLoading(false);
        }
    };

    useEffect(() => { fetchEmployees(); }, []);

    // Debounced Meilisearch part suggestions
    useEffect(() => {
        if (selectedPart) return;
        const q = partQuery.trim();
        if (q.length < 2) {
            setPartSuggestions([]);
            setDropdownOpen(false);
            return;
        }
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await api.get('/power-search/parts', {
                    params: { keyword: q, status: 'active' },
                    signal: controller.signal,
                });
                const results = Array.isArray(res.data) ? res.data : (res.data?.data || []);
                setPartSuggestions(results.slice(0, 20));
                setDropdownOpen(results.length > 0);
            } catch (err) {
                if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
                setPartSuggestions([]);
            } finally {
                if (!controller.signal.aborted) setSearching(false);
            }
        }, 280);
        return () => { controller.abort(); clearTimeout(timer); };
    }, [partQuery, selectedPart]);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e) => {
            if (searchRef.current && !searchRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleSelectPart = (part) => {
        setSelectedPart(part);
        setPartQuery(part.display_name || part.detail || part.internal_sku || '');
        setDropdownOpen(false);
        setPartSuggestions([]);
    };

    const handlePartQueryChange = (e) => {
        setPartQuery(e.target.value);
        setSelectedPart(null); // clear selection when user types again
    };

    const handleTriggerBatch = async () => {
        if (!window.confirm('Manually trigger batch generation now? This runs the priority algorithm and assigns items to eligible employees.')) return;
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
            setPartQuery('');
            setPartSuggestions([]);
            await fetchEmployees();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Assignment failed.');
        } finally {
            setAssigning(false);
        }
    };

    const handleRemoveItem = async (lineId, partName, empName) => {
        if (!window.confirm(`Remove "${partName}" from ${empName}'s queue?`)) return;
        try {
            await api.delete(`/inventory/cycle-count/lines/${lineId}`);
            toast.success('Item removed from queue.');
            await fetchEmployees();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to remove item.');
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
                    {triggerLoading ? <><span className="animate-spin">⟳</span> Triggering…</> : <>⚡ Trigger Batch Now</>}
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

                {/* Meilisearch part search with dropdown */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Part Search</label>
                    <div className="relative max-w-lg" ref={searchRef}>
                        <input
                            type="text"
                            value={partQuery}
                            onChange={handlePartQueryChange}
                            onFocus={() => partSuggestions.length > 0 && setDropdownOpen(true)}
                            placeholder="Type SKU, name, or barcode…"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8"
                            autoComplete="off"
                        />
                        {/* Spinner / clear */}
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
                            {searching ? '⟳' : partQuery && <button onClick={() => { setPartQuery(''); setSelectedPart(null); setDropdownOpen(false); }} className="hover:text-gray-700">✕</button>}
                        </span>

                        {dropdownOpen && partSuggestions.length > 0 && (
                            <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                                {partSuggestions.map(p => (
                                    <li
                                        key={p.part_id}
                                        onMouseDown={() => handleSelectPart(p)}
                                        className={`px-3 py-2 cursor-pointer hover:bg-blue-50 text-sm flex items-center gap-2 ${selectedPart?.part_id === p.part_id ? 'bg-blue-50' : ''}`}
                                    >
                                        <span className="font-mono text-xs text-gray-400 shrink-0 w-24 truncate">{p.internal_sku}</span>
                                        <span className="truncate">{p.display_name || p.detail}</span>
                                        {p.stock_on_hand !== undefined && (
                                            <span className="ml-auto text-xs text-gray-400 shrink-0">Stock: {p.stock_on_hand}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    {partQuery.length >= 2 && !searching && partSuggestions.length === 0 && !selectedPart && (
                        <p className="text-xs text-gray-400 mt-1">No parts found.</p>
                    )}
                </div>

                {selectedPart && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 max-w-lg flex items-center justify-between">
                        <span>
                            <strong>Selected:</strong> {selectedPart.display_name || selectedPart.detail}{' '}
                            <span className="font-mono text-xs">({selectedPart.internal_sku})</span>
                        </span>
                        <button onClick={() => { setSelectedPart(null); setPartQuery(''); }} className="text-blue-400 hover:text-blue-700 text-lg leading-none ml-2">✕</button>
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
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold">Employee Workload</h3>
                    <button
                        onClick={fetchEmployees}
                        disabled={empLoading}
                        className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 transition-colors"
                    >
                        {empLoading ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                </div>
                {empLoading ? (
                    <p className="text-sm text-gray-400">Loading…</p>
                ) : employees.length === 0 ? (
                    <p className="text-sm text-gray-500">No eligible employees found.</p>
                ) : (
                    <EmployeeWorkloadTable employees={employees} onRemoveItem={handleRemoveItem} />
                )}
            </section>
        </div>
    );
}

function EmployeeWorkloadTable({ employees, onRemoveItem }) {
    const [expanded, setExpanded] = useState(null);
    const [pendingLines, setPendingLines] = useState({});
    const [loadingEmp, setLoadingEmp] = useState(null);

    const toggleExpand = async (empId) => {
        if (expanded === empId) {
            setExpanded(null);
            return;
        }
        setExpanded(empId);
        if (pendingLines[empId]) return; // already loaded
        setLoadingEmp(empId);
        try {
            const res = await api.get(`/inventory/cycle-count/employees/${empId}/detail`);
            setPendingLines(prev => ({ ...prev, [empId]: res.data.pending_lines }));
        } catch {
            toast.error('Failed to load pending items.');
        } finally {
            setLoadingEmp(null);
        }
    };

    const removeItem = async (lineId, partName, empId, empName) => {
        await onRemoveItem(lineId, partName, empName);
        // Refresh the expanded employee's pending list
        setPendingLines(prev => {
            const updated = (prev[empId] || []).filter(l => l.line_id !== lineId);
            return { ...prev, [empId]: updated };
        });
    };

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="py-2 px-3 border-b text-left">Employee</th>
                        <th className="py-2 px-3 border-b text-center">Active Batches</th>
                        <th className="py-2 px-3 border-b text-center">Pending Items</th>
                        <th className="py-2 px-3 border-b text-center">Manage</th>
                    </tr>
                </thead>
                <tbody>
                    {employees.map(emp => (
                        <React.Fragment key={emp.employee_id}>
                            <tr className="border-b hover:bg-gray-50">
                                <td className="py-2 px-3 font-medium">{emp.employee_name}</td>
                                <td className="py-2 px-3 text-center">{emp.active_batches || 0}</td>
                                <td className="py-2 px-3 text-center">
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${parseInt(emp.pending_items) > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>
                                        {emp.pending_items || 0}
                                    </span>
                                </td>
                                <td className="py-2 px-3 text-center">
                                    {parseInt(emp.pending_items) > 0 && (
                                        <button
                                            onClick={() => toggleExpand(emp.employee_id)}
                                            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 transition-colors"
                                        >
                                            {expanded === emp.employee_id ? '▲ Hide' : '▼ View Items'}
                                        </button>
                                    )}
                                </td>
                            </tr>

                            {expanded === emp.employee_id && (
                                <tr>
                                    <td colSpan={4} className="bg-gray-50 px-4 py-3 border-b">
                                        {loadingEmp === emp.employee_id ? (
                                            <p className="text-xs text-gray-400">Loading items…</p>
                                        ) : (pendingLines[emp.employee_id] || []).length === 0 ? (
                                            <p className="text-xs text-gray-400">No pending items.</p>
                                        ) : (
                                            <table className="min-w-full text-xs border border-gray-200 rounded bg-white">
                                                <thead className="bg-gray-100">
                                                    <tr>
                                                        <th className="py-1.5 px-3 border-b text-left">Part</th>
                                                        <th className="py-1.5 px-3 border-b text-left">SKU</th>
                                                        <th className="py-1.5 px-3 border-b text-center">Batch</th>
                                                        <th className="py-1.5 px-3 border-b text-center">Remove</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(pendingLines[emp.employee_id] || []).map(line => (
                                                        <tr key={line.line_id} className="border-b hover:bg-red-50">
                                                            <td className="py-1.5 px-3 max-w-xs truncate">{line.display_name}</td>
                                                            <td className="py-1.5 px-3 font-mono">{line.internal_sku}</td>
                                                            <td className="py-1.5 px-3 text-center text-gray-500">{line.batch_id}</td>
                                                            <td className="py-1.5 px-3 text-center">
                                                                <button
                                                                    onClick={() => removeItem(line.line_id, line.display_name || line.internal_sku, emp.employee_id, emp.employee_name)}
                                                                    className="text-red-500 hover:text-red-700 font-medium px-2 py-0.5 rounded border border-red-200 hover:bg-red-50 transition-colors"
                                                                    title="Remove from queue"
                                                                >
                                                                    ✕ Remove
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
