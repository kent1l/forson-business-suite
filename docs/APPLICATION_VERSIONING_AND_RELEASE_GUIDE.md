# Application Versioning & Release Guide

This guide defines how Forson Business Suite versions are established, surfaced in the UI, and released safely.

## Objectives

- Keep versions **traceable** (release tag ↔ build ↔ commit).
- Keep versions **consistent** across frontend, backend, and docs.
- Keep releases **repeatable** and **auditable**.
- Keep rollback and incident debugging fast.

## Versioning Standard

Use **Semantic Versioning (SemVer)**: `MAJOR.MINOR.PATCH`.

- **MAJOR**: Breaking or incompatible changes.
- **MINOR**: Backward-compatible features.
- **PATCH**: Backward-compatible fixes/chore updates.

Examples:
- `1.4.0` = new feature release.
- `1.4.1` = bug fix release.
- `2.0.0` = breaking changes.

### Optional Pre-Release Suffixes

Use suffixes for non-production builds:
- `1.5.0-rc.1` (release candidate)
- `1.5.0-beta.2`

## Source of Truth for Version

For the web app package, `packages/web/package.json` `version` is the baseline version.

At build time, the app may be overridden by CI variables:

- `VITE_APP_VERSION` (recommended; explicit release version)
- `VITE_APP_COMMIT_SHA` (full git SHA)
- `VITE_APP_BUILD_DATE` (ISO-8601 UTC timestamp)

Best practice:
- In CI/CD, always inject all three values for production builds.
- For local builds, defaults are acceptable for developer convenience.

## UI Version Display

The sidebar (expanded state) shows a subtle version label at the bottom (`vX.Y.Z`), giving support teams and users a quick way to confirm deployed version.

Guidelines:
- Keep text unobtrusive (`text-gray-400`, small font).
- Do not clutter with full commit and timestamp in primary UI.
- Put detailed build metadata in logs, diagnostics page, or dev tools if needed.

## Release Best Practices Checklist

Before releasing:

1. Ensure all tests/checks pass.
2. Confirm migrations are prepared and reversible. Use `npm run -w packages/api migrate:status` or `migrate:verify` to ensure there is no schema drift before deploying.
3. Update `packages/web/package.json` version.
4. Update release notes/changelog.
5. Create an annotated git tag (`vX.Y.Z`).
6. Build artifacts with pinned version + commit + build date.
7. Deploy progressively (staging, then production).
8. Verify runtime health checks and smoke tests.
9. Record release metadata in deployment logs/ticket.

After releasing:

1. Confirm UI version text matches the intended release.
2. Validate API and DB compatibility.
3. Monitor logs/metrics/alerts.
4. Keep a documented rollback plan and previous stable tag.

## Recommended Release Workflow

### 1) Branch and Prepare

```bash
git checkout -b release/vX.Y.Z
```

- Finalize merged scope.
- Freeze non-critical feature merges.

### 2) Bump Version

From repository root:

```bash
npm version X.Y.Z --no-git-tag-version --workspace packages/web
```

Or edit `packages/web/package.json` manually if needed.

### 3) Validate

```bash
npm run -w packages/web lint
npm run -w packages/web build
npm run -w packages/api test
```

### 4) Commit Release Prep

```bash
git add packages/web/package.json package-lock.json docs/
git commit -m "chore(release): prepare vX.Y.Z"
```

### 5) Tag Release

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main --tags
```

### 6) Build with Explicit Metadata

In CI/CD (example):

```bash
export VITE_APP_VERSION=X.Y.Z
export VITE_APP_COMMIT_SHA=$(git rev-parse HEAD)
export VITE_APP_BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
npm run -w packages/web build
```

### 7) Deploy & Verify

- Deploy to staging first.
- Run smoke tests and check logs.
- Promote to production.
- Confirm sidebar shows `vX.Y.Z`.

## Rollback Guidance

- Roll back by redeploying the previous known-good tag.
- Keep DB rollback scripts for destructive migrations.
- If schema rollback is unsafe, use forward-fix strategy and patch release (`X.Y.(Z+1)`).

## Governance Recommendations

- Protect `main` with required checks.
- Require PR review for version bumps and migration changes.
- Keep a changelog per release.
- Automate tagging/build metadata injection in CI/CD.
- Use signed tags and signed commits for production compliance where required.
