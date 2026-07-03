---
type: "query"
date: "2026-07-03T12:24:46.027313+00:00"
question: "Why does hasPermission() connect Auth Permissions & Dashboard Widgets to 18 other modules across the codebase?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["hasPermission()", "Auth Permissions & Dashboard Widgets"]
---

# Q: Why does hasPermission() connect Auth Permissions & Dashboard Widgets to 18 other modules across the codebase?

## Answer

Expanded from original query via vocab: ['has', 'permission']. The function hasPermission() (defined in packages/api/middleware/authMiddleware.js) acts as a central security gate. On the backend, it is imported and applied as middleware in 18+ API routes (e.g. arRoutes.js, cycleCountRoutes.js, customerRoutes.js, refundRoutes.js, backupRoutes.js, documentsRoutes.js, etc.) to authenticate and authorize requests dynamically. On the frontend, pages and dashboard elements (e.g. RecentActivityFeed, AccountsReceivablePage, Dashboard) invoke it or check permissions to dynamically hide/disable tabs, buttons, or widgets depending on user roles.

## Outcome

- Signal: useful

## Source Nodes

- hasPermission()
- Auth Permissions & Dashboard Widgets