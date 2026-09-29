/**
 * Репозитории: единственное место, которое знает про SQL.
 * Домен и сервисы работают с типами, а не с таблицами.
 */

import type { FeatureKey, FeatureValue } from '../domain/features.js';
import type { Situation } from '../domain/profile.js';
import type { Fact, FactSource } from '../domain/trust.js';
import { db } from './db.js';

export interface City {
  id: number;
  slug: string;
  name: string;
  tz: string;
}

export interface Venue {
  id: number;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  status: 'mapped' | 'unmapped';
}

export interface EventRow {
  id: number;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  isPermanent: boolean;
  price: string | null;
  isFree: boolean;
  category: string | null;
  sourceUrl: string;
  venueId: number | null;
  venueName: string | null;
  venueAddress: string | null;
  lat: number | null;
  lon: number | null;
}

export interface UserRow {
  maxUserId: number;
  name: string | null;
  cityId: number | null;
  situations: Situation[];
  groupProfile: Situation[][] | null;
  digestOptin: boolean;
}

export interface SessionRow {
  scene: string | null;
  step: number;
  payload: Record<string, unknown>;
}

// ---------- города ----------

export async function ensureCity(slug: string, name: string, tz: string): Promise<City> {
  const [row] = await db()<City[]>`
    INSERT INTO cities (slug, name, tz) VALUES (${slug}, ${name}, ${tz})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, tz = EXCLUDED.tz
    RETURNING id, slug, name, tz
  `;
  return row!;
}

// ---------- площадки ----------

export async function upsertVenue(input: {
  cityId: number;
  name: string;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
  kudagoPlaceId?: number | null;
  status?: 'mapped' | 'unmapped';
}): Promise<number> {
  const status = input.status ?? 'unmapped';
  if (input.kudagoPlaceId != null) {
    const [row] = await db()<{ id: number }[]>`
      INSERT INTO venues (city_id, name, address, lat, lon, kudago_place_id, status)
      VALUES (${input.cityId}, ${input.name}, ${input.address ?? null}, ${input.lat ?? null},
              ${input.lon ?? null}, ${input.kudagoPlaceId}, ${status})
      ON CONFLICT (kudago_place_id) DO UPDATE
        SET name = EXCLUDED.name,
            address = COALESCE(EXCLUDED.address, venues.address),
            lat = COALESCE(EXCLUDED.lat, venues.lat),
            lon = COALESCE(EXCLUDED.lon, venues.lon)
      RETURNING id
    `;
    return row!.id;
  }
  const [row] = await db()<{ id: number }[]>`
    INSERT INTO venues (city_id, name, address, lat, lon, status)
    VALUES (${input.cityId}, ${input.name}, ${input.address ?? null},
            ${input.lat ?? null}, ${input.lon ?? null}, ${status})
    RETURNING id
  `;
  return row!.id;
}

export async function findVenueByName(cityId: number, query: string): Promise<Venue[]> {
  return db()<Venue[]>`
    SELECT id, name, address, lat, lon, status
    FROM venues
    WHERE city_id = ${cityId} AND name ILIKE ${'%' + query + '%'}
    ORDER BY status DESC, name
    LIMIT 8
  `;
}

export async function getVenue(id: number): Promise<Venue | undefined> {
  const [row] = await db()<Venue[]>`
    SELECT id, name, address, lat, lon, status FROM venues WHERE id = ${id}
  `;
  return row;
}

/** Площадки, по которым меньше всего данных — очередь заданий для контрибьюторов. */
export async function venuesNeedingData(cityId: number, limit = 8): Promise<Venue[]> {
  return db()<Venue[]>`
    SELECT v.id, v.name, v.address, v.lat, v.lon, v.status
    FROM venues v
    LEFT JOIN venue_features f ON f.venue_id = v.id AND f.value <> 'unknown'
    WHERE v.city_id = ${cityId}
    GROUP BY v.id
    ORDER BY COUNT(f.key) ASC, v.name
    LIMIT ${limit}
  `;
}

export async function nearestVenues(
  cityId: number,
  lat: number,
  lon: number,
  limit = 5,
): Promise<Venue[]> {
  return db()<Venue[]>`
    SELECT id, name, address, lat, lon, status
    FROM venues
    WHERE city_id = ${cityId} AND lat IS NOT NULL AND lon IS NOT NULL
    ORDER BY (lat - ${lat}) ^ 2 + (lon - ${lon}) ^ 2
    LIMIT ${limit}
  `;
}

// ---------- факты ----------

interface FeatureRow {
  venue_id: number;
  key: string;
  value: FeatureValue;
  note: string | null;
  source: FactSource;
  agree: number;
  disagree: number;
  checked_at: Date | null;
}

function toFact(row: FeatureRow): Fact {
  return {
    value: row.value,
    note: row.note,
    source: row.source,
    agree: row.agree,
    disagree: row.disagree,
    checkedAt: row.checked_at,
  };
}

export async function factsForVenues(
  venueIds: number[],
): Promise<Map<number, Partial<Record<FeatureKey, Fact>>>> {
  const result = new Map<number, Partial<Record<FeatureKey, Fact>>>();
  if (venueIds.length === 0) return result;

  const rows = await db()<FeatureRow[]>`
    SELECT venue_id, key, value, note, source, agree, disagree, checked_at
    FROM venue_features WHERE venue_id = ANY(${venueIds})
  `;

  for (const row of rows) {
    const bucket = result.get(row.venue_id) ?? {};
    bucket[row.key as FeatureKey] = toFact(row);
    result.set(row.venue_id, bucket);
  }
  return result;
}

export async function factsForVenue(
  venueId: number,
): Promise<Partial<Record<FeatureKey, Fact>>> {
  return (await factsForVenues([venueId])).get(venueId) ?? {};
}

export async function overridesForEvents(
  eventIds: number[],
): Promise<Map<number, Partial<Record<FeatureKey, Fact>>>> {
  const result = new Map<number, Partial<Record<FeatureKey, Fact>>>();
  if (eventIds.length === 0) return result;

  const rows = await db()<
    { event_id: number; key: string; value: FeatureValue; note: string | null }[]
  >`SELECT event_id, key, value, note FROM event_overrides WHERE event_id = ANY(${eventIds})`;

  for (const row of rows) {
    const bucket = result.get(row.event_id) ?? {};
    bucket[row.key as FeatureKey] = {
      value: row.value,
      note: row.note,
      source: 'manual',
      agree: 0,
      disagree: 0,
      checkedAt: new Date(),
    };
    result.set(row.event_id, bucket);
  }
  return result;
}

export async function setFeature(input: {
  venueId: number;
  key: FeatureKey;
  value: FeatureValue;
  note?: string | null;
  source: FactSource;
  checkedAt?: Date;
}): Promise<void> {
  await db()`
    INSERT INTO venue_features (venue_id, key, value, note, source, checked_at)
    VALUES (${input.venueId}, ${input.key}, ${input.value}, ${input.note ?? null},
            ${input.source}, ${input.checkedAt ?? new Date()})
    ON CONFLICT (venue_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          note = COALESCE(EXCLUDED.note, venue_features.note),
          source = EXCLUDED.source,
          checked_at = EXCLUDED.checked_at
  `;
}

// ---------- события ----------

export async function upsertEvent(input: {
  cityId: number;
  venueId: number | null;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  price: string | null;
  isFree: boolean;
  category: string | null;
  sourceUrl: string;
  externalId: string;
  isPermanent: boolean;
}): Promise<void> {
  await db()`
    INSERT INTO events (city_id, venue_id, title, starts_at, ends_at, price, is_free,
                        category, source, source_url, external_id, is_permanent, synced_at)
    VALUES (${input.cityId}, ${input.venueId}, ${input.title}, ${input.startsAt},
            ${input.endsAt}, ${input.price}, ${input.isFree}, ${input.category},
            'kudago', ${input.sourceUrl}, ${input.externalId}, ${input.isPermanent}, now())
    ON CONFLICT (source, external_id, starts_at) DO UPDATE
      SET title = EXCLUDED.title,
          venue_id = COALESCE(EXCLUDED.venue_id, events.venue_id),
          ends_at = EXCLUDED.ends_at,
          price = EXCLUDED.price,
          is_free = EXCLUDED.is_free,
          category = EXCLUDED.category,
          is_permanent = EXCLUDED.is_permanent,
          synced_at = now()
  `;
}

export async function eventsBetween(
  cityId: number,
  from: Date,
  to: Date,
  filter: { category?: string | null; freeOnly?: boolean } = {},
): Promise<EventRow[]> {
  const sql = db();
  const rows = await sql<
    {
      id: number;
      title: string;
      starts_at: Date;
      ends_at: Date | null;
      is_permanent: boolean;
      price: string | null;
      is_free: boolean;
      category: string | null;
      source_url: string;
      venue_id: number | null;
      venue_name: string | null;
      venue_address: string | null;
      lat: number | null;
      lon: number | null;
    }[]
  >`
    SELECT e.id, e.title, e.starts_at, e.ends_at, e.is_permanent, e.price, e.is_free,
           e.category, e.source_url,
           e.venue_id, v.name AS venue_name, v.address AS venue_address, v.lat, v.lon
    FROM events e
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.city_id = ${cityId}
      -- пересечение интервалов, а не дата начала: постоянные экспозиции
      -- начались в прошлом, но идут и в запрошенные выходные
      AND e.starts_at < ${to}
      AND (e.ends_at IS NULL OR e.ends_at > ${from})
      ${filter.category ? sql`AND e.category = ${filter.category}` : sql``}
      ${filter.freeOnly ? sql`AND e.is_free = true` : sql``}
    ORDER BY e.is_permanent, e.starts_at
    LIMIT 200
  `;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    isPermanent: r.is_permanent,
    price: r.price,
    isFree: r.is_free,
    category: r.category,
    sourceUrl: r.source_url,
    venueId: r.venue_id,
    venueName: r.venue_name,
    venueAddress: r.venue_address,
    lat: r.lat,
    lon: r.lon,
  }));
}

export async function getEvent(id: number): Promise<EventRow | undefined> {
  const rows = await eventsByIds([id]);
  return rows[0];
}

export async function eventsByIds(ids: number[]): Promise<EventRow[]> {
  if (ids.length === 0) return [];
  const rows = await db()<
    {
      id: number;
      title: string;
      starts_at: Date;
      ends_at: Date | null;
      is_permanent: boolean;
      price: string | null;
      is_free: boolean;
      category: string | null;
      source_url: string;
      venue_id: number | null;
      venue_name: string | null;
      venue_address: string | null;
      lat: number | null;
      lon: number | null;
    }[]
  >`
    SELECT e.id, e.title, e.starts_at, e.ends_at, e.is_permanent, e.price, e.is_free,
           e.category, e.source_url,
           e.venue_id, v.name AS venue_name, v.address AS venue_address, v.lat, v.lon
    FROM events e LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.id = ANY(${ids})
  `;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    isPermanent: r.is_permanent,
    price: r.price,
    isFree: r.is_free,
    category: r.category,
    sourceUrl: r.source_url,
    venueId: r.venue_id,
    venueName: r.venue_name,
    venueAddress: r.venue_address,
    lat: r.lat,
    lon: r.lon,
  }));
}

export async function categoriesInUse(cityId: number, from: Date): Promise<string[]> {
  const rows = await db()<{ category: string }[]>`
    SELECT DISTINCT category FROM events
    WHERE city_id = ${cityId} AND category IS NOT NULL
      AND (ends_at IS NULL OR ends_at > ${from})
    ORDER BY category LIMIT 12
  `;
  return rows.map((r) => r.category);
}

export async function lastSyncAt(): Promise<Date | null> {
  const [row] = await db()<{ synced_at: Date | null }[]>`
    SELECT MAX(synced_at) AS synced_at FROM events
  `;
  return row?.synced_at ?? null;
}

// ---------- пользователи и сессии ----------

export async function ensureUser(maxUserId: number, name: string | null, cityId: number): Promise<UserRow> {
  const [row] = await db()<
    {
      max_user_id: string | number;
      name: string | null;
      city_id: number | null;
      situations: Situation[];
      group_profile: Situation[][] | null;
      digest_optin: boolean;
    }[]
  >`
    INSERT INTO users (max_user_id, name, city_id)
    VALUES (${maxUserId}, ${name}, ${cityId})
    ON CONFLICT (max_user_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)
    RETURNING max_user_id, name, city_id, situations, group_profile, digest_optin
  `;
  return {
    maxUserId: Number(row!.max_user_id),
    name: row!.name,
    cityId: row!.city_id,
    situations: row!.situations ?? [],
    groupProfile: row!.group_profile,
    digestOptin: row!.digest_optin,
  };
}

export async function saveSituations(maxUserId: number, situations: Situation[]): Promise<void> {
  await db()`
    UPDATE users SET situations = ${db().json(situations as never)}::jsonb,
                     group_profile = NULL,
                     updated_at = now()
    WHERE max_user_id = ${maxUserId}
  `;
}

export async function saveGroupProfile(maxUserId: number, group: Situation[][]): Promise<void> {
  await db()`
    UPDATE users SET group_profile = ${db().json(group as never)}::jsonb, updated_at = now()
    WHERE max_user_id = ${maxUserId}
  `;
}

export async function setDigestOptin(maxUserId: number, value: boolean): Promise<void> {
  await db()`UPDATE users SET digest_optin = ${value} WHERE max_user_id = ${maxUserId}`;
}

export async function usersForDigest(cityId: number): Promise<UserRow[]> {
  const rows = await db()<
    {
      max_user_id: string | number;
      name: string | null;
      city_id: number | null;
      situations: Situation[];
      group_profile: Situation[][] | null;
      digest_optin: boolean;
    }[]
  >`
    SELECT max_user_id, name, city_id, situations, group_profile, digest_optin
    FROM users
    WHERE city_id = ${cityId} AND digest_optin = true
      AND (jsonb_array_length(situations) > 0 OR group_profile IS NOT NULL)
  `;
  return rows.map((r) => ({
    maxUserId: Number(r.max_user_id),
    name: r.name,
    cityId: r.city_id,
    situations: r.situations ?? [],
    groupProfile: r.group_profile,
    digestOptin: r.digest_optin,
  }));
}

export async function getSession(maxUserId: number): Promise<SessionRow> {
  const [row] = await db()<{ scene: string | null; step: number; payload: Record<string, unknown> }[]>`
    SELECT scene, step, payload FROM user_sessions WHERE max_user_id = ${maxUserId}
  `;
  return row ?? { scene: null, step: 0, payload: {} };
}

export async function saveSession(maxUserId: number, session: SessionRow): Promise<void> {
  await db()`
    INSERT INTO user_sessions (max_user_id, scene, step, payload, updated_at)
    VALUES (${maxUserId}, ${session.scene}, ${session.step}, ${db().json(session.payload as never)}::jsonb, now())
    ON CONFLICT (max_user_id) DO UPDATE
      SET scene = EXCLUDED.scene, step = EXCLUDED.step,
          payload = EXCLUDED.payload, updated_at = now()
  `;
}

export async function clearSession(maxUserId: number): Promise<void> {
  await db()`DELETE FROM user_sessions WHERE max_user_id = ${maxUserId}`;
}

// ---------- голоса, посещения, фото ----------

export async function recordVote(input: {
  maxUserId: number;
  venueId: number;
  key: FeatureKey;
  answer: 'yes' | 'no';
}): Promise<void> {
  await db()`
    INSERT INTO verifications (max_user_id, venue_id, key, answer, created_at)
    VALUES (${input.maxUserId}, ${input.venueId}, ${input.key}, ${input.answer}, now())
    ON CONFLICT (max_user_id, venue_id, key) DO UPDATE
      SET answer = EXCLUDED.answer, created_at = now()
  `;
}

export async function voteTally(
  venueId: number,
  key: FeatureKey,
): Promise<{ yes: number; no: number; lastAt: Date | null }> {
  const [row] = await db()<{ yes: string; no: string; last_at: Date | null }[]>`
    SELECT
      COUNT(*) FILTER (WHERE answer = 'yes') AS yes,
      COUNT(*) FILTER (WHERE answer = 'no') AS no,
      MAX(created_at) AS last_at
    FROM verifications WHERE venue_id = ${venueId} AND key = ${key}
  `;
  return { yes: Number(row?.yes ?? 0), no: Number(row?.no ?? 0), lastAt: row?.last_at ?? null };
}

export async function applyTally(input: {
  venueId: number;
  key: FeatureKey;
  value: FeatureValue;
  source: FactSource;
  agree: number;
  disagree: number;
  checkedAt: Date | null;
}): Promise<void> {
  await db()`
    INSERT INTO venue_features (venue_id, key, value, source, agree, disagree, checked_at)
    VALUES (${input.venueId}, ${input.key}, ${input.value}, ${input.source},
            ${input.agree}, ${input.disagree}, ${input.checkedAt})
    ON CONFLICT (venue_id, key) DO UPDATE
      SET value = EXCLUDED.value, source = EXCLUDED.source,
          agree = EXCLUDED.agree, disagree = EXCLUDED.disagree,
          checked_at = EXCLUDED.checked_at
  `;
}

export async function markAttendance(maxUserId: number, eventId: number): Promise<void> {
  await db()`
    INSERT INTO attendance (max_user_id, event_id) VALUES (${maxUserId}, ${eventId})
    ON CONFLICT DO NOTHING
  `;
}

export async function pendingAskAfterEvent(
  now: Date,
): Promise<{ maxUserId: number; eventId: number; venueId: number | null }[]> {
  const rows = await db()<
    { max_user_id: string | number; event_id: number; venue_id: number | null }[]
  >`
    SELECT a.max_user_id, a.event_id, e.venue_id
    FROM attendance a JOIN events e ON e.id = a.event_id
    WHERE a.asked_at IS NULL AND e.starts_at < ${now} AND e.venue_id IS NOT NULL
    LIMIT 50
  `;
  return rows.map((r) => ({
    maxUserId: Number(r.max_user_id),
    eventId: r.event_id,
    venueId: r.venue_id,
  }));
}

export async function markAsked(maxUserId: number, eventId: number): Promise<void> {
  await db()`
    UPDATE attendance SET asked_at = now()
    WHERE max_user_id = ${maxUserId} AND event_id = ${eventId}
  `;
}

export async function savePhoto(input: {
  venueId: number;
  maxUserId: number;
  url: string;
}): Promise<void> {
  await db()`
    INSERT INTO venue_photos (venue_id, max_user_id, url) 
    VALUES (${input.venueId}, ${input.maxUserId}, ${input.url})
  `;
}

export async function photosFor(venueId: number, limit = 1): Promise<string[]> {
  const rows = await db()<{ url: string }[]>`
    SELECT url FROM venue_photos WHERE venue_id = ${venueId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => r.url);
}

export async function contributionCount(maxUserId: number): Promise<number> {
  const [row] = await db()<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM verifications WHERE max_user_id = ${maxUserId}
  `;
  return Number(row?.count ?? 0);
}
