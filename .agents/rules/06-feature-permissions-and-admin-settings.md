---
description: Enforces immediate role permission integration and Admin Settings panel inclusion for all new system features.
globs: **/*
---

# New Feature Protocol: Role Permissions & Admin Settings

Whenever a new feature, API module, route, or major system capability is added to the system, it MUST immediately follow and implement two mandatory integration requirements before being declared complete:

## 1. Role Permission Integration (RBAC)
- **Permission Definitions**: Define and register new permission keys/scopes (e.g., `feature:read`, `feature:write`, `feature:admin`) in the system RBAC schema/constants.
- **Backend API Protection**: Enforce role/permission check middleware on all new API endpoints to ensure unauthorized users cannot execute feature actions.
- **Frontend Access Control**: Protect frontend routes, navigation items, buttons, and UI components with permission guards/hooks so that visibility and actionability strictly reflect the authenticated user's assigned role permissions.

## 2. Admin Settings Panel Integration
- **Admin Configuration UI**: Expose the feature's configuration options, feature toggles, and role permission assignments within the Admin Settings Panel.
- **Permission Management**: Enable administrators to view, assign, and modify access rights for the new feature across all system roles directly from the Admin Settings interface.
- **System Settings Consistency**: Ensure all persistent feature settings are stored, fetched, and manageable through the centralized Admin Settings API and UI.

## Verification Checklist
- [ ] Permission keys added to database schema / system permission matrix.
- [ ] Backend route handlers protected by permission checks/middleware.
- [ ] Frontend UI routes and action elements wrapped with permission guards.
- [ ] Admin Settings Panel updated with feature configuration and permission controls.
- [ ] Tests added covering permission authorization logic and admin settings endpoints.
