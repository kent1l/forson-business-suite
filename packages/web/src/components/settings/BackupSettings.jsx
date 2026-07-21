import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Helper: produce a human-readable summary for common cron patterns
function describeCron(expr) {
    if (!expr) return '';
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return 'Invalid cron (needs 5 fields)';
    const [min, hour, dom, month, dow] = parts;

    // Exact-match common patterns first
    const common = {
        '0 2 * * *':   'Every day at 2:00 AM',
        '0 0 * * *':   'Every day at midnight',
        '0 12 * * *':  'Every day at noon',
        '0 */6 * * *': 'Every 6 hours',
        '0 */12 * * *':'Every 12 hours',
        '0 2 * * 0':   'Every Sunday at 2:00 AM',
        '0 2 1 * *':   'On the 1st of every month at 2:00 AM',
    };
    if (common[expr.trim()]) return common[expr.trim()];

    // Generic fallback
    const hourStr  = hour  === '*' ? 'every hour'  : `hour ${hour}`;
    const minStr   = min   === '*' ? 'every minute': `minute ${min}`;
    const domStr   = dom   === '*' ? ''             : ` on day ${dom} of the month`;
    const dowStr   = dow   === '*' ? ''             : ` on weekday ${dow}`;
    return `At ${minStr} of ${hourStr}${domStr}${dowStr}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const SectionHeader = ({ title, subtitle }) => (
    <div className="mb-4">
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
    </div>
);

const InfoBox = ({ children }) => (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 space-y-1">
        {children}
    </div>
);

const Toggle = ({ name, label, checked, onChange }) => (
    <label className="flex items-center gap-3 cursor-pointer select-none">
        <div className="relative">
            <input
                type="checkbox"
                className="sr-only"
                name={name}
                checked={checked}
                onChange={onChange}
            />
            <div className={`w-10 h-6 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`} />
            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
        </div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
    </label>
);

// ── BackupSettings ────────────────────────────────────────────────────────────

const BackupSettings = ({ settings, handleChange, handleSave }) => {
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const fileInputRef = React.useRef(null);

    const fetchBackups = useCallback(async () => {
        try {
            setLoading(true);
            const response = await api.get('/backups');
            setBackups(response.data);
        } catch (error) {
            toast.error('Failed to fetch backup list.');
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchBackups(); }, [fetchBackups]);

    const handleBackupNow = () => {
        const promise = api.post('/backups');
        toast.promise(promise, {
            loading: 'Starting on-demand backup...',
            success: (res) => { fetchBackups(); return res.data.message; },
            error:   (err) => err.response?.data?.message || 'Failed to start backup.',
        });
    };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        const promise = api.post('/backups/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });

        toast.promise(promise, {
            loading: `Uploading ${file.name}...`,
            success: (res) => {
                fetchBackups();
                const uploadedFilename = res.data.filename;
                promptRestoreAfterUpload(uploadedFilename);
                return res.data.message;
            },
            error: (err) => err.response?.data?.message || 'Failed to upload backup file.',
        });

        e.target.value = '';
    };

    const promptRestoreAfterUpload = (filename) => {
        toast((t) => (
            <div className="text-center">
                <p className="font-bold text-blue-600">📥 Backup File Uploaded</p>
                <p className="text-sm my-2">
                    Backup saved as <strong className="font-mono text-xs">{filename}</strong>. Would you like to restore the database from this file now?
                </p>
                <div className="flex justify-center space-x-2 mt-2">
                    <button
                        onClick={() => { toast.dismiss(t.id); confirmRestore(filename); }}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-semibold"
                    >
                        Yes, Restore Now
                    </button>
                    <button
                        onClick={() => toast.dismiss(t.id)}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 text-sm"
                    >
                        Keep in List Only
                    </button>
                </div>
            </div>
        ), { duration: 10000 });
    };

    const handleRestore = (filename) => {
        toast((t) => (
            <div className="text-center">
                <p className="font-bold text-red-600">⚠ Restore Database?</p>
                <p className="text-sm my-2">
                    This will overwrite <strong>all current data</strong> with the selected backup. This cannot be undone.
                </p>
                <p className="text-xs text-gray-500 mb-3 font-mono">{filename}</p>
                <div className="flex justify-center space-x-2 mt-2">
                    <button
                        onClick={() => { toast.dismiss(t.id); confirmRestore(filename); }}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-semibold"
                    >
                        Yes, Restore
                    </button>
                    <button
                        onClick={() => toast.dismiss(t.id)}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 text-sm"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        ), { duration: Infinity });
    };

    const confirmRestore = (filename) => {
        const promise = api.post('/backups/restore', { filename });
        toast.promise(promise, {
            loading: `Restoring from ${filename}...`,
            success: () => 'Restore successful! The application will now reload.',
            error:   (err) => err.response?.data?.message || 'Failed to restore backup.',
        });
        promise.then(() => setTimeout(() => window.location.reload(), 3000));
    };

    const handleDelete = (filename) => {
        const promise = api.delete(`/backups/${filename}`);
        toast.promise(promise, {
            loading: `Deleting ${filename}...`,
            success: (res) => { fetchBackups(); return res.data.message; },
            error:   (err) => err.response?.data?.message || 'Failed to delete backup.',
        });
    };

    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    };

    const gdriveEnabled    = settings.BACKUP_GDRIVE_ENABLED    === 'true';
    const tailscaleEnabled = settings.BACKUP_TAILSCALE_ENABLED === 'true';
    const cronExpr         = settings.BACKUP_SCHEDULE_CRON || '0 2 * * *';
    const cronDesc         = describeCron(cronExpr);

    return (
        <div className="space-y-8">

            {/* ── Local Backup Configuration ── */}
            <div className="pb-6 border-b border-gray-200">
                <SectionHeader
                    title="Local Backup Configuration"
                    subtitle="Backups are stored in the /backups volume and managed by the dedicated backup container."
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Retention Period (Days)
                        </label>
                        <input
                            type="number"
                            name="BACKUP_RETENTION_DAYS"
                            min="1"
                            max="365"
                            value={settings.BACKUP_RETENTION_DAYS || '7'}
                            onChange={handleChange}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Local backup files older than this are deleted automatically.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Backup Schedule (Cron)
                        </label>
                        <input
                            type="text"
                            name="BACKUP_SCHEDULE_CRON"
                            value={cronExpr}
                            onChange={handleChange}
                            placeholder="0 2 * * *"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            {cronDesc
                                ? <><span className="text-blue-600 font-medium">↻ {cronDesc}</span> · <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">crontab.guru</a></>
                                : <a href="https://crontab.guru/" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">crontab.guru</a>
                            }
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Remote Backup (Redundancy) ── */}
            <div className="pb-6 border-b border-gray-200">
                <SectionHeader
                    title="Remote Backup (Redundancy)"
                    subtitle="Enable one or both remote targets. Each backup is pushed to remote after the local copy is saved."
                />

                {/* Google Drive */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">📁</span>
                            <span className="font-medium text-gray-800">Google Drive</span>
                        </div>
                        <Toggle
                            name="BACKUP_GDRIVE_ENABLED"
                            label={gdriveEnabled ? 'Enabled' : 'Disabled'}
                            checked={gdriveEnabled}
                            onChange={(e) => handleChange({
                                target: { name: 'BACKUP_GDRIVE_ENABLED', value: e.target.checked ? 'true' : 'false' }
                            })}
                        />
                    </div>
                    {gdriveEnabled && (
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    rclone Remote Path
                                </label>
                                <input
                                    type="text"
                                    name="BACKUP_GDRIVE_REMOTE"
                                    value={settings.BACKUP_GDRIVE_REMOTE || 'gdrive:forson-backups'}
                                    onChange={handleChange}
                                    placeholder="gdrive:forson-backups"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    Format: <code className="bg-gray-100 px-1 rounded">remote-name:folder-path</code>
                                </p>
                            </div>
                            <InfoBox>
                                <p className="font-semibold">One-time server setup required:</p>
                                <ol className="list-decimal list-inside space-y-1 text-xs mt-1">
                                    <li>SSH into the server and run: <code className="bg-blue-100 px-1 rounded font-mono">rclone config</code></li>
                                    <li>Create a remote named <strong>gdrive</strong> (type: drive, OAuth)</li>
                                    <li>Copy the generated config to: <code className="bg-blue-100 px-1 rounded font-mono">./backup/rclone.conf</code></li>
                                    <li>Restart the backup container: <code className="bg-blue-100 px-1 rounded font-mono">docker compose restart forson_backup</code></li>
                                </ol>
                            </InfoBox>
                        </div>
                    )}
                </div>

                {/* Tailscale */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🔒</span>
                            <span className="font-medium text-gray-800">Tailscale rsync</span>
                        </div>
                        <Toggle
                            name="BACKUP_TAILSCALE_ENABLED"
                            label={tailscaleEnabled ? 'Enabled' : 'Disabled'}
                            checked={tailscaleEnabled}
                            onChange={(e) => handleChange({
                                target: { name: 'BACKUP_TAILSCALE_ENABLED', value: e.target.checked ? 'true' : 'false' }
                            })}
                        />
                    </div>
                    {tailscaleEnabled && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Peer Host (Tailscale IP or hostname)
                                    </label>
                                    <input
                                        type="text"
                                        name="BACKUP_TAILSCALE_HOST"
                                        value={settings.BACKUP_TAILSCALE_HOST || ''}
                                        onChange={handleChange}
                                        placeholder="100.x.x.x or hostname.tail.net"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Destination Path on Peer
                                    </label>
                                    <input
                                        type="text"
                                        name="BACKUP_TAILSCALE_PATH"
                                        value={settings.BACKUP_TAILSCALE_PATH || '~/forson-backups'}
                                        onChange={handleChange}
                                        placeholder="~/forson-backups"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            <InfoBox>
                                <p className="font-semibold">One-time server setup required:</p>
                                <ol className="list-decimal list-inside space-y-1 text-xs mt-1">
                                    <li>Generate an SSH key: <code className="bg-blue-100 px-1 rounded font-mono">ssh-keygen -t ed25519 -f ./backup/id_rsa -N ""</code></li>
                                    <li>Add the public key to the peer: <code className="bg-blue-100 px-1 rounded font-mono">cat ./backup/id_rsa.pub</code> → paste into peer's <code className="font-mono">~/.ssh/authorized_keys</code></li>
                                    <li>Restart the backup container: <code className="bg-blue-100 px-1 rounded font-mono">docker compose restart forson_backup</code></li>
                                </ol>
                            </InfoBox>
                        </div>
                    )}
                </div>

                {/* Remote retention (shown when either remote is enabled) */}
                {(gdriveEnabled || tailscaleEnabled) && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Remote Retention Period (Days)
                        </label>
                        <input
                            type="number"
                            name="BACKUP_REMOTE_RETENTION_DAYS"
                            min="1"
                            max="365"
                            value={settings.BACKUP_REMOTE_RETENTION_DAYS || '30'}
                            onChange={handleChange}
                            className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">Remote backup files older than this are pruned automatically.</p>
                    </div>
                )}
            </div>

            {/* ── Backup List ── */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <SectionHeader title="Available Backups" subtitle={null} />
                    <div className="flex items-center gap-2">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".sql.gz,.sql,.gz"
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-2 bg-gray-100 text-gray-700 border border-gray-300 px-4 py-2 rounded-lg font-semibold hover:bg-gray-200 transition text-sm"
                        >
                            <span className="text-base">📤</span>
                            Upload Backup
                        </button>
                        <button
                            onClick={handleBackupNow}
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition text-sm"
                        >
                            <Icon path={ICONS.plus} className="h-4 w-4" />
                            Backup Now
                        </button>
                    </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan="4" className="text-center p-6 text-gray-400">Loading backups...</td></tr>
                            ) : backups.length > 0 ? (
                                backups.map((backup) => (
                                    <tr key={backup.filename} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs text-gray-800 truncate max-w-xs">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate">{backup.filename}</span>
                                                {backup.type === 'upload' && (
                                                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 rounded whitespace-nowrap">Uploaded</span>
                                                )}
                                                {backup.type === 'manual' && (
                                                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded whitespace-nowrap">Manual</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatSize(backup.size)}</td>
                                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                            {format(toZonedTime(parseISO(backup.createdAt), 'Asia/Manila'), 'MM/dd/yyyy hh:mm a')}
                                        </td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                                            <a
                                                href={`/api/backups/${backup.filename}`}
                                                download
                                                className="text-blue-600 hover:text-blue-800 font-medium"
                                            >
                                                Download
                                            </a>
                                            <button onClick={() => handleRestore(backup.filename)} className="text-green-600 hover:text-green-800 font-medium">Restore</button>
                                            <button onClick={() => handleDelete(backup.filename)} className="text-red-500 hover:text-red-700 font-medium">Delete</button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="4" className="text-center p-8 text-gray-400">
                                        <p className="text-sm">No backups found.</p>
                                        <p className="text-xs mt-1">Click <strong>Backup Now</strong> or <strong>Upload Backup</strong> to add one.</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                    Backup storage: <code className="bg-gray-100 px-1 rounded">/backups</code> (Docker volume <code className="bg-gray-100 px-1 rounded">forson_backup_data</code>)
                </p>
            </div>

        </div>
    );
};


export default BackupSettings;
