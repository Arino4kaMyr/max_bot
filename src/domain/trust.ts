/**
 * Уровень доверия к факту.
 *
 * Происхождение данных всегда видно пользователю: он должен понимать,
 * проверяли это мы, сказал один посетитель или данные расходятся.
 */

import type { FeatureValue } from './features.js';

/**
 * Откуда взялся факт.
 *  manual/partner — проверено нами или партнёрской организацией;
 *  venue_site     — заявлено самой площадкой (официально, но не проверено на месте);
 *  demo           — предзаполненный демонстрационный набор, подлежит полевой проверке;
 *  user           — отчёт посетителя через бота.
 */
export type FactSource = 'manual' | 'partner' | 'venue_site' | 'demo' | 'user';

export interface Fact {
  value: FeatureValue;
  note?: string | null;
  source: FactSource;
  agree: number;
  disagree: number;
  checkedAt: Date | null;
}

export type TrustLevel =
  | 'verified'
  | 'confirmed'
  | 'stated'
  | 'demo'
  | 'single'
  | 'disputed'
  | 'none';

/** От самого слабого к самому надёжному. */
const TRUST_ORDER: TrustLevel[] = [
  'none',
  'disputed',
  'single',
  'demo',
  'stated',
  'confirmed',
  'verified',
];

export function trustOf(fact: Fact | undefined): TrustLevel {
  if (!fact || fact.value === 'unknown') return 'none';
  if (fact.disagree > 0) return 'disputed';
  if (fact.source === 'manual' || fact.source === 'partner') return 'verified';
  if (fact.source === 'venue_site') return 'stated';
  if (fact.source === 'demo') return 'demo';
  return fact.agree >= 2 ? 'confirmed' : 'single';
}

/**
 * Достаточно ли факта, чтобы на нём строить зелёный вердикт.
 *
 * Одиночный отчёт от посетителя — нет. Цена ошибки несимметрична:
 * сервис, один раз отправивший человека к лестнице, больше не откроют.
 */
export function isReliable(trust: TrustLevel): boolean {
  return trust === 'verified' || trust === 'confirmed' || trust === 'stated' || trust === 'demo';
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function formatCheckedAt(date: Date | null): string {
  return date ? DATE_FMT.format(date) : '';
}

/** Подпись под карточкой: откуда данные и когда проверены. */
export function trustLabel(fact: Fact | undefined): string {
  const trust = trustOf(fact);
  if (!fact || trust === 'none') return 'Нет данных';

  const when = formatCheckedAt(fact.checkedAt);
  const suffix = when ? ` · ${when}` : '';

  switch (trust) {
    case 'verified':
      return `Проверено командой${suffix}`;
    case 'stated':
      return `По информации площадки${suffix}`;
    case 'demo':
      return 'Демонстрационные данные — требуют проверки на месте';
    case 'confirmed':
      return `Подтвердили ${fact.agree} ${plural(fact.agree)}${suffix}`;
    case 'single':
      return 'Со слов одного посетителя — уточните на месте';
    case 'disputed':
      return 'Данные расходятся, нужна проверка';
  }
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'посетитель';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'посетителя';
  return 'посетителей';
}

/** Самая слабая подпись среди фактов — она и идёт под карточкой события. */
export function weakestTrust(facts: (Fact | undefined)[]): TrustLevel {
  let worst: TrustLevel = 'verified';
  for (const fact of facts) {
    const trust = trustOf(fact);
    if (TRUST_ORDER.indexOf(trust) < TRUST_ORDER.indexOf(worst)) worst = trust;
  }
  return worst;
}

export function isWeaker(a: TrustLevel, b: TrustLevel): boolean {
  return TRUST_ORDER.indexOf(a) < TRUST_ORDER.indexOf(b);
}
