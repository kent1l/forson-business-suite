import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import PayComponentManager from '../components/hr/PayComponentManager';

export default function PayComponentsPage() {
    const { hasPermission } = useAuth();

    if (!hasPermission('payroll:config')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-danger-600">Access Denied</h1>
                <p className="text-gray-600 dark:text-slate-400 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PayComponentManager />
        </div>
    );
}
