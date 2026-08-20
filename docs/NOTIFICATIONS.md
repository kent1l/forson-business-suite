# In-app notifications

A bell icon with an unread badge in the top bar, backed by a small notification
service in the API. This document covers how the pieces fit together and what it
takes to add a new kind of alert.

## How an alert reaches a user

There is no per-user fan-out table. A notification is stored **once**, tagged
with the audience it is for, and matched against the caller at read time:

| Column | Meaning |
| --- | --- |
| `required_permission` | Everyone holding that permission key sees it. Level-10 admins see it regardless, mirroring the bypass in `authMiddleware.hasPermission`. |
| `target_employee_id` | Exactly that employee sees it ("your leave was approved"). |

At least one of the two must be set; a database check constraint enforces it and
`notificationService.emit` throws before touching the database if both are null.

Late binding is the point. Roles change often in this system — `authMiddleware`
deliberately re-reads `permission_level_id` from the database on every request so
a demotion takes effect immediately — and a recipient list baked in at emit time
would keep showing finance alerts to someone moved off the finance desk yesterday
while hiding them from someone moved onto it today.

## Read state

Because visibility is computed per request, read state cannot live on the
notification row. It comes from two places:

- `notification_receipt` — one row per (notification, employee), written only
  when someone actually reads or dismisses something. A missing row means unread.
- `employee_notification_state.all_read_before` — the "mark all as read"
  watermark. Anything created at or before it counts as read for that employee
  without a receipt row existing, which keeps that button O(1) no matter how many
  notifications are visible.

A notification is read when *either* applies. Dismissing implies reading, so a
dismissed item never keeps the badge lit.

## Endpoints

All under `/api`, all requiring only `protect` — no `hasPermission` guard, since
the audience is already baked into each row and enforced inside the service. The
mutation endpoints return the caller's refreshed unread count so the badge can
update without a second round trip.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/notifications/unread-count` | Badge count, capped server-side at 100 (renders as `99+`). |
| `GET` | `/notifications?limit=&before=&unread_only=` | One page, newest first. |
| `POST` | `/notifications/:id/read` | Body `{ read: false }` to undo. |
| `POST` | `/notifications/:id/dismiss` | Hides it for this user only. |
| `POST` | `/notifications/read-all` | Bumps the watermark. |

Paging is keyset (`before=<notification_id>`), not `OFFSET`. The list is
newest-first and the daily scans push new rows onto the head, so offset paging
would skip or repeat items whenever a scan fired mid-scroll.

Requesting a notification you cannot see returns the same `404` as one that does
not exist. Distinguishing the two would let any authenticated user enumerate ids
and learn which alerts exist.

## Where notifications come from

| Emitter | Alerts | Gated on |
| --- | --- | --- |
| `services/apDueDateReminderService.js` | Supplier bills due today / overdue | `ap:view` |
| `services/arDueDateReminderService.js` | Customer invoices due today / overdue | `ar:view` |
| `services/pdcReminderService.js` | Inbound and outbound cheques maturing or gone stale; cheques needing replacement | `pdc:view`, `ap-pdc:view`, `ap-pdc:manage` |
| `routes/leaveRoutes.js` | Leave filed (to approvers), approved / declined (to the requester) | `leave:approve`, direct |

The three scan services run daily at 07:00 Manila by default; the schedules live
in `settings` (`AP_DUE_DATE_REMINDER_SCHEDULE`, `AR_DUE_DATE_REMINDER_SCHEDULE`,
`PDC_REMINDER_SCHEDULE`).

The scans raise **one summary notification per condition**, not one per record.
A shop with forty overdue bills would otherwise bury every other alert, and the
row-level detail already exists on the page the notification links to.

## Deep linking

Clicking a notification must land the reader where the alert can be acted on —
not merely on the right page. `link_page` names the page (a key from
MainLayout's `switch`) and `link_state` carries whatever that page needs to
focus the right thing:

| Notification | `link_page` | `link_state` |
| --- | --- | --- |
| A/P bills due / overdue | `ap` | `{ tab: 'overview' }` |
| A/R invoices due / overdue | `ar` | `{ tab: 'overview' }` |
| Inbound cheques maturing / stale | `cheques_treasury` | `{ section: 'treasury', tab: 'inbound', maturityFilter: … }` |
| Outbound cheques maturing / stale | `cheques_treasury` | `{ section: 'treasury', tab: 'outbound', maturityFilter: … }` |
| Cheques needing replacement | `cheques_treasury` | `{ section: 'treasury', tab: 'outbound', statusFilter: 'BOUNCED' }` |
| Leave filed (to approvers) | `leave` | `{ tab: 'requests', statusFilter: 'Pending' }` |
| Leave approved / declined (to requester) | `leave` | `{ tab: 'requests', statusFilter: '' }` |

The filter is as important as the tab. "4 cheques mature today" landing on a desk
that lists every open cheque leaves the reader to find the four themselves —
exactly the work the notification was meant to save.

Target pages consume the payload with `hooks/useDeepLink.js`:

```js
useDeepLink(pageState, ({ tab }) => { if (tab) setActiveTab(tab); });
```

It applies once per navigation, keyed on the payload object's identity. A lazy
`useState` initialiser is not sufficient: MainLayout only swaps the rendered page
when the page *key* changes, so clicking a second A/P notification while already
on the A/P page leaves the component mounted and an initialiser would never run
again. Keying on identity also leaves the user free to change tabs afterwards
without the deep link snapping them back.

To point a notification at a page that does not accept `pageState` yet, add the
prop in `MainLayout.jsx` using the `currentPage === '<key>' ? pageState : null`
idiom already used there, then call `useDeepLink` in the page.

## Adding a new notification

```js
const notifications = require('../services/notificationService');

await notifications.emitSafe({
    type: 'inventory.stock_out',          // machine-readable; the UI maps it, never parses the title
    category: 'inventory',                // finance | treasury | hr | inventory | system
    severity: 'warning',                  // info | warning | critical
    title: '3 fast-moving parts are out of stock',
    body: 'Brake pads, oil filters and 1 more.',
    linkPage: 'inventory',                // a page key from MainLayout's switch
    linkState: { tab: 'stock', filter: 'out_of_stock' },  // see "Deep linking"
    requiredPermission: 'inventory:view',
    dedupeKey: `inventory.stock_out:${manilaDateString()}`,
});
```

Two rules matter more than the rest:

**Always set a `dedupeKey` for anything a scheduled job emits.** The scans re-run
every morning over the same open records, and a restart mid-morning re-runs them
again. Keying on the Manila date makes the emit idempotent within a day while
still speaking up tomorrow. `emit` returns `null` when the key already existed —
that is the normal case, not an error.

**Use `emitSafe` from route handlers, `emit` from inside a transaction.**
`emitSafe` logs and swallows failures so a broken alert can never turn a
successful business write into a 500. It runs outside any transaction on purpose;
a failed statement inside one would poison the transaction regardless of the
catch. When the alert genuinely should roll back with the change that caused it,
pass the transaction client to `emit` instead. For user-facing confirmations
("your leave was approved"), emit *after* `COMMIT` — the user should only be told
something happened once it is durably true.

## Retention

`notificationGroomer` deletes aged and expired rows nightly at 03:15 Manila —
after the day settles, well before the 07:00 scans, so a long delete never
overlaps an emitter. The window is `NOTIFICATION_RETENTION_DAYS` in `settings`
(default 90). Notifications are transient by nature and the scans re-raise
anything still true the next morning, so keeping them forever only grows the
table.

## Frontend

`components/layout/NotificationBell.jsx` mounts in `Header.jsx`; the panel and
row live alongside it, and `hooks/useNotifications.js` owns the polling.

Polling, not SSE: a 60-second poll of a single count endpoint needs no nginx
buffering changes and no connection management, and the alerts here are daily
scans and approval events rather than anything second-sensitive. **Polling pauses
while the tab is hidden** and refetches on the way back — without that, every
background tab is a permanent load generator. The service layer is deliberately
independent of the transport, so moving to Postgres `LISTEN`/`NOTIFY` later means
adding a push path, not rewriting the emitters.
