/**
 * Shared Supplier A/P navigation contract and session storage persistence.
 */

const ALLOWED_RETURN_PAGES = new Set(['ap', 'suppliers', 'goods_receipt', 'cheques_treasury']);
const SESSION_STORAGE_KEY = 'forson_ap_nav_context';

export function createApNavigationPayload({
  action,
  supplierId,
  billId = null,
  grnId = null,
  source = null,
  contextId = null,
}) {
  const generatedContextId = contextId || `ap_ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    action,
    supplierId: supplierId ? Number(supplierId) : null,
    billId: billId ? Number(billId) : null,
    grnId: grnId ? Number(grnId) : null,
    source: source && ALLOWED_RETURN_PAGES.has(source.pageKey) ? source : { pageKey: 'ap' },
    contextId: generatedContextId,
  };
}

export const makeNavContext = createApNavigationPayload;

export function saveNavContext(payload) {
  if (!payload || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      action: payload.action,
      supplierId: payload.supplierId,
      billId: payload.billId,
      grnId: payload.grnId,
      source: payload.source,
      contextId: payload.contextId,
    }));
  } catch (err) {
    console.warn('Failed to save navigation context to sessionStorage', err);
  }
}

export function getNavContext() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.action || !parsed.supplierId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearNavContext() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage clear failure
  }
}

export function returnToOrigin(onNavigate, navContext, defaultPage = 'ap') {
  clearNavContext();
  const source = navContext?.source;
  const pageKey = (source?.pageKey && ALLOWED_RETURN_PAGES.has(source.pageKey)) ? source.pageKey : defaultPage;
  const pageState = {
    selectedSupplierId: navContext?.supplierId || null,
    activeTab: source?.tab || 'bills',
    focusedRecordId: navContext?.billId || navContext?.grnId || null,
    filters: source?.filters || null,
    refetchTimestamp: Date.now(),
  };
  if (typeof onNavigate === 'function') {
    onNavigate(pageKey, pageState);
  }
}
