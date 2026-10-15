import SegmentedTabs from '../components/ui/SegmentedTabs';
import { FinanceField, FinancePanel } from '../components/hr/FinancePrimitives';
import { financeStyles as styles } from '../components/hr/financePresentation';
import EmptyState from '../components/ui/EmptyState';
import EmployeeAgencyLoans from '../components/hr/EmployeeAgencyLoans';
import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAccountsTab from '../components/hr/EmployeeAccountsTab';
export default function EmployeeAccountsPage() {
  const {
    user,
    hasPermission
  } = useAuth();
  const [workspace, setWorkspace] = useState('employees');
  const [banks, setBanks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setError('');
    if (!hasPermission('employee_finance:view')) return;
    setLoading(true);
    const timer = setTimeout(() => api.get('/hr/employee-finance/employees', {
      params: {
        search,
        page,
        pageSize: 25
      }
    }).then(r => {
      if (live) {
        setEmployees(r.data.data);
        setTotalPages(r.data.totalPages);
      }
    }).catch(e => {
      if (live) setError(e.response?.data?.message || 'Employee register unavailable.');
    }).finally(() => { if (live) setLoading(false); }), 200);
    return () => {
      live = false; clearTimeout(timer);
    };
  }, [search, page, user?.employee_id, hasPermission]);
  useEffect(() => {
    api.get('/hr/employee-finance/bank-accounts').then(r => setBanks(r.data)).catch(() => setBanks([]));
  }, [user?.employee_id]);
  useEffect(() => {
    setEmployeeId(''); setSelectedEmployee(null);
  }, [user?.employee_id]);
  if (!hasPermission('employee_finance:view')) return <p role="alert">Employee financial permission required.</p>;
  return <div className="employee-finance min-w-0 space-y-5"><div><h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Employee Accounts</h1><p className={`mt-1 ${styles.muted}`}>Loan recovery, salary settlement and agency remittance in one workspace.</p></div>
 <SegmentedTabs active={workspace} onChange={setWorkspace} tabs={[{key:'employees',label:'Employee accounts'},{key:'agency',label:'Agency remittances'}]}/>
 {workspace === 'agency' ? <EmployeeAgencyLoans key={`agency:${user?.employee_id}`} banks={banks} /> : <><FinancePanel title="Find an employee" description="Search current and former employees to review their financial accounts."><div className="grid gap-4 sm:grid-cols-2"><FinanceField label="Search employees"><input className={styles.input} value={search} placeholder="Name or employee code" onChange={e => {setSearch(e.target.value);setPage(1);}} /></FinanceField><FinanceField label="Employee"><select className={styles.input} value={employeeId} onChange={e => {setEmployeeId(e.target.value);setSelectedEmployee(employees.find(x => String(x.employee_id) === e.target.value) || null);}} disabled={loading}><option value="">{loading ? 'Loading employees…' : 'Select employee'}</option>{selectedEmployee && !employees.some(e => String(e.employee_id) === employeeId) && <option value={employeeId}>{selectedEmployee.employee_code} · {selectedEmployee.employee_name} · {selectedEmployee.employment_status}</option>}{employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.employee_code} · {e.employee_name} · {e.employment_status}</option>)}</select></FinanceField></div>{error && <p className="mt-3 text-sm text-danger-600" role="alert">{error}</p>}{!loading && !error && !employees.length && <p className={`mt-3 ${styles.muted}`}>No employees match this search.</p>}<div className="mt-4 flex items-center justify-between gap-3 text-xs"><button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>Previous employees</button><span className={styles.muted}>Page {page} of {Math.max(1,totalPages)}</span><button disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Next employees</button></div></FinancePanel>
 {employeeId ? <EmployeeAccountsTab key={`${user?.employee_id}:${employeeId}`} employeeId={employeeId} employeeName={selectedEmployee?.employee_name} /> : <EmptyState title="Select an employee to get started" description="Balances, source documents and settlement actions appear here." />}</>}
 </div>;
}
