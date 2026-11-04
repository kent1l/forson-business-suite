import { getApplication } from './applicationCache.js';
import { formatQualifierSummary } from '../utils/engineCodeFormat.js';
import { formatEngineCodes } from '../utils/engineCodeDisplay.js';
import { formatYears } from '../utils/yearShorthand.js';
import { compareFitmentRows, compareFitmentValues } from '../utils/fitmentDisplayOrder.js';

function resolveRow(value) {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
        return getApplication(Number(value)) || String(value);
    }
    if (value && typeof value === 'object' && value.application_id && !(value.make || value.model || value.engine || value.chassis)) {
        return { ...getApplication(value.application_id), ...value };
    }
    return value;
}

/** Display-only model grouping; engines combine only inside identical contexts. */
export function formatSearchFitments(part, { compact = true, multiline = false } = {}) {
    // Structured active rules are authoritative, including an empty list. Legacy
    // labels stay verbatim: parsing text here could invent vehicle relationships.
    const source = Array.isArray(part?.fitment_rules) ? part.fitment_rules : part?.applications;
    const rows = (Array.isArray(source) ? source : [source]).filter(Boolean).map(resolveRow).sort(compareFitmentRows);
    const models = new Map();
    const labels = [];
    for (const row of rows) {
        if (typeof row !== 'object') {
            labels.push(String(row));
            continue;
        }
        if (!(row.make || row.model || row.engine || row.chassis)) {
            if (row.display || row.application_id) labels.push(row.display || String(row.application_id));
            continue;
        }
        const effect = row.effect === 'exclude' ? 'exclude' : 'include';
        const modelKey = JSON.stringify([row.position || '', effect, row.make_id ?? row.make, row.model_id ?? row.model]);
        if (!models.has(modelKey)) {
            const name = [row.make, row.model].filter(Boolean).join(' ');
            models.set(modelKey, { label: name, position: row.position, effect, contexts: new Map() });
        }
        const model = models.get(modelKey);
        const qualifier = formatQualifierSummary({ ...row, chassis: null, position: null });
        const chassis = row.chassis ? `Chassis: ${row.chassis}` : '';
        const years = formatYears(row.year_start, row.year_end, { short: compact });
        // Preserve raw ranges and qualifier modes even when labels look alike.
        // Missing engine identity is its own context, never "all engines".
        const contextKey = JSON.stringify([
            row.chassis_id ?? row.chassis, chassis, row.year_start ?? null, row.year_end ?? null,
            qualifier, Boolean(row.engine),
            ...['make', 'model', 'chassis', 'engine', 'year', 'market', 'variant', 'position', 'drivetrain', 'transmission', 'fuel', 'displacement', 'generation'].map(key => row[`${key}_mode`] || ''),
        ]);
        if (!model.contexts.has(contextKey)) model.contexts.set(contextKey, { engines: new Set(), chassis, years, qualifier });
        if (row.engine) model.contexts.get(contextKey).engines.add(row.engine.trim());
    }

    const formattedModels = [...models.values()].map(model => {
        const contexts = [...model.contexts.values()].map(({ engines, chassis, years, qualifier }) => {
            const codes = [...engines].sort(compareFitmentValues);
            const engine = formatEngineCodes(codes, { compact });
            return [engine, chassis, years, qualifier].filter(Boolean).join(' · ');
        }).filter(Boolean);
        const details = contexts.join('; ');
        const vehicle = model.label ? `${model.label}${details ? ` (${details})` : ''}` : details;
        const text = [model.position, vehicle].filter(Boolean).join(' · ');
        return text ? `${model.effect === 'exclude' ? 'Excluded: ' : ''}${text}` : '';
    });
    return [...formattedModels, ...labels.sort(compareFitmentValues)].filter(Boolean).join(multiline ? '\n' : '; ');
}
