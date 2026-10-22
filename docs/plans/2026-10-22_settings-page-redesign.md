# Application Settings Page Redesign — Implementation Plan

> **Forson Business Suite** | **Date:** 2026-10-22 | **Revision:** 1.0
> **Branch inspected:** `auto-receipt-increment-and-tax-selection` (HEAD `039e38e`)
> **Status:** Phase 1 shipped and committed (lint-only verified). Phases 2–6 not started.

## 0. Status at a Glance

| Phase | Status | Outcome |
|---|---|---|
| 1. Layout redesign (sidebar, full-screen, back/exit, transitions) | Done (not browser-verified) | See section 5 |
| 2. Unsaved-changes guard | Not started | Dirty indicator, Save disabled when clean, confirm on Back/Exit/tab switch |
| 3. Tab in URL/hash + palette deep links | Not started | Refresh, browser back and links preserve the tab |
| 4. Settings search | Not started | Filter box in sidebar |
| 5. Card-based sections and save feedback | Not started | Titled cards, consistent "Saved" feedback, auto-save tabs labelled |
| 6. Mobile nav + file split | Not started | Dropdown/drawer nav; panels moved to `components/settings/` |

## 1. For a New Session or Agent Picking This Up

Before starting:
1. Run `graphify query "settings page sidebar MainLayout"` — file references here can drift; trust a fresh query.
2. Call hindsight `recall` for `FBS settings page redesign full-screen sidebar`.
3. Confirm the table above against `git log`/`git status` before trusting it.

When you finish a phase or make a non-obvious decision:
1. Update the Status table and the phase section.
2. Retain new decisions/gotchas to hindsight.
3. Run `graphify update .`.

Constraints: React + Tailwind v4 + `lucide-react` only. The app has **no router** — navigation is `onNavigate(page, state)` in `App.jsx` (`currentPage` state). Do not introduce a router or state library; Phase 3 must use `location.hash`/`history` manually.

## 2. Objective

The old page was a narrow `max-w-4xl` card with a 15-tab horizontal row. Goal: a modern, efficient, area-adaptive settings experience that is easy to navigate and safe to edit.

## 3. Decisions Already Taken

- **Full-screen settings (Option A)** chosen over two sidebars or a collapsed main rail: `MainLayout` hides the main Sidebar, Header and CashSessionBar when `currentPage === 'settings'`. The main header (global search, logout) is therefore unreachable from settings; user was told and may ask to restore it.
- Back/Exit/Cancel all call `onNavigate('dashboard')` — not "previous page" (no history stack exists).
- Transitions use the View Transitions API only when crossing into/out of settings; instant fallback when unsupported; disabled under `prefers-reduced-motion`.
- Nav groups: General, Finance, Operations, System (config: `SETTINGS_NAV` in `SettingsPage.jsx`).

## 4. Architecture

- `SettingsPage` owns `settings` (key/value from `GET /api/settings`), `activeTab`, `handleChange`, and `handleSave` (single `PUT /api/settings` of all keys).
- Panels receive `settings`/`handleChange`; some tabs self-manage persistence (PaymentMethods, Physical Documents, Deduplication, Permissions, Data Utilities, and Brand Identity/Backup via `handleSave` prop). Tabs in `showSave` list use the sticky Save bar.
- Page access is admin-only (`permission_level_id === 10`).

## 5. Phase 1 — As Built (Done)

Commits: `3569db4` (width), `2519e50` (redesign), `039e38e` (transitions); full-screen change in `MainLayout.jsx`.
- [x] Removed `max-w-4xl`; Company Info as responsive grid (1/2/3 cols); A/R and Analytics `max-w-2xl` → `max-w-none xl:max-w-5xl`
- [x] Grouped icon sidebar (sticky, `lg+`) and horizontal pills (`<lg`)
- [x] Page header with Back button; section title bar with Exit; sticky Save bar with Cancel
- [x] Back/Exit available on Payment Methods and all other tabs
- [x] Settings hides main Sidebar/Header/CashSessionBar (`fullScreen` in `MainLayout.jsx`)
- [x] Crossfade (View Transitions in `App.jsx` `handleNavigate`), `settings-enter` and per-tab `settings-panel-in` animations (`index.css`)
- [ ] Browser/visual verification — NOT done; only ESLint (0 errors) was run
- [ ] Financial, Payroll, Cycle Count tabs still single-column stacks (not restyled)

## 6. Phases Not Started

**Phase 2 — Unsaved-changes guard.** In `SettingsPage.jsx` keep a `savedSettings` snapshot (set after fetch and after successful save); `isDirty` = JSON compare. Show "Unsaved changes" in save bar, disable Save when clean. Wrap Back/Exit/Cancel and tab switching in a confirm (reuse `Modal` from `components/ui/Modal`). Add `beforeunload` while dirty. Note self-saving tabs must not count as dirty/lose state; Cancel should reset to snapshot. Beware: tab switch unmounts panels but `settings` state persists in the page, so dirty state survives tab switches — decide whether to block or allow.

**Phase 3 — URL state.** Sync `activeTab` with `location.hash` (`#settings/<tab>`) via `history.replaceState`/`hashchange`; init from hash. Optionally pass `onNavigate('settings', { tab })` via `pageState` (MainLayout already passes `pageState` to some pages) and add settings sections to `CommandPalette`.

**Phase 4 — Search.** Filter input atop sidebar over `SETTINGS_NAV` labels plus keyword aliases; show matches across groups, Enter opens first match; `/` focuses it.

**Phase 5 — Cards and feedback.** Split Company/Financial/Payroll/Cycle Count into titled cards with description (label-left/field-right on `xl`). Add "Saved at HH:MM" state. Mark self-saving tabs ("Changes save automatically").

**Phase 6 — Mobile + split.** Replace pills with a section `<select>`/drawer below `lg`. Move inline panels (`CompanyInfoSettings`, `FinancialSettings`, `PayrollSettings`, `CycleCountSettings`, `TaxRateSettings`, `MobileAppSettings`) and `SETTINGS_NAV` into `components/settings/`; keep behavior identical (pure refactor, do last to avoid merge churn).

## 7. Explicitly Deferred

- Restoring the main header/global search on settings — revisit if users report needing it.
- Per-section Save buttons (vs single PUT) — revisit if dirty-tracking per section proves needed.

## 8. Files Touched So Far

- `packages/web/src/pages/SettingsPage.jsx`
- `packages/web/src/components/layout/MainLayout.jsx`
- `packages/web/src/App.jsx`
- `packages/web/src/index.css`
- `packages/web/src/components/settings/ARAdjustmentSettings.jsx`
- `packages/web/src/components/settings/AnalyticsSettings.jsx`

## 9. Verification Commands

```bash
npm run -w packages/web lint          # expect 0 errors (many pre-existing unused-var warnings on JSX components)
git log --oneline -5
./scripts/start-dev.sh                # then open Settings as an admin: check sidebar, Back/Exit on every tab,
                                      # Payment Methods tab, transition in/out, dark mode, <1024px pills, reduced motion
```

## 10. Change Log

- 2026-10-22 — Document created after Phase 1 (layout redesign) shipped; Phases 2–6 planned.
