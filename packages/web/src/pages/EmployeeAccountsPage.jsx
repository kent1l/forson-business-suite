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
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    if (!hasPermission('employee_finance:view')) return;
    api.get('/hr/employee-finance/employees', {
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
    });
    return () => {
      live = false;
    };
  }, [search, page, user?.employee_id, hasPermission]);
  useEffect(() => {
    api.get('/hr/employee-finance/bank-accounts').then(r => setBanks(r.data)).catch(() => setBanks([]));
  }, [user?.employee_id]);
  useEffect(() => {
    setEmployeeId('');
  }, [user?.employee_id]);
  if (!hasPermission('employee_finance:view')) return <p role="alert">Employee financial permission required.</p>;
  return <div className="space-y-4"><h1 className="text-2xl font-semibold">Employee Accounts</h1><div className="flex gap-4"><button onClick={() => setWorkspace('employees')}>Employee accounts</button><button onClick={() => setWorkspace('agency')}>Agency remittances across employees</button></div>{workspace === 'agency' ? <EmployeeAgencyLoans key={`agency:${user?.employee_id}`} banks={banks} /> : <><label>Find employee (including former employees)<input className="block w-full border rounded p-2 bg-transparent" value={search} onChange={e => {
          setSearch(e.target.value);
          setPage(1);
        }} /></label>{error && <p role="alert">{error}</p>}
 <label>Employee<select className="block w-full border rounded p-2 bg-transparent" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Select employee</option>{employees.map(e => <option key={e.employee_id} value={e.employee_id}>{e.employee_code} · {e.employee_name} · {e.employment_status}</option>)}</select></label><div className="flex gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous employees</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next employees</button></div>
 {employeeId && <EmployeeAccountsTab key={`${user?.employee_id}:${employeeId}`} employeeId={employeeId} />}</>}
 </div>;
}
