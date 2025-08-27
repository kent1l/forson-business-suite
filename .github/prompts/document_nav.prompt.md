Create a Document Management Interface (DMI) with the following specifications, building upon the existing implementation:

Technical Requirements:

1. Frontend Implementation
```typescript
// Path: src/components/document-management/DocumentInterface.tsx
interface DocumentInterfaceProps {
    viewMode: 'grid' | 'list';
    documentTypes: ['GRN', 'Sales', 'Invoice', 'PurchaseOrders'];
    dateRangePresets: [7, 30, 90]; // days
    itemsPerPage: [25, 50, 100];
}
```

- Implement responsive grid/list view using `@company/design-system` components
- Configure document filters:
  - Type: GRN, Sales, Invoice, Purchase Orders
  - Date Range: Last 7/30/90 days with custom range option
  - Search: document number, reference ID, metadata (full-text)
- Enable sorting on columns: date, type, reference (ASC/DESC)
- Implement pagination with lazy loading
- Utilize `projectCache` mechanism for result caching
- Handle loading/error states using design system components

2. Document Display & Interaction
```typescript
interface DocumentMetadata {
    date: Date;
    type: DocumentType;
    referenceId: string;
    status: DocumentStatus;
    iconPath: string; // from icon-library
}
```

- Display document cards/rows with metadata
- Implement document actions:
  - View: Open in `PreviewComponent`
  - Download: Binary stream
  - Share: Generate temporary URL
- Enable keyboard navigation (Tab: focus, Enter: select, Esc: close)

3. Layout Structure
```
/documents
└── /:documentType
    └── /:documentId
```

- Implement three-panel layout:
  - Left: Collapsible filters (width: 250px)
  - Center: Document list/grid
  - Right: Document preview (width: 400px)

4. Data Management & Database Migration
```sql
-- Path: migrations/document_metadata_v2.sql
-- Update schema and add indices
ALTER TABLE documents ADD COLUMN metadata JSONB;
CREATE INDEX idx_documents_metadata ON documents USING GIN (metadata);
```

Execute migrations:
```bash
docker-compose exec db psql -U postgres -d documents -f /migrations/document_metadata_v2.sql
```

Performance Requirements:
- Initial load time: < 2 seconds
- Document preview rendering: < 500 milliseconds
- Search query response: < 1 second
- Memory usage limit: 256MB

Reference Implementation:
- Components: `src/components/document-management/*`
- Services: `src/services/document/*`
- Database: `initial_schema.sql`

Integration Testing:
- Validate CRUD operations via DocumentRepository
- Verify cache hit rates with DocumentCacheService
- Confirm performance metrics meet requirements
- Test responsive behavior across breakpoints