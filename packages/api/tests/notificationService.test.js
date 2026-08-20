jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const notifications = require('../services/notificationService');

const financeUser = { employee_id: 7, permission_level_id: 2, permissions: ['ap:view', 'ar:view'] };
const adminUser = { employee_id: 1, permission_level_id: 10, permissions: [] };

beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rows: [{ count: 0 }] });
});

describe('emit', () => {
    it('refuses a notification nobody can see', async () => {
        await expect(notifications.emit(db, {
            type: 'test.orphan', category: 'system', title: 'Nobody gets this',
        })).rejects.toThrow(/no audience/);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('returns null when the dedupe key already exists', async () => {
        // ON CONFLICT DO NOTHING yields no RETURNING row — the normal outcome
        // when a daily scan re-reports a condition that is still true.
        db.query.mockResolvedValue({ rows: [] });
        const result = await notifications.emit(db, {
            type: 'ap.bills_overdue', category: 'finance', title: '2 bills overdue',
            requiredPermission: 'ap:view', dedupeKey: 'ap.bills_overdue:2026-08-20',
        });
        expect(result).toBeNull();
    });

    it('serialises link_state as JSON and stringifies entity_id', async () => {
        db.query.mockResolvedValue({ rows: [{ notification_id: 1 }] });
        await notifications.emit(db, {
            type: 'leave.approved', category: 'hr', title: 'Approved',
            targetEmployeeId: 7, linkState: { tab: 'mine' }, entityId: 42,
        });
        const params = db.query.mock.calls[0][1];
        expect(params).toContain('{"tab":"mine"}');
        expect(params).toContain('42');
    });
});

describe('emitSafe', () => {
    it('swallows failures so a broken alert cannot fail the business write', async () => {
        db.query.mockRejectedValue(new Error('connection lost'));
        await expect(notifications.emitSafe({
            type: 'leave.approved', category: 'hr', title: 'Approved', targetEmployeeId: 7,
        })).resolves.toBeNull();
    });
});

describe('audience parameters', () => {
    it('passes the caller permissions and a false admin flag for ordinary users', async () => {
        await notifications.unreadCount(financeUser);
        const [employeeId, permissions, isAdmin] = db.query.mock.calls[0][1];
        expect(employeeId).toBe(7);
        expect(permissions).toEqual(['ap:view', 'ar:view']);
        expect(isAdmin).toBe(false);
    });

    it('flags level 10 as admin so every permission-gated alert is visible', async () => {
        await notifications.unreadCount(adminUser);
        expect(db.query.mock.calls[0][1][2]).toBe(true);
    });

    it('tolerates a user whose permissions were never populated', async () => {
        await notifications.unreadCount({ employee_id: 3, permission_level_id: 2 });
        expect(db.query.mock.calls[0][1][1]).toEqual([]);
    });
});

describe('list', () => {
    beforeEach(() => db.query.mockResolvedValue({ rows: [] }));

    it('clamps the page size to a sane range', async () => {
        await notifications.list(financeUser, { limit: 5000 });
        expect(db.query.mock.calls[0][1]).toContain(50);

        db.query.mockClear();
        await notifications.list(financeUser, { limit: 0 });
        expect(db.query.mock.calls[0][1]).toContain(20);
    });

    it('pages by keyset rather than offset', async () => {
        await notifications.list(financeUser, { before: 120 });
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/n\.notification_id < \$4/);
        expect(sql).not.toMatch(/OFFSET/i);
        expect(params[3]).toBe(120);
    });

    it('reports a next cursor only when the page came back full', async () => {
        const page = Array.from({ length: 20 }, (_, i) => ({ notification_id: 100 - i }));
        db.query.mockResolvedValue({ rows: page });
        expect((await notifications.list(financeUser, { limit: 20 })).nextCursor).toBe(81);

        db.query.mockResolvedValue({ rows: page.slice(0, 3) });
        expect((await notifications.list(financeUser, { limit: 20 })).nextCursor).toBeNull();
    });

    it('hides dismissed notifications, and unread-only hides read ones', async () => {
        await notifications.list(financeUser, {});
        expect(db.query.mock.calls[0][0]).toMatch(/r\.dismissed_at IS NULL/);

        db.query.mockClear();
        await notifications.list(financeUser, { unreadOnly: true });
        expect(db.query.mock.calls[0][0]).toMatch(/NOT \(/);
    });
});

describe('setReceipt', () => {
    it('refuses to write a receipt for a notification the caller cannot see', async () => {
        db.query.mockResolvedValue({ rows: [] }); // visibility probe finds nothing
        expect(await notifications.setReceipt(financeUser, 99, { read: true })).toBe(false);
        // Only the probe ran; no INSERT was attempted.
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it('writes a receipt once visibility is confirmed', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ notification_id: 5 }] })
            .mockResolvedValueOnce({ rows: [] });
        expect(await notifications.setReceipt(financeUser, 5, { read: true })).toBe(true);
        expect(db.query.mock.calls[1][0]).toMatch(/INSERT INTO notification_receipt/);
        expect(db.query.mock.calls[1][1]).toEqual([5, 7]);
    });

    it('leaves the other flag untouched when only one is being set', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ notification_id: 5 }] })
            .mockResolvedValueOnce({ rows: [] });
        await notifications.setReceipt(financeUser, 5, { read: true });
        // dismissed_at was not passed, so the upsert must preserve its value.
        expect(db.query.mock.calls[1][0]).toMatch(/dismissed_at = notification_receipt\.dismissed_at/);
    });
});

describe('markAllRead', () => {
    it('bumps a single watermark row instead of writing per-notification receipts', async () => {
        await notifications.markAllRead(financeUser);
        expect(db.query).toHaveBeenCalledTimes(1);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO employee_notification_state/);
        expect(sql).toMatch(/all_read_before = NOW\(\)/);
        expect(params).toEqual([7]);
    });
});

describe('prune', () => {
    it('falls back to 90 days when the setting is missing or unparseable', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ deleted: 0 }] });
        await notifications.prune();
        expect(db.query.mock.calls[1][1]).toEqual([90]);
    });

    it('honours NOTIFICATION_RETENTION_DAYS', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ setting_value: '30' }] })
            .mockResolvedValueOnce({ rows: [{ deleted: 12 }] });
        expect(await notifications.prune()).toBe(12);
        expect(db.query.mock.calls[1][1]).toEqual([30]);
    });
});
