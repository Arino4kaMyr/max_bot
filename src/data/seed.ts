/**
 * Заливка справочника площадок города.
 *
 * Значения признаков помечаются источником `demo`: это предварительный набор,
 * не проверенный на месте, и бот честно подписывает его в карточке.
 * После очной проверки источник меняется на `manual` или `partner`.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFeatureKey, type FeatureValue } from '../domain/features.js';
import { connectDb, closeDb, db, migrate, waitForDb } from './db.js';
import { ensureCity, setFeature, upsertVenue } from './repos.js';

interface SeedDoc {
  city: { slug: string; name: string; tz: string };
  venues: {
    kudagoPlaceId: number;
    name: string;
    address: string | null;
    lat: number | null;
    lon: number | null;
    features: Record<string, { value: FeatureValue; note: string | null }>;
  }[];
}

export async function seedCity(file: string): Promise<{ venues: number; facts: number }> {
  const doc = JSON.parse(await readFile(file, 'utf8')) as SeedDoc;
  const city = await ensureCity(doc.city.slug, doc.city.name, doc.city.tz);

  let facts = 0;
  for (const venue of doc.venues) {
    const venueId = await upsertVenue({
      cityId: city.id,
      name: venue.name,
      address: venue.address,
      lat: venue.lat,
      lon: venue.lon,
      kudagoPlaceId: venue.kudagoPlaceId,
      status: 'mapped',
    });

    for (const [key, fact] of Object.entries(venue.features)) {
      if (!isFeatureKey(key)) {
        console.warn(`Неизвестный признак «${key}» у площадки «${venue.name}» — пропущен`);
        continue;
      }
      await setFeature({
        venueId,
        key,
        value: fact.value,
        note: fact.note,
        source: 'demo',
        checkedAt: new Date(),
      });
      facts++;
    }
  }

  return { venues: doc.venues.length, facts };
}

export function seedFileFor(citySlug: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'seed', `venues-${citySlug}.json`);
}

/** Сид пропускается, если площадки города уже заведены. */
export async function seedIfEmpty(citySlug: string): Promise<void> {
  const [row] = await db()<{ count: string }[]>`
    SELECT COUNT(*) AS count FROM venues v
    JOIN cities c ON c.id = v.city_id WHERE c.slug = ${citySlug}
  `;
  if (Number(row?.count ?? 0) > 0) return;

  const result = await seedCity(seedFileFor(citySlug));
  console.log(`Сид «${citySlug}»: площадок ${result.venues}, фактов ${result.facts}`);
}

// Запуск вручную: npm run seed
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const url = process.env.DATABASE_URL;
  const slug = process.env.CITY_SLUG ?? 'kzn';
  if (!url) throw new Error('DATABASE_URL не задан');
  const sql = connectDb(url);
  await waitForDb(sql);
  await migrate(sql);
  const result = await seedCity(seedFileFor(slug));
  console.log(`Готово: площадок ${result.venues}, фактов ${result.facts}`);
  await closeDb();
}
