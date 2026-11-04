import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '../../src/contexts/AuthContext.jsx';
import ApplicationsPage from '../../src/pages/ApplicationsPage.jsx';
import '../../src/index.css';
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
window.mountApplications = (editable = true) => {
    const permissions = editable ? ['applications:view', 'applications:edit'] : ['applications:view'];
    localStorage.setItem('userSession', JSON.stringify({ token: 'browser-fixture', user: { employee_id: 1, permissions }, permissions }));
    root.render(React.createElement(AuthProvider, { key: `${editable}:${++mountKey}` },
        React.createElement(React.Fragment, null, React.createElement(ApplicationsPage), React.createElement(Toaster))));
};
