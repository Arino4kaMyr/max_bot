import { connectDb, migrate, waitForDb, closeDb } from '../src/data/db.js';
import { ensureCity, eventsBetween, factsForVenues } from '../src/data/repos.js';
import { seedCity, seedFileFor } from '../src/data/seed.js';
import { syncCity } from '../src/sync/kudago.js';
import { recommend } from '../src/services/recommend.js';
import { renderEvent } from '../src/bot/render/event.js';
import type { UserRow } from '../src/data/repos.js';

const url = process.env.DATABASE_URL!;
const sql = connectDb(url);
await waitForDb(sql);
await migrate(sql);
console.log('✓ миграция');

const seeded = await seedCity(seedFileFor('kzn'));
console.log(`✓ сид: площадок ${seeded.venues}, фактов ${seeded.facts}`);

const city = await ensureCity('kzn', 'Казань', 'Europe/Moscow');
const sync = await syncCity('kzn', 'Казань', 'Europe/Moscow');
console.log(`✓ синк: событий ${sync.events}, новых площадок ${sync.venuesCreated}, пропущено ${sync.skipped}`);

const user: UserRow = {
  maxUserId: 1, name: 'Тест', cityId: city.id,
  situations: ['wheelchair'], groupProfile: null, digestOptin: true,
};

for (const period of ['today', 'weekend', 'week'] as const) {
  const r = await recommend(user, city.id, period, city.tz);
  console.log(`${period}: всего ${r.total} → ✅${r.buckets.fits.length} ⚠️${r.buckets.partial.length} ❓${r.buckets.unknown.length} ❌${r.buckets.unfit.length}`);
}

const r = await recommend(user, city.id, 'week', city.tz);
const sample = [...r.buckets.fits, ...r.buckets.partial, ...r.buckets.unfit].slice(0, 3);
for (const item of sample) {
  console.log('\n--- карточка ---');
  console.log(renderEvent(item.event, item.match, city.tz));
}

const group: UserRow = { ...user, situations: [], groupProfile: [['wheelchair'], ['stroller']] };
const gr = await recommend(group, city.id, 'week', city.tz);
console.log(`\nкомпания: всего ${gr.total} → ✅${gr.buckets.fits.length} ⚠️${gr.buckets.partial.length} ❓${gr.buckets.unknown.length} ❌${gr.buckets.unfit.length}`);

await closeDb();
