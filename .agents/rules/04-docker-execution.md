---
description: Protocol for executing backend tasks, tests, and migrations
globs: **/*
---

# Docker Command Execution Protocol

- **Context Constraint**: Database migrations (`migrate:status`, `migrate:verify`), API/integration tests, and database-connected scripts fail on the host environment due to postgres credential constraints.
- **Mandatory Execution Path**: You must execute these commands inside the `forson_backend_dev` container using `docker exec`:
  - Run database migration status:
    ```bash
    docker exec forson_backend_dev npm run migrate:status
    ```
  - Run backend tests:
    ```bash
    docker exec forson_backend_dev npm run test
    ```
