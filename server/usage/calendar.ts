import { instant } from './schema';

function boundary(anchor: number, offset: number): number {
  const base = new Date(anchor), year = base.getUTCFullYear(), month = base.getUTCMonth() + offset;
  const date = new Date(0);
  date.setUTCFullYear(year, month, 1);
  date.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds());
  const last = new Date(0);
  last.setUTCFullYear(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(base.getUTCDate(), last.getUTCDate()));
  return instant.parse(date.getTime());
}
export function monthlyUsageWindow(anchor: number, now: number) {
  instant.parse(anchor); instant.parse(now);
  if (now < anchor) throw new Error('A usage window cannot precede its original calendar anchor.');
  const base = new Date(anchor), date = new Date(now);
  let offset = (date.getUTCFullYear() - base.getUTCFullYear()) * 12 + date.getUTCMonth() - base.getUTCMonth();
  if (boundary(anchor, offset) > now) offset--;
  return { startsAt: boundary(anchor, offset), endsAt: boundary(anchor, offset + 1) };
}
export function utcCostWindows(now: number) {
  instant.parse(now);
  const date = new Date(now);
  const day = new Date(date); day.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(day); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const month = new Date(day); month.setUTCDate(1);
  const nextMonth = new Date(month); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  return [{ kind: 'day' as const, startsAt: day.getTime(), endsAt: instant.parse(nextDay.getTime()) },
    { kind: 'month' as const, startsAt: month.getTime(), endsAt: instant.parse(nextMonth.getTime()) }];
}
