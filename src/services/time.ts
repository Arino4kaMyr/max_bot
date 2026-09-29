/** Работа с датами в часовом поясе города, без внешних зависимостей. */

export type Period = 'today' | 'weekend' | 'week';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Сегодня',
  weekend: 'На выходных',
  week: 'На неделе',
};

/** Смещение часового пояса относительно UTC в минутах для конкретного момента. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Локальная календарная дата в городе. */
export function zonedDateParts(date: Date, tz: string): { y: number; m: number; d: number; weekday: number } {
  const offset = tzOffsetMinutes(date, tz);
  const shifted = new Date(date.getTime() + offset * 60_000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** Полночь местного дня, смещённого на `addDays`, в абсолютном времени. */
export function startOfDay(date: Date, tz: string, addDays = 0): Date {
  const { y, m, d } = zonedDateParts(date, tz);
  const naive = Date.UTC(y, m, d + addDays, 0, 0, 0);
  const guess = new Date(naive - tzOffsetMinutes(date, tz) * 60_000);
  // Повторное уточнение на случай перехода на летнее время в этот день.
  return new Date(naive - tzOffsetMinutes(guess, tz) * 60_000);
}

/**
 * Границы периода.
 *
 * «На выходных» — ближайшие суббота и воскресенье; если сегодня уже выходной,
 * имеются в виду текущие, а не следующие.
 */
export function periodRange(period: Period, tz: string, now = new Date()): { from: Date; to: Date } {
  const { weekday } = zonedDateParts(now, tz);

  switch (period) {
    case 'today':
      return { from: now, to: startOfDay(now, tz, 1) };

    case 'week':
      return { from: now, to: startOfDay(now, tz, 7) };

    case 'weekend': {
      // 0 — воскресенье, 6 — суббота
      const toSaturday = weekday === 0 ? 0 : 6 - weekday;
      const from = weekday === 0 || weekday === 6 ? now : startOfDay(now, tz, toSaturday);
      const endOffset = weekday === 0 ? 1 : toSaturday + 2;
      return { from, to: startOfDay(now, tz, endOffset) };
    }
  }
}

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatEventDate(date: Date, tz: string, permanent: boolean): string {
  if (permanent) return 'Идёт сейчас, можно прийти в любой день';
  return DATE_TIME.format(new Date(date)).replace(',', ',').replace(' г.', '') + ` (${shortTz(tz)})`;
}

function shortTz(tz: string): string {
  return tz.split('/').pop()?.replace('_', ' ') ?? tz;
}
