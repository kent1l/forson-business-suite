---
description: Manages cross-package updates across the monorepo boundary.
---

---
description: Manages cross-package updates across the monorepo boundary.
---

# Monorepo Cascade Workflow

1. **Analyze Origin:** Identify the exact changes made or proposed in `packages/api` (e.g., database schema migrations, new endpoints).
2. **Trace Impact:** Map how these backend modifications impact the frontend (`packages/web`). Identify required updates to tRPC routers, GraphQL schemas, or shared TypeScript interfaces.
3. **Draft Sync Plan:** Output a bulleted list of the exact files in `packages/web` that require syntax updates to maintain type safety and API contract integrity.
4. **Pause for Approval:** Ask the developer: "Do you approve these cascading changes to the web package?"
5. **Execute:** Apply the syntax changes to the frontend using concise diffs.