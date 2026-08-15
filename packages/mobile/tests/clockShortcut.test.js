const assert = require('node:assert');
const test = require('node:test');

const {
  shouldShowShortcut,
  scheduleMinutes,
  formatScheduledEnd,
} = require('../src/components/clockShortcutRules.ts');

const at = (h, m = 0) => h * 60 + m;
const base = {
  canPunch: true,
  hasState: true,
  lastDirection: null,
  scheduledTimeOut: '17:00:00',
  nowMinutes: at(9),
};
const show = (over) => shouldShowShortcut({ ...base, ...over });

test('scheduleMinutes parses a time-of-day, and rejects nonsense', () => {
  assert.strictEqual(scheduleMinutes('17:00:00'), at(17));
  assert.strictEqual(scheduleMinutes('08:30:00'), at(8, 30));
  assert.strictEqual(scheduleMinutes('00:00:00'), 0);
  assert.strictEqual(scheduleMinutes(null), null);
  assert.strictEqual(scheduleMinutes('not-a-time'), null);
});

test('it is shown before the first clock-in, whatever the hour', () => {
  assert.strictEqual(show({ lastDirection: null, nowMinutes: at(6) }), true);
  assert.strictEqual(show({ lastDirection: null, nowMinutes: at(13) }), true);
  assert.strictEqual(show({ lastDirection: null, nowMinutes: at(22) }), true);
});

test('it steps aside through the working day once clocked in', () => {
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(8) }), false);
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(12) }), false);
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(15, 59) }), false);
});

test('it returns exactly one hour before the scheduled end', () => {
  // The boundary is inclusive: at 16:00 against a 17:00 finish it must be there.
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(16) }), true);
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(15, 59) }), false);
});

test('it stays up past the scheduled end, for anyone running late', () => {
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(17) }), true);
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(19) }), true);
  assert.strictEqual(show({ lastDirection: 'IN', nowMinutes: at(23, 59) }), true);
});

test('it disappears once the day is closed out', () => {
  assert.strictEqual(show({ lastDirection: 'OUT', nowMinutes: at(17, 30) }), false);
  assert.strictEqual(show({ lastDirection: 'OUT', nowMinutes: at(9) }), false);
});

test('an unknown schedule keeps the clock-out reachable', () => {
  // No work schedule attached, or a rest day. Hiding the quickest way to clock
  // out on the strength of a missing record would cause the very problem this
  // card exists to prevent.
  assert.strictEqual(show({ lastDirection: 'IN', scheduledTimeOut: null, nowMinutes: at(11) }), true);
  assert.strictEqual(show({ lastDirection: 'IN', scheduledTimeOut: 'garbage', nowMinutes: at(11) }), true);
});

test('an early finish moves the window with it', () => {
  // A half-day ending at noon opens the window at 11:00, not 16:00.
  assert.strictEqual(show({ lastDirection: 'IN', scheduledTimeOut: '12:00:00', nowMinutes: at(10, 59) }), false);
  assert.strictEqual(show({ lastDirection: 'IN', scheduledTimeOut: '12:00:00', nowMinutes: at(11) }), true);
});

test('it is hidden entirely without the punch permission', () => {
  assert.strictEqual(show({ canPunch: false, lastDirection: null }), false);
  assert.strictEqual(show({ canPunch: false, lastDirection: 'IN', nowMinutes: at(16, 30) }), false);
});

test('it waits for state rather than flashing the wrong action', () => {
  assert.strictEqual(show({ hasState: false, lastDirection: null }), false);
});

test('standard Mon-Sat 7am-5pm schedule visibility window', () => {
  // Before clock-in: visible
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: null, nowMinutes: at(6, 45) }), true);
  // Clocked in during workday: hidden
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'IN', nowMinutes: at(8) }), false);
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'IN', nowMinutes: at(12) }), false);
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'IN', nowMinutes: at(15, 59) }), false);
  // 1 hour before scheduled end (16:00): returns
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'IN', nowMinutes: at(16) }), true);
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'IN', nowMinutes: at(17) }), true);
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'IN', nowMinutes: at(18) }), true);
  // After clock-out: hidden
  assert.strictEqual(show({ scheduledTimeOut: '17:00:00', lastDirection: 'OUT', nowMinutes: at(17, 5) }), false);
});

test('standard Sunday 7am-3pm schedule visibility window', () => {
  // Before clock-in: visible
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: null, nowMinutes: at(6, 50) }), true);
  // Clocked in during workday: hidden
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'IN', nowMinutes: at(8) }), false);
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'IN', nowMinutes: at(12) }), false);
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'IN', nowMinutes: at(13, 59) }), false);
  // 1 hour before scheduled end (14:00): returns
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'IN', nowMinutes: at(14) }), true);
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'IN', nowMinutes: at(15) }), true);
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'IN', nowMinutes: at(16) }), true);
  // After clock-out: hidden
  assert.strictEqual(show({ scheduledTimeOut: '15:00:00', lastDirection: 'OUT', nowMinutes: at(15, 10) }), false);
});

test('the scheduled end is shown in a readable form', () => {
  assert.strictEqual(formatScheduledEnd('17:00:00'), '5:00 PM');
  assert.strictEqual(formatScheduledEnd('15:00:00'), '3:00 PM');
  assert.strictEqual(formatScheduledEnd('08:30:00'), '8:30 AM');
  assert.strictEqual(formatScheduledEnd('12:00:00'), '12:00 PM');
  assert.strictEqual(formatScheduledEnd('00:15:00'), '12:15 AM');
  // Nothing is shown rather than a guessed time.
  assert.strictEqual(formatScheduledEnd(null), null);
});
