import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

/**
 * The state a metric shows when the module behind it is not in use yet.
 *
 * This exists because the alternative is worse than useless: querying an empty
 * table returns a confident ₱0.00, and "we spent nothing on wages this month"
 * is a far more damaging thing to display than "we are not recording this yet".
 * No query is issued at all — the readiness flag from /meta decides.
 */
const NoDataYet = ({ metric, message }) => (
    <div className="flex flex-col items-start gap-1.5 py-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:bg-slate-800 dark:text-slate-400">
            <Icon path={ICONS.info} className="h-3 w-3" />
            Not recorded yet
        </span>
        <p className="text-xs text-neutral-500 dark:text-slate-400">
            {message
                || `${metric?.label || 'This figure'} needs data the business is not capturing yet. It will appear here on its own once it is.`}
        </p>
    </div>
);

export default NoDataYet;
