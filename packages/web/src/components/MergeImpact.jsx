const label = key => key.replaceAll('_', ' ').replaceAll('.', ' · ');

const recordPage = table => {
    if (table === 'goods_receipt') return 'goods_receipt_history';
    if (table === 'withholding_tax_certificate') return 'withholding_tax';
    return null;
};

export default function MergeImpact({ preview, onNavigate }) {
    if (!preview) return <p className="text-sm text-slate-500">Calculating merge impact…</p>;
    return <div className="space-y-4 text-sm">
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left"><thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-3 py-2">Relationship</th><th className="px-3 py-2 text-right">Affected</th></tr></thead>
                <tbody>{Object.entries(preview.impact || {}).filter(([key]) => key !== 'parts_reassigned').map(([key, count]) => <tr key={key} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-2">{label(key)}</td><td className="px-3 py-2 text-right tabular-nums">{count}</td></tr>)}</tbody>
            </table>
        </div>
        {preview.drafts?.length > 0 && <div><strong>Drafts to rewrite</strong><ul className="list-inside list-disc">{preview.drafts.map(draft => <li key={draft.draftId}>{draft.draftName || `Draft ${draft.draftId}`} ({draft.paths?.join(', ')})</li>)}</ul></div>}
        {preview.aliasesToUnion?.length > 0 && <div><strong>Aliases to retain</strong><ul className="list-inside list-disc">{preview.aliasesToUnion.map((alias, index) => <li key={index}>{alias.name || alias.code}</li>)}</ul></div>}
        {preview.tagsToUnion > 0 && <p>{preview.tagsToUnion} customer tag relationships will be unioned.</p>}
        {preview.walletTotal !== undefined && <p>Combined wallet balance: <strong>{Number(preview.walletTotal).toFixed(2)}</strong></p>}
        {preview.conflicts?.length > 0 && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800"><strong>Resolve these conflicts before merging</strong><ul className="mt-2 list-inside list-disc">{preview.conflicts.map((item, index) => <li key={index}>{label(item.reason || item.table || 'Conflict')}{item.value ? `: ${item.value}` : ''}{item.recordIds?.length ? ` — records ${item.recordIds.join(', ')}` : ''}{recordPage(item.table) && onNavigate && <button type="button" className="ml-2 underline" onClick={() => onNavigate(recordPage(item.table))}>Open records</button>}</li>)}</ul></div>}
        {preview.postconditionScope?.length > 0 && <p className="text-xs text-slate-500">The merge checks that no operational references remain on the retired records.</p>}
    </div>;
}
