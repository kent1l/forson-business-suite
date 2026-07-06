import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import StaffDashboard from '../components/cycleCount/StaffDashboard';
import MobileCounter from '../components/cycleCount/MobileCounter';

const CycleCountExecutionPage = () => {
    const { hasPermission } = useAuth();
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeItemIndex, setActiveItemIndex] = useState(null);
    const [showUnassignedWorkflow, setShowUnassignedWorkflow] = useState(false);
    const [serverOffset, setServerOffset] = useState(0);
    const [startTime, setStartTime] = useState(null);

    useEffect(() => {
        const syncTime = async () => {
            try {
                const clientTimeBefore = Date.now();
                const response = await api.get('/inventory/cycle-count/server-time');
                const clientTimeAfter = Date.now();
                const serverTime = new Date(response.data.serverTime).getTime();
                const latency = (clientTimeAfter - clientTimeBefore) / 2;
                setServerOffset((serverTime + latency) - clientTimeAfter);
            } catch (err) {
                console.error('Failed to sync server time:', err);
            }
        };
        syncTime();
    }, []);

    useEffect(() => {
        if (activeItemIndex !== null || showUnassignedWorkflow) {
            setStartTime(Date.now());
        } else {
            setStartTime(null);
        }
    }, [activeItemIndex, showUnassignedWorkflow]);

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.get('/inventory/cycle-count/my-tasks');
            setTasks(response.data || []);
            setActiveItemIndex(null); // Reset when refetching
        } catch (err) {
            console.error('Failed to fetch cycle count tasks:', err);
            setError('Could not load assigned tasks. Please try again later.');
            toast.error('Failed to load tasks.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    const handleStartCounting = () => {
        if (tasks.length > 0) {
            setActiveItemIndex(0);
        }
    };

    const handleItemSubmit = async (lineId, countedQty) => {
        try {
            const startedAt = startTime ? new Date(startTime + serverOffset).toISOString() : null;
            await api.post(`/inventory/cycle-count/lines/${lineId}/submit`, { counted_qty: countedQty, started_at: startedAt });
            toast.success('Count recorded successfully.');

            // Advance to next item or finish
            if (activeItemIndex !== null && activeItemIndex < tasks.length - 1) {
                setActiveItemIndex(activeItemIndex + 1);
            } else {
                // Done with current batch, refresh tasks
                toast.success('Batch completed!');
                setActiveItemIndex(null);
                fetchTasks();
            }
        } catch (err) {
            console.error('Failed to submit count:', err);
            toast.error(err.response?.data?.message || 'Failed to submit count.');
            // Do not advance on error
        }
    };

    const handleUnassignedSubmit = async (partId, countedQty) => {
        try {
            const startedAt = startTime ? new Date(startTime + serverOffset).toISOString() : null;
            await api.post('/inventory/cycle-count/unassigned-find', { part_id: partId, counted_qty: countedQty, started_at: startedAt });
            toast.success('Unassigned item count recorded successfully.');
            setShowUnassignedWorkflow(false);
        } catch (err) {
            console.error('Failed to submit unassigned count:', err);
            toast.error(err.response?.data?.message || 'Failed to submit unassigned item count.');
        }
    };

    if (!hasPermission('cycle_count:execute')) {
        return <div className="p-8 text-center text-red-600">You do not have permission to execute cycle counts.</div>;
    }

    if (loading) {
        return <div className="p-8 text-center">Loading tasks...</div>;
    }

    if (error) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-500 mb-4">{error}</p>
                <button onClick={fetchTasks} className="px-4 py-2 bg-blue-600 text-white rounded">Retry</button>
            </div>
        );
    }

    // We are actively counting a specific assigned item
    if (activeItemIndex !== null && !showUnassignedWorkflow) {
        const currentTask = tasks[activeItemIndex];
        return (
            <MobileCounter
                task={currentTask}
                onSubmit={(qty) => handleItemSubmit(currentTask.line_id, qty)}
                onCancel={() => setActiveItemIndex(null)}
                itemNumber={activeItemIndex + 1}
                totalItems={tasks.length}
                onUnassignedFind={() => setShowUnassignedWorkflow(true)}
            />
        );
    }

    // We are counting a surprise find
    if (showUnassignedWorkflow) {
        return (
            <MobileCounter
                isUnassigned={true}
                onSubmit={(partId, qty) => handleUnassignedSubmit(partId, qty)}
                onCancel={() => setShowUnassignedWorkflow(false)}
            />
        );
    }

    // Default view: Dashboard
    return (
        <StaffDashboard
            tasks={tasks}
            onStart={handleStartCounting}
            onUnassignedFind={() => setShowUnassignedWorkflow(true)}
            onRefresh={fetchTasks}
        />
    );
};

export default CycleCountExecutionPage;
