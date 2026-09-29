/**
 * Подбор событий под профиль.
 *
 * Событие наследует признаки площадки; переопределения события (например,
 * экскурсия с тифлокомментированием) перекрывают наследованное.
 */

import { evaluate, VERDICT_ORDER, type FactMap, type MatchResult, type Verdict } from '../domain/matching.js';
import { requirementsFor, type Situation } from '../domain/profile.js';
import {
  eventsBetween,
  factsForVenues,
  lastSyncAt,
  overridesForEvents,
  type EventRow,
  type UserRow,
} from '../data/repos.js';
import { periodRange, type Period } from './time.js';

export interface Recommendation {
  event: EventRow;
  match: MatchResult;
}

export interface RecommendResult {
  buckets: Record<Verdict, Recommendation[]>;
  total: number;
  lastSync: Date | null;
}

export interface RecommendFilter {
  category?: string | null;
  freeOnly?: boolean;
}

/** Ситуации пользователя: личные либо объединённые по компании. */
export function situationsOf(user: Pick<UserRow, 'situations' | 'groupProfile'>): Situation[] {
  if (user.groupProfile?.length) {
    return [...new Set(user.groupProfile.flat())];
  }
  return user.situations ?? [];
}

export async function recommend(
  user: UserRow,
  cityId: number,
  period: Period,
  tz: string,
  filter: RecommendFilter = {},
): Promise<RecommendResult> {
  const { from, to } = periodRange(period, tz);
  const requirements = requirementsFor(situationsOf(user));

  const events = dedupe(await eventsBetween(cityId, from, to, filter));

  const venueIds = [...new Set(events.map((e) => e.venueId).filter((id): id is number => id != null))];
  const [facts, overrides] = await Promise.all([
    factsForVenues(venueIds),
    overridesForEvents(events.map((e) => e.id)),
  ]);

  const buckets: Record<Verdict, Recommendation[]> = { fits: [], partial: [], unknown: [], unfit: [] };

  for (const event of events) {
    const venueFacts: FactMap = event.venueId ? (facts.get(event.venueId) ?? {}) : {};
    const eventFacts: FactMap = overrides.get(event.id) ?? {};
    const merged: FactMap = { ...venueFacts, ...eventFacts };

    const match = evaluate(requirements, merged);
    buckets[match.verdict].push({ event, match });
  }

  for (const list of Object.values(buckets)) {
    list.sort((a, b) => a.event.startsAt.getTime() - b.event.startsAt.getTime());
  }

  return { buckets, total: events.length, lastSync: await lastSyncAt() };
}

/** Одно событие может идти несколькими показами — в выдаче оно нужно один раз. */
function dedupe(events: EventRow[]): EventRow[] {
  const byKey = new Map<string, EventRow>();
  for (const event of events) {
    const key = `${event.title}|${event.venueId ?? 'no-venue'}`;
    const existing = byKey.get(key);
    if (!existing || event.startsAt < existing.startsAt) byKey.set(key, event);
  }
  return [...byKey.values()];
}

export const VERDICT_SEQUENCE: Verdict[] = (['fits', 'partial', 'unknown', 'unfit'] as Verdict[]).sort(
  (a, b) => VERDICT_ORDER[a] - VERDICT_ORDER[b],
);

/** Сколько событий подходит — для проактивной сводки. */
export function countSuitable(result: RecommendResult): number {
  return result.buckets.fits.length + result.buckets.partial.length;
}
