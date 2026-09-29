import { describe, expect, it } from 'vitest';
import { periodRange, startOfDay, zonedDateParts } from '../time.js';

const TZ = 'Europe/Moscow';

describe('границы периодов', () => {
  it('«сегодня» заканчивается местной полуночью', () => {
    const now = new Date('2026-10-01T20:00:00Z'); // 23:00 в Москве
    const { to } = periodRange('today', TZ, now);
    expect(to.toISOString()).toBe('2026-10-01T21:00:00.000Z'); // 00:00 2 октября MSK
  });

  it('«на выходных» в среду — ближайшие суббота и воскресенье', () => {
    const wednesday = new Date('2026-09-30T09:00:00Z');
    expect(zonedDateParts(wednesday, TZ).weekday).toBe(3);
    const { from, to } = periodRange('weekend', TZ, wednesday);
    expect(zonedDateParts(from, TZ).weekday).toBe(6);
    expect(from.toISOString()).toBe('2026-10-02T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-04T21:00:00.000Z');
  });

  it('«на выходных» в субботу — текущие выходные, а не следующие', () => {
    const saturday = new Date('2026-10-03T09:00:00Z');
    expect(zonedDateParts(saturday, TZ).weekday).toBe(6);
    const { from, to } = periodRange('weekend', TZ, saturday);
    expect(from).toEqual(saturday);
    expect(to.toISOString()).toBe('2026-10-04T21:00:00.000Z');
  });

  it('«на выходных» в воскресенье не уводит в следующую неделю', () => {
    const sunday = new Date('2026-10-04T09:00:00Z');
    const { to } = periodRange('weekend', TZ, sunday);
    expect(to.toISOString()).toBe('2026-10-04T21:00:00.000Z');
  });

  it('местная полночь считается с учётом часового пояса', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(startOfDay(now, TZ).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });
});
