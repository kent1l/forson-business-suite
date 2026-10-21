import { formatInTimeZone } from 'date-fns-tz';

// receipt_date is stored as timestamptz. Read its Manila calendar day before
// putting it back into a date input; slicing the UTC response loses a day.
export function receiptDateForInput(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return formatInTimeZone(value, 'Asia/Manila', 'yyyy-MM-dd');
}

// Give PostgreSQL an explicit zone so saving a date input never depends on
// the database session's timezone. Manila uses UTC+08:00 year round.
export function receiptDateForPayload(value) {
    return value ? `${value}T00:00:00+08:00` : null;
}
