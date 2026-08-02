---
description: Constraints and parameters for Hindsight memory operations (retain, recall)
globs: **/*
---

# Hindsight Memory Protocol

When calling `hindsight` MCP tools (`retain`, `recall`, `get_document`, etc.):

## 1. Retaining Memories (`hindsight` → `retain`)
- **Required Parameter**: `content` (string) — The detailed memory/knowledge payload. **Do NOT use `text`**.
- **Optional Parameters**:
  - `context` (string): Logical grouping namespace (e.g. `forson-business-suite-ar-plan-phase2`).
  - `tags` (array of strings): Searchable tags (e.g. `["forson-business-suite", "ar_phase2", "ar_ledger"]`).
  - `metadata` (object): Optional JSON metadata key-value pairs.

```json
{
  "content": "Detailed text of memory to retain...",
  "context": "project-context-name",
  "tags": ["tag1", "tag2"]
}
```

## 2. Recalling Memories (`hindsight` → `recall`)
- **Required Parameter**: `query` (string) — Natural language or keyword search query.
- **Optional Parameters**:
  - `tags` (array of strings): Filter memories containing specific tags.
  - `max_tokens` (integer): Output token budget limit (default: 4096).
