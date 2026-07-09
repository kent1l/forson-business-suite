---
name: release-version
description: Step-by-step instructions for releasing a new version, checking migration status, running tests inside Docker, bumping version, and creating git tags.
---

# Skill: Release Version

Use this skill to release a new version of the application.

## Prerequisites & Verification

1. **Verify Database Migrations**: Run migration status inside the Docker backend container:
   ```bash
   docker exec forson_backend_dev npm run migrate:status
   ```
   Ensure `Pending: 0`.

2. **Verify Tests**: Run integration/unit tests inside the Docker backend container:
   ```bash
   docker exec forson_backend_dev npm run test
   ```
   Ensure all tests pass.

## Release Steps

1. **Create Release Branch**:
   Check out a new branch for the release from the target commit:
   ```bash
   git checkout -b release/v<VERSION> <COMMIT_SHA>
   ```

2. **Bump Workspace Version**:
   Run the following command to bump the web workspace version:
   ```bash
   npm version <VERSION> --no-git-tag-version --workspace packages/web
   ```

3. **Verify Build**:
   Build the frontend workspace to verify build health:
   ```bash
   npm run -w packages/web build
   ```

4. **Commit Version Change**:
   Stage the version bump changes and commit:
   ```bash
   git add package-lock.json packages/web/package.json packages/web/package-lock.json
   git commit -m "chore(release): prepare v<VERSION>"
   ```

5. **Tag the Release**:
   Create an annotated tag:
   ```bash
   git tag -a v<VERSION> -m "Release v<VERSION>"
   ```

6. **Push Branch and Tag**:
   Push the new release branch and its tag to the remote origin:
   ```bash
   git push origin release/v<VERSION>
   git push origin v<VERSION>
   ```
