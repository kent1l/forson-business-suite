# Paperless receipt preview audit — 2026-10-20

Scope: all documents in the configured Paperless **Goods Receipt** document type. Read-only retrieval and PDF structure checks; no document, tag or financial changes.

| Check | Result |
|---|---|
| Supplier receipt previews fetched | 268 / 268 |
| Actual PDF previews | 268 |
| Retrieval failures | 0 |
| PDFs that failed structure/page parsing | 0 |
| Multi-page receipts | 33 |
| Receipt 18464 / document 1236 | Readable, unencrypted, one-page PDF; 420,427 bytes |

The original image-only viewer could affect **all 268** previews because all return PDF bytes. The audit found no file-specific corruption explaining a unique failure for 18464. Retrieval and parsing checks do not prove every page renders correctly in every browser.

Live runtime checks for 18464:

- Running API and frontend proxy both return HTTP 200 with Content-Type application/pdf and actual PDF signature.
- The currently served frontend includes the PDF viewer path.
- A real Chromium session opened the actual linked bill (81), resolved the live Paperless scan (1236), fetched the actual preview, and loaded it in a PDF frame with no JavaScript or image-display error. These requests were not mocked.
- The persistent reported image-error message was not reproduced in this runtime. An older loaded viewer, a previously open failed preview, an older/different server, or a mislabeled response remains possible. The user's app URL was requested to identify that exact serving path; do not treat a cache/deployment explanation as confirmed.

The browser now also checks the PDF signature and repairs the Blob MIME type, so PDF bytes can display even if a proxy still calls them image/png. Existing image support remains.

Full per-document results: [JSON audit](2026-10-20_paperless-preview-audit.json).

Reproduce the read-only format audit with `docker exec forson_backend_dev node scripts/auditPaperlessReceiptPreviews.js`. It writes a JSON report inside the container at `/tmp/paperless-preview-audit.json`.
