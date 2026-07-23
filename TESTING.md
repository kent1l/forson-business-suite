# Automated Testing & CI/CD Documentation

This document outlines the testing architecture, local execution commands, mocking strategies, developer guidelines, and CI/CD configuration for the **Forson Business Suite** monorepo.

---

## 1. Testing Architecture

The codebase is organized into npm workspaces under `packages/*`:

- **`packages/api` (Backend API & Services)**
  - **Framework**: Jest + Supertest.
  - **Test Directory**: `packages/api/tests/` (pattern: `*.test.js`).
  - **Scope**: Unit tests for helpers and service classes (`helpers.test.js`, `taxCalculationService.test.js`), and Integration tests for Express routes (`backupRoutes.test.js`, `refunds.test.js`, `stagedSales.test.js`).

- **`packages/web` (React + Vite Web App)**
  - **Framework**: Node Test Runner (`node --test`).
  - **Test Directory**: `packages/web/tests/` (pattern: `*.test.js`).
  - **Scope**: Unit tests for utility functions, date calculation logic, status badges, and payment term parsers (`terms.test.js`, `status.test.js`).

- **`packages/mobile` (Expo Mobile App)**
  - **Framework**: Node Test Runner (`node --test`).
  - **Test Directory**: `packages/mobile/tests/` (pattern: `*.test.js`).
  - **Scope**: Unit tests for formatting and calculation utilities (`currency.test.js`).

---

## 2. Running Tests Locally

### Root Workspace Commands
To execute the complete test suite across all monorepo workspaces:
```bash
# Run tests across all workspaces
npm test

# Run tests for specific packages
npm run test:api
npm run test:web
npm run test:mobile
```

### Running Specific Test Files
- **Backend API (`packages/api`)**:
  ```bash
  cd packages/api
  npx jest --config jest.config.js tests/helpers.test.js
  ```

- **Frontend Web (`packages/web`)**:
  ```bash
  cd packages/web
  node --test tests/terms.test.js
  ```

- **Mobile App (`packages/mobile`)**:
  ```bash
  cd packages/mobile
  node --test tests/currency.test.js
  ```

---

## 3. Database & Mocking Strategy

### Database Connection for Integration Tests
- **API Tests require a live PostgreSQL database instance.**
- Tests interact with the database via discrete environment variables (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).
- In local development, the PostgreSQL service runs via Docker (`forson_db` container).
- In GitHub Actions CI, a `postgres:15` service container is dynamically provisioned on port 5432 and seeded with migrations prior to running `npm test`.

### Third-Party Services & Global Mocks
- **MeiliSearch**: Mocked globally in `packages/api/jest.setup.js` to prevent external network calls during automated testing.
- **Authentication & RBAC**: Request context and user roles are mocked in Supertest calls by attaching valid tokens or mock user objects to `req.user`.

---

## 4. Developer Guidelines for Writing Tests

When creating new features or refactoring existing logic:

1. **Location & Naming**:
   - Place all new backend test files inside `packages/api/tests/` with the `.test.js` extension.
   - Place all frontend utility tests inside `packages/web/tests/` or `packages/mobile/tests/`.

2. **Assertions & Clean Execution**:
   - Never suppress errors quietly or comment out failing assertions.
   - Trace failing tests back to broken underlying contracts and fix the root cause.

3. **Graph protocol**:
   - Run `graphify update .` after updating code or adding new test suites to keep the codebase knowledge graph synchronized.

---

## 5. CI/CD Pipeline & GitHub Branch Protection

### CI Workflow Configuration
The GitHub Actions workflow is defined in [ci.yml](file:///.github/workflows/ci.yml).
- **Triggers**:
  - Pull requests targeting `main`, `master`, and `dev` branches (`opened`, `synchronize`, `reopened`).
  - Direct pushes/merges to `main`, `master`, and `dev`.
- **Features**:
  - Automated concurrency cancellation (`cancel-in-progress: true`) to terminate stale PR runs.
  - Dependency caching for fast build execution.
  - Automated PostgreSQL migration setup before test execution.

### GitHub Branch Protection Rule Settings
When configuring Branch Protection Rules in GitHub (`Settings -> Branches -> Branch Protection Rules`):

- **Required Status Check Job Name**: `Test Suite` (or job identifier `test`)
