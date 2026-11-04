const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function compareFitmentValues(a, b) {
    const left = String(a ?? '').trim();
    const right = String(b ?? '').trim();
    if (!left || !right) return left ? -1 : right ? 1 : 0;
    return collator.compare(left, right);
}

// Fitting position first, then vehicle identity and combination details.
// Missing details sort last without acquiring a display placeholder.
export function compareFitmentRows(a, b) {
    const values = row => [
        row.position, row.make, row.model, row.effect === 'exclude' ? 1 : 0,
        row.engine, row.chassis, row.year_start, row.year_end,
        row.generation, row.variant || row.variant_descriptor,
        row.drivetrain, row.transmission,
        row.fuel_type_qualifier || row.fuel_type,
        row.displacement_liters_qualifier || row.displacement_liters,
        row.market, row.make_id, row.model_id,
        row.application_id, row.rule_id,
    ];
    const left = values(a), right = values(b);
    for (let index = 0; index < left.length; index += 1) {
        const order = compareFitmentValues(left[index], right[index]);
        if (order) return order;
    }
    return 0;
}
