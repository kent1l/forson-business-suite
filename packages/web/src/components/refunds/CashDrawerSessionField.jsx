export default function CashDrawerSessionField({ drawer }) {
    if (drawer.enabled === false) return null;
    return (
        <div className="my-3">
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300">
                Cash drawer
                <select value={drawer.sessionId} onChange={event => drawer.setSessionId(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
                    <option value="">Select an open cash drawer</option>
                    {drawer.sessions.map(item => <option key={item.session_id} value={item.session_id}>{item.name}</option>)}
                </select>
            </label>
            {drawer.validationError && <p className="mt-1 text-sm text-amber-700 dark:text-amber-300" role="status">{drawer.validationError}</p>}
        </div>
    );
}
