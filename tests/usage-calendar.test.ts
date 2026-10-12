import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthlyUsageWindow, utcCostWindows } from '../server/usage/calendar';

const at = (date: string) => Date.parse(date);
test('monthly allowance boundaries always use the original UTC calendar anchor, not February or a fixed day count', () => {
  const anchor = at('2026-01-31T12:34:56.789Z');
  for (const [now, start, end] of [
    ['2026-02-28T12:34:56.788Z', '2026-01-31T12:34:56.789Z', '2026-02-28T12:34:56.789Z'],
    ['2026-02-28T12:34:56.789Z', '2026-02-28T12:34:56.789Z', '2026-03-31T12:34:56.789Z'],
    ['2026-03-31T12:34:56.789Z', '2026-03-31T12:34:56.789Z', '2026-04-30T12:34:56.789Z'],
    ['2027-02-28T12:34:56.789Z', '2027-02-28T12:34:56.789Z', '2027-03-31T12:34:56.789Z'],
  ]) assert.deepEqual(monthlyUsageWindow(anchor, at(now)), { startsAt: at(start), endsAt: at(end) });
});
test('leap-day anchors, year transitions and minimum supported dates preserve exact half-open milliseconds', () => {
  assert.deepEqual(monthlyUsageWindow(at('2024-02-29T00:00:00Z'), at('2025-02-28T00:00:00Z')),
    { startsAt: at('2025-02-28T00:00:00Z'), endsAt: at('2025-03-29T00:00:00Z') });
  assert.deepEqual(monthlyUsageWindow(at('1970-12-31T00:00:00Z'), at('1971-01-31T00:00:00Z')),
    { startsAt: at('1971-01-31T00:00:00Z'), endsAt: at('1971-02-28T00:00:00Z') });
  assert.throws(() => monthlyUsageWindow(1000, 999), /original calendar anchor/);
  for (const now of [-1, Infinity, NaN, 253402300800000]) assert.throws(() => monthlyUsageWindow(0, now));
});
test('shared cost ceilings have independent UTC day and month windows, including leap and year boundaries', () => {
  assert.deepEqual(utcCostWindows(at('2024-02-29T23:59:59.999Z')), [
    { kind: 'day', startsAt: at('2024-02-29T00:00:00Z'), endsAt: at('2024-03-01T00:00:00Z') },
    { kind: 'month', startsAt: at('2024-02-01T00:00:00Z'), endsAt: at('2024-03-01T00:00:00Z') },
  ]);
  assert.equal(utcCostWindows(at('2026-12-31T23:59:59.999Z'))[1].endsAt, at('2027-01-01T00:00:00Z'));
});
