import { useEffect, useState } from 'react';
import api from '../../api';
import Modal from '../ui/Modal';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';

const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (value) => Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 3 });

/** All figures come from the same saved payslip and its saved earning lines. */
export default function PayslipBreakdown({ payslipId, own = false, onClose }) {
    const [slip, setSlip] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        api.get(`/payroll/${own ? 'me/' : ''}payslips/${payslipId}`)
            .then(({ data }) => { if (active) setSlip(data); })
            .catch(() => { if (active) setError('Could not load the saved payslip breakdown.'); });
        return () => { active = false; };
    }, [payslipId, own]);

    const trace = slip?.computation_trace || {};
    const finalPay = trace.basicPayModel === 'FINAL_PAY';
    const monthly = slip?.pay_basis === 'monthly' && !finalPay;
    const total = (label, value) => <div className="flex justify-between gap-4 border-t border-gray-200 dark:border-slate-600 pt-2 font-semibold"><span>{label}</span><span className="tabular-nums">{peso(value)}</span></div>;
    return <Modal isOpen onClose={onClose} title={slip ? `${slip.employee_name} · ${slip.payslip_no}` : 'Payslip breakdown'} maxWidth="max-w-3xl">
        {error && <ErrorState description={error} />}
        {!slip && !error && <LoadingState label="Loading saved payslip…" />}
        {slip && <div className="space-y-5 text-sm text-gray-800 dark:text-slate-100">
            <div className="space-y-1 text-gray-600 dark:text-slate-300">
                <p>{finalPay ? 'Final pay entitlements' : monthly ? `Monthly salary · ${slip.salary_model === 'ATTENDANCE' ? 'Attendance-based' : 'Guaranteed'}` : 'Daily pay'}{!finalPay && ` · DTR paid days: ${count(slip.days_paid)}`}</p>
                {!finalPay && <p>{monthly ? 'Equivalent daily rate' : 'Daily rate'}: {peso(slip.daily_rate)}</p>}
                {monthly && <p>Basic pay follows the cutoff salary entitlement, adjusted for unpaid leave and applicable absences / half-days. The equivalent daily rate × DTR days is not the salary formula.</p>}
                {trace.monthlySalary != null && <p>Contracted monthly salary: {peso(trace.monthlySalary)} · Cutoff entitlement: {peso(trace.proratedEntitlement)}</p>}
                {monthly && <p>Lateness and undertime are paid. Unpaid half-days reduce attendance-based salaries.</p>}
            </div>
            <div className="grid gap-5 md:grid-cols-2">
                {[['EARNING', 'Earnings', 'Gross pay', slip.gross_pay], ['DEDUCTION', 'Deductions', 'Total deductions', slip.total_deductions]].map(([type, title, label, value]) =>
                    <section key={type} className="space-y-2">
                        <h3 className="font-semibold">{title}</h3>
                        {(slip.lines || []).filter((line) => line.line_type === type && Number(line.amount) !== 0).map((line, index) =>
                            <div key={`${line.component_code}-${index}`} className="flex justify-between gap-4">
                                <span>{line.description}
                                    {line.quantity != null && line.rate != null && !(monthly && line.component_code === 'BASIC') && <span className="block text-xs text-gray-500 dark:text-slate-400">{count(line.quantity)} @ {peso(line.rate)} (rounded total)</span>}
                                </span>
                                <span className="tabular-nums whitespace-nowrap">{peso(line.amount)}</span>
                            </div>)}
                        {total(label, value)}
                    </section>)}
            </div>
            {total('Net pay = gross pay − total deductions', slip.net_pay)}
            {Number(slip.total_employer_contrib) > 0 && <p className="text-xs text-gray-500 dark:text-slate-400">Employer contributions: {peso(slip.total_employer_contrib)}. These do not reduce your net pay.</p>}
        </div>}
    </Modal>;
}
