/**
 * Движок матчинга: факты о площадке + требования профиля → вердикт и разбор.
 *
 * Главное правило: «нет данных» никогда не выдаётся за «недоступно».
 * Смешать эти состояния — значит отсечь места, которые на самом деле
 * подходят, и потерять доверие к сервису.
 */

import { FEATURES, type FeatureKey } from './features.js';
import type { Requirement, RequirementLevel } from './profile.js';
import { isReliable, isWeaker, trustOf, type Fact, type TrustLevel } from './trust.js';

export type Verdict = 'fits' | 'partial' | 'unfit' | 'unknown';

export type LineStatus = 'ok' | 'warn' | 'bad' | 'unknown';

export interface MatchLine {
  key: FeatureKey;
  label: string;
  status: LineStatus;
  level: RequirementLevel;
  note?: string | null;
  trust: TrustLevel;
  /** Факт подтверждает требование, но держится на одиночном отчёте. */
  weak: boolean;
  /** Исходный факт — нужен, чтобы подписать карточку источником и датой. */
  fact?: Fact;
}

export interface MatchResult {
  verdict: Verdict;
  lines: MatchLine[];
  /** Самый слабый уровень доверия среди критичных и важных фактов. */
  trust: TrustLevel;
}

export type FactMap = Partial<Record<FeatureKey, Fact>>;

function lineFor(req: Requirement, fact: Fact | undefined): MatchLine {
  const trust = trustOf(fact);
  const label = FEATURES[req.key].label;
  const base = { key: req.key, label, level: req.level, note: fact?.note ?? null, trust, fact };

  if (!fact || fact.value === 'unknown' || trust === 'disputed' || trust === 'none') {
    return { ...base, status: 'unknown', weak: false };
  }

  switch (fact.value) {
    case 'yes':
      return { ...base, status: 'ok', weak: !isReliable(trust) };
    case 'partial':
      return { ...base, status: 'warn', weak: !isReliable(trust) };
    case 'no':
      return { ...base, status: 'bad', weak: false };
  }
}

export function evaluate(requirements: Requirement[], facts: FactMap): MatchResult {
  const lines = requirements.map((req) => lineFor(req, facts[req.key]));

  const critical = lines.filter((l) => l.level === 'critical');
  const important = lines.filter((l) => l.level === 'important');

  const relevant = [...critical, ...important];
  const trust = weakestOf(relevant);

  const verdict = decide(critical, important);

  return { verdict, lines, trust };
}

function decide(critical: MatchLine[], important: MatchLine[]): Verdict {
  if (critical.some((l) => l.status === 'bad')) return 'unfit';
  if (critical.some((l) => l.status === 'unknown')) return 'unknown';

  // Критичное требование, подтверждённое единственным отчётом посетителя,
  // не даёт зелёный вердикт — показываем с оговоркой.
  if (critical.some((l) => l.weak || l.status === 'warn')) return 'partial';

  if (important.some((l) => l.status !== 'ok' || l.weak)) return 'partial';

  return 'fits';
}

function weakestOf(lines: MatchLine[]): TrustLevel {
  let worst: TrustLevel = 'verified';
  for (const line of lines) {
    if (isWeaker(line.trust, worst)) worst = line.trust;
  }
  return worst;
}

/** Порядок показа: сначала подходящие, потом частично, потом без данных. */
export const VERDICT_ORDER: Record<Verdict, number> = {
  fits: 0,
  partial: 1,
  unknown: 2,
  unfit: 3,
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  fits: 'Подходит',
  partial: 'Подходит частично',
  unknown: 'Нет данных',
  unfit: 'Не подходит',
};

export const STATUS_ICON: Record<LineStatus, string> = {
  ok: '✅',
  warn: '⚠️',
  bad: '❌',
  unknown: '❓',
};
