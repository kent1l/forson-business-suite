import { formatPHP } from './currency';

export type Supplier = { supplier_id: number; supplier_name: string; contact_person?: string | null; phone?: string | null; email?: string | null };
export type ParsedCandidate = { part_id: number; display_name?: string | null; detail?: string | null; internal_sku?: string | null; last_cost?: number | string | null };
export type SmartPOLine = {
  client_id: string; part_id: number | null; display_name: string; custom_item_name: string | null;
  unit: string | null; draft_part_data?: Record<string, unknown> | null; quantity: number; cost_price: number;
  match_status: string; confirmed: boolean; candidates: ParsedCandidate[];
};
export type PurchaseOrder = { po_id: number; po_number: string; supplier_id: number; supplier_name: string; order_date: string; expected_date?: string | null; notes?: string | null; status: string; total_amount: number | string | null };

export const lineTotal = (line: Pick<SmartPOLine, 'quantity' | 'cost_price'>) => Number(line.quantity || 0) * Number(line.cost_price || 0);
export const orderTotal = (lines: SmartPOLine[]) => lines.reduce((total, line) => total + lineTotal(line), 0);
export const lineKey = (line: Pick<SmartPOLine, 'client_id'>) => line.client_id;
export const needsResolution = (line: SmartPOLine) => line.match_status === 'ambiguous' || (line.match_status === 'fuzzy' && !line.confirmed);
export const canReviewPurchaseOrder = (supplierId: number | null, lines: SmartPOLine[]) => Boolean(supplierId && lines.length && !lines.some(needsResolution));

/** Keeps drafts/API payloads intentionally small and free of UI-only state. */
export const serializeLines = (lines: SmartPOLine[]) => lines.map(({ client_id, display_name, match_status, confirmed, candidates, ...line }) => line);

export const summaryForPurchaseOrder = (po: PurchaseOrder, lines: Array<{ display_name: string; quantity: number | string; unit?: string | null; cost_price: number | string | null }>) => {
  const date = po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-PH') : 'Not specified';
  const itemText = lines.map((line) => `• ${line.quantity} ${line.unit || 'PCS'} ${line.display_name} @ ${formatPHP(line.cost_price || 0)}`).join('\n');
  return [
    `Purchase Order ${po.po_number || `PO-${po.po_id}`}`,
    `Supplier: ${po.supplier_name || 'Not specified'}`,
    `Expected date: ${date}`,
    '', itemText || 'No items', '', `Total: ${formatPHP(po.total_amount || 0)}`,
    po.notes ? `Note: ${po.notes}` : null,
    'Please confirm availability and delivery date.',
  ].filter(Boolean).join('\n');
};
