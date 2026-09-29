/**
 * Вклад посетителей: добавление и подтверждение фактов.
 *
 * Одна и та же запись голоса обслуживает обе механики — подтверждение уже
 * известного факта и заполнение пустого. Разница только в том, что мы
 * спрашиваем.
 */

import { FEATURES, VISITOR_ASKABLE, type FeatureKey, type FeatureValue } from '../domain/features.js';
import { criticalKeys, type Situation } from '../domain/profile.js';
import { trustOf, type Fact } from '../domain/trust.js';
import {
  applyTally,
  factsForVenue,
  recordVote,
  voteTally,
  type Venue,
} from '../data/repos.js';

/** Сколько фактов спрашиваем после посещения. Третий — только по кнопке. */
export const ASK_AFTER_EVENT = 2;

export interface Question {
  key: FeatureKey;
  text: string;
  /** Что означает ответ «Да» для значения признака. */
  yesMeans: FeatureValue;
  noMeans: FeatureValue;
}

export function questionFor(key: FeatureKey): Question | null {
  const visitor = FEATURES[key].visitor;
  if (!visitor) return null;
  return { key, text: visitor.question, yesMeans: visitor.yesMeans, noMeans: visitor.noMeans };
}

/** Чек-лист для контрибьютора: только то, что человек может заметить сам. */
export function checklist(): Question[] {
  return VISITOR_ASKABLE.map(questionFor).filter((q): q is Question => q !== null);
}

/**
 * Что спросить у человека после события.
 *
 * Спрашиваем критичное для его профиля — то, что он действительно проверял
 * на себе, — и только то, что вообще можно спросить без терминов.
 */
export async function questionsAfterEvent(
  venueId: number,
  situations: Situation[],
  limit = ASK_AFTER_EVENT,
): Promise<Question[]> {
  const facts = await factsForVenue(venueId);
  const critical = criticalKeys(situations);
  const askable = critical.length > 0 ? critical : VISITOR_ASKABLE;

  const ranked = askable
    .filter((key) => FEATURES[key].visitor)
    .sort((a, b) => priority(facts[a]) - priority(facts[b]));

  return ranked.slice(0, limit).map(questionFor).filter((q): q is Question => q !== null);
}

/** Сначала спрашиваем то, где данных меньше всего. */
function priority(fact: Fact | undefined): number {
  const order = { none: 0, disputed: 1, single: 2, demo: 3, stated: 4, confirmed: 5, verified: 6 };
  return order[trustOf(fact)];
}

/**
 * Записывает голос и пересчитывает агрегат факта.
 *
 * Проверенные данные (наши и партнёрские) голосами не переписываются —
 * расхождение лишь помечает факт оспоренным и отправляет на перепроверку.
 * Демонстрационные и пользовательские данные голоса перекрывают.
 */
export async function submitAnswer(input: {
  maxUserId: number;
  venueId: number;
  key: FeatureKey;
  answer: 'yes' | 'no';
}): Promise<void> {
  await recordVote(input);

  const tally = await voteTally(input.venueId, input.key);
  const question = questionFor(input.key);
  if (!question) return;

  const facts = await factsForVenue(input.venueId);
  const existing = facts[input.key];

  const valueFromVotes: FeatureValue =
    tally.yes === tally.no
      ? (existing?.value ?? 'unknown')
      : tally.yes > tally.no
        ? question.yesMeans
        : question.noMeans;

  const trusted = existing && (existing.source === 'manual' || existing.source === 'partner');
  const value = trusted ? existing.value : valueFromVotes;

  const supporting = value === question.yesMeans ? tally.yes : tally.no;
  const opposing = value === question.yesMeans ? tally.no : tally.yes;

  await applyTally({
    venueId: input.venueId,
    key: input.key,
    value,
    source: trusted ? existing.source : 'user',
    agree: supporting,
    disagree: opposing,
    checkedAt: tally.lastAt ?? existing?.checkedAt ?? new Date(),
  });
}

export function venueLine(venue: Venue): string {
  return venue.address ? `${venue.name} — ${venue.address}` : venue.name;
}
