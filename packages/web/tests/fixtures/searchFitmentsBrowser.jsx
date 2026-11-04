import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../src/contexts/AuthContext.jsx';
import { SettingsProvider } from '../../src/contexts/SettingsContext.jsx';
import POSPage from '../../src/pages/POSPage.jsx';
import InvoicingPage from '../../src/pages/InvoicingPage.jsx';
import PowerSearchPage from '../../src/pages/PowerSearchPage.jsx';
import PartsPage from '../../src/pages/PartsPage.jsx';
import GoodsReceiptPage from '../../src/pages/GoodsReceiptPage.jsx';
import PurchaseOrderForm from '../../src/components/forms/PurchaseOrderForm.jsx';
import PartCompareCard from '../../src/components/parts-cleanup/PartCompareCard.jsx';
import PartApplicationManager from '../../src/pages/PartApplicationManager.jsx';
import PartForm from '../../src/components/forms/PartForm.jsx';
import EngineCodeText from '../../src/components/applications/EngineCodeText.jsx';
import '../../src/index.css';

const user = { employee_id: 1, permission_level_id: 1, first_name: 'Fixture', permissions: ['parts:view', 'pos:use', 'invoices:create'] };
const noop = () => {};
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
function PosFixture() {
    const [lines, setLines] = useState([]);
    return <POSPage user={user} lines={lines} setLines={setLines} onNavigate={noop} />;
}
window.mountSearchFitments = kind => {
    localStorage.setItem('userSession', JSON.stringify({ token: 'browser-fixture', user, permissions: user.permissions }));
    const components = { pos: PosFixture, invoice: InvoicingPage, power: PowerSearchPage, parts: PartsPage, receive: GoodsReceiptPage, purchase: PurchaseOrderForm };
    const Component = components[kind];
    root.render(<AuthProvider key={++mountKey}><SettingsProvider><Component user={user} onNavigate={noop} onSave={noop} onCancel={noop} /></SettingsProvider></AuthProvider>);
};

window.mountEngineDisplays = (kind, part) => {
    const permissions = ['parts:view', 'parts:edit', 'applications:view', 'applications:edit'];
    localStorage.setItem('userSession', JSON.stringify({ token: 'browser-fixture', user, permissions }));
    const node = kind === 'cleanup' ? <PartCompareCard part={part} onSelect={noop} />
        : kind === 'manager' ? <PartApplicationManager part={part} onCancel={noop} />
        : kind === 'form' ? <PartForm part={part} brands={[]} groups={[]} onSave={noop} onCancel={noop} />
        : <EngineCodeText codes={['4BC2', '4BE1']} />;
    root.render(<AuthProvider key={++mountKey}><SettingsProvider>{node}</SettingsProvider></AuthProvider>);
};
