import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import ChequePrintingPage from './ChequePrintingPage';
import PdcTreasuryPage from './PdcTreasuryPage';
import BankAccountsPage from './BankAccountsPage';
import ChequeSettingsPanel from '../components/cheques/ChequeSettingsPanel';
import useDeepLink from '../hooks/useDeepLink';

const ChequesTreasuryPage = ({ pageState }) => {
    const { hasPermission } = useAuth();

    const sections = useMemo(() => ([
        { key: 'print', label: 'Print Cheques', permission: 'cheques:view', Component: ChequePrintingPage },
        { key: 'treasury', label: 'Treasury Desk', permission: ['pdc:view', 'ar:view', 'ap-pdc:view'], Component: PdcTreasuryPage },
        { key: 'bank_accounts', label: 'Bank Accounts', permission: 'ap-pdc:view', Component: BankAccountsPage },
        { key: 'settings', label: 'Templates & Settings', permission: 'cheques:view', Component: ChequeSettingsPanel },
    ]), []);

    const visibleSections = useMemo(
        () => sections.filter((section) => hasPermission(section.permission)),
        [sections, hasPermission]
    );

    const [activeSection, setActiveSection] = useState(() => visibleSections[0]?.key);

    // A deep link names both the section to open and whatever that section needs
    // to focus on. The remainder is held per-section so it reaches only the
    // component it was meant for, rather than every section as a dead prop. A
    // link to a section this user cannot see is ignored, not forced open.
    const [sectionState, setSectionState] = useState(null);
    useDeepLink(pageState, ({ section, ...rest }) => {
        const target = visibleSections.some((s) => s.key === section) ? section : null;
        if (!target) return;
        setActiveSection(target);
        setSectionState({ section: target, state: rest });
    });

    const current = visibleSections.find((section) => section.key === activeSection) || visibleSections[0];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-slate-100">Cheques &amp; Treasury</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Print cheques, monitor post-dated cheque clearance, manage bank accounts, and configure print templates in one place.
                </p>
            </div>

            {visibleSections.length > 0 ? (
                <>
                    <div className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl shadow-xs px-4 pt-2 overflow-x-auto">
                        <SegmentedTabs
                            tabs={visibleSections.map(({ key, label }) => ({ key, label }))}
                            active={current?.key}
                            onChange={setActiveSection}
                        />
                    </div>

                    {current && (
                        <current.Component
                            pageState={sectionState?.section === current.key ? sectionState.state : null}
                        />
                    )}
                </>
            ) : (
                <div className="bg-white dark:bg-slate-800 p-12 rounded-xl border border-gray-200 dark:border-slate-700 text-center shadow-xs space-y-2">
                    <div className="text-4xl">🔒</div>
                    <p className="text-sm text-gray-600 dark:text-slate-400">You do not have permission to view any cheque or treasury features.</p>
                </div>
            )}
        </div>
    );
};

export default ChequesTreasuryPage;
