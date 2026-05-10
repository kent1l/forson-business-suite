---
trigger: always_on
---

---
description: Mandates the use of Graphify for context acquisition before file reads.
globs: packages/**
---

# Graph-First Protocol

- **Context-Gating:** You are strictly forbidden from reading raw source files, `node_modules`, or the raw `graphify-out/graph.json` file upon initialization.
- **Query First:** Before proposing any changes to `packages/web` or `packages/api`, you must determine system topology by utilizing the project's graph scripts (e.g., `npm run graph:query <topic>`).
- **Targeted Reads Only:** Only read specific raw files after identifying them through the graph mapping process.