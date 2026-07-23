1. **Test Audit & Directory Organization**
   - Add required test dependencies to mobile/web and root (`turbo`) [Done]
   - Re-organize backend tests into `packages/api/tests` [Done]
   - Configure Turborepo `turbo.json` with build, test, dev, lint tasks [Done]
   - Fix web tests by moving to vitest, removing `process.exit(1)` and fixing JS DOM environments [Done]
   - Add dummy tests for mobile [Done]

2. **Feature & Logic Discovery (Test Gap Analysis)**
   - Scan codebase (we observed many `authMiddleware`, `cheque`, `paymentTerms` tests exist).
   - We will write 1-2 new integration tests specifically for `Authentication & Role-Based Access Control` or `Calculations` if they are missing in the frontend/backend. (We will add an API test for user RBAC routes).

3. **Monorepo Orchestration & Scripts**
   - Implemented Turborepo [Done].
   - Configured `npm run test`, `build`, `lint` in root `package.json` [Done].

4. **CI/CD Pipeline Setup (GitHub Actions)**
   - Create `.github/workflows/ci.yml` [Done].

5. **Comprehensive Documentation**
   - Update `TESTING.md` [Done].

6. **Pre-commit Instructions**
   - Follow `pre_commit_instructions`.

7. **Submit**
   - Submit the changes using the provided tool.
