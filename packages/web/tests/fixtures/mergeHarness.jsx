import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../src/contexts/AuthContext';
import PartyMergePage from '../../src/pages/PartyMergePage';
import EntityManagementPage from '../../src/pages/EntityManagementPage';

const kind = new URLSearchParams(location.search).get('kind') || 'supplier';
const onNavigate = page => { window.__navigated = page; };
createRoot(document.getElementById('root')).render(
    <AuthProvider>
        {kind === 'supplier' || kind === 'customer'
            ? <PartyMergePage party={kind} onNavigate={onNavigate} />
            : <EntityManagementPage entity={kind} onNavigate={onNavigate} />}
    </AuthProvider>
);
