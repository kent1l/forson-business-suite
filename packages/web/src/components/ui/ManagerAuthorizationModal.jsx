import { useState, useEffect, useRef } from 'react';
import api from '../../api';
import Modal from './Modal';
import { formatCurrency } from '../../utils/currency';

/**
 * Asks a permission-holder standing at the counter to authorize what the signed-in
 * user cannot do alone.
 *
 * Deliberately generic. A/R concessions are the first caller, but price overrides
 * and voids want exactly this shape next, so the endpoint and the wording of the
 * action are props rather than baked in.
 *
 * Two rules that are not negotiable and are the reason this is a component rather
 * than a few lines inline:
 *
 *   * The token lives in the caller's component state and nowhere else. Not
 *     localStorage, not sessionStorage — the same reasoning as payReauth.js: a
 *     shared counter PC must not carry a manager's approval across a refresh, or
 *     to whoever uses the terminal next.
 *   * The password never leaves this component. It is not lifted into the caller,
 *     not echoed back, and is cleared the moment the modal closes.
 *
 * @param {string} endpoint   API path that mints the token
 * @param {object} context    request body fields identifying what is being authorized
 * @param {string} actionLabel  what the authorizer is approving, in plain words
 * @param {number} [amount]   shown so the authorizer sees what they are approving
 * @param {(token: string, authorizedBy: object) => void} onAuthorized
 */
const ManagerAuthorizationModal = ({
    isOpen,
    onClose,
    onAuthorized,
    endpoint = '/ar/adjustments/authorize',
    context = {},
    actionLabel = 'this action',
    amount = null,
    permissionLabel = 'the required permission',
}) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const usernameRef = useRef(null);

    useEffect(() => {
        if (!isOpen) {
            setUsername('');
            setPassword('');
            setError(null);
            setSubmitting(false);
            return;
        }
        // The authorizer is a second person reaching over the keyboard; landing the
        // caret for them saves the fumble that makes staff avoid the control.
        const id = setTimeout(() => usernameRef.current?.focus(), 50);
        return () => clearTimeout(id);
    }, [isOpen]);

    const submit = async (e) => {
        e?.preventDefault();
        if (submitting || !username.trim() || !password) return;

        setSubmitting(true);
        setError(null);
        try {
            const { data } = await api.post(endpoint, {
                username: username.trim(),
                password,
                ...context,
            });
            // Cleared before the caller is told, so the credentials are gone from
            // memory even if the caller's handler throws.
            setPassword('');
            setUsername('');
            onAuthorized?.(data.authorization_token, data.authorized_by, data.expires_at);
            onClose?.();
        } catch (err) {
            // The server answers identically for an unknown username, a wrong
            // password and a manager who lacks the permission. Repeating whatever
            // it said keeps the client from inventing a distinction it must not
            // make.
            setError(err?.response?.data?.message || 'Could not authorize. Try again.');
            setPassword('');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Manager authorization required"
            maxWidth="max-w-md"
            zIndexClass="z-50"
        >
            <form onSubmit={submit} className="space-y-4">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 p-3">
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                        You do not hold {permissionLabel}. Someone who does can approve {actionLabel} by
                        entering <span className="font-semibold">their own</span> credentials below.
                    </p>
                    {amount != null && (
                        <p className="text-sm font-semibold text-amber-950 dark:text-amber-100 mt-2 font-mono">
                            {formatCurrency(amount)}
                        </p>
                    )}
                </div>

                <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-slate-400 mb-1">
                        Authorizer&rsquo;s username
                    </label>
                    <input
                        ref={usernameRef}
                        type="text"
                        autoComplete="off"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                    />
                </div>

                <div>
                    <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-slate-400 mb-1">
                        Authorizer&rsquo;s password
                    </label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3 py-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                    />
                </div>

                {error && (
                    <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
                )}

                <p className="text-xs text-gray-500 dark:text-slate-400">
                    This does not sign the authorizer in. It approves this one action, for this customer and
                    this amount, and expires within minutes. Both names are recorded on the document.
                </p>

                <div className="flex justify-end gap-3 pt-2 border-t border-gray-200 dark:border-slate-700">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded text-sm font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={submitting || !username.trim() || !password}
                        className="px-4 py-2 rounded text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                    >
                        {submitting ? 'Authorizing…' : 'Authorize'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default ManagerAuthorizationModal;
