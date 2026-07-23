# Testing Architecture & Guidelines

## Overview
The Forson Business Suite monorepo uses a comprehensive testing strategy covering backend (API), frontend (Web), and mobile applications.

- **Backend (API)**: Uses Jest and Supertest.
- **Frontend (Web)**: Uses Vitest, jsdom, and React Testing Library.
- **Mobile (React Native/Expo)**: Uses Jest and React Native Testing Library.

## Test File Organization
All tests should be placed in `tests/` directories or co-located next to the implementation using `.test.ts`, `.spec.ts`, `.test.js`, or `.test.jsx` suffixes.

## How to run tests

### Run all tests via Turborepo
```sh
npm run test
```

### Run tests for a specific package
```sh
npm run test -w packages/api
npm run test -w packages/web
npm run test -w packages/mobile
```

## Mocking Strategy
- **Database**: Mock the `pg` pool or `../db.js` layer directly. See backend tests for examples.
- **Authentication**: Use mock JWT tokens or stub the authentication middleware.
- **Third-Party**: Mock Meilisearch or PDF generation where necessary.

## CI/CD Pipeline
- We use GitHub Actions configured in `.github/workflows/ci.yml`.
- The pipeline utilizes Turborepo for dependency and task caching (`npm run test` and `npm run lint`).
- The primary check job is named `Test Suite` in GitHub Actions for Branch Protection rules.
