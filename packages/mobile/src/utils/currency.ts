export function formatPHP(amount: number | string): string {
  const parsed = typeof amount === 'string' ? parseFloat(amount) : amount;
  const val = typeof parsed === 'number' && !isNaN(parsed) ? parsed : 0;
  return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
