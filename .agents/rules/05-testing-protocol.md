---
description: Enforces test updates, test co-location, and automated test execution on all feature additions and code edits.
globs: **/*
---

# Testing & Verification Protocol

- **Mandatory Test Maintenance**: When creating a new feature, modifying existing business logic, or updating API endpoints/components, you MUST create or update corresponding unit/integration tests in `packages/<package>/tests/`.
- **No Un-tested Logic**: Never declare a feature, calculation, or bug fix complete without adding test coverage for the modified path.
- **Empirical Test Verification**: Before concluding any turn or declaring success, you MUST execute `npm test` (or the specific workspace test command e.g., `npm run test:api`) to empirically verify that all tests pass 100% cleanly.
- **Graph Synchronization**: After writing or modifying code and test files, run `graphify update .` to keep the knowledge graph synchronized.
