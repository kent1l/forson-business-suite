export type DocumentType = 'GRN' | 'Sales' | 'Invoice' | 'PurchaseOrders';
export type DocumentStatus = 'Draft' | 'Final' | 'Cancelled' | 'Archived';

export interface DocumentMetadata {
  id: string;
  date: string;
  type: DocumentType;
  referenceId: string;
  status: DocumentStatus;
  metadata?: Record<string, any>;
}

export interface DocumentSearchFilters {
  type: DocumentType | 'All';
  datePreset: number | 'custom';
  from?: string;
  to?: string;
  searchQuery: string;
  sortBy: 'date' | 'referenceId' | 'type';
  sortDir: 'asc' | 'desc';
  page: number;
  limit: number;
}
