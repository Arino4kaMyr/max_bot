/**
 * Импорт афиши из публичного API KudaGo.
 *
 * Доступность событию не приписывается — она наследуется от площадки.
 * Площадки, которых нет в справочнике, заводятся со статусом `unmapped`:
 * их события попадают в блок «нет данных», а сами они формируют очередь
 * заданий для контрибьюторов.
 */

import { deleteEventsByCategories, ensureCity, upsertEvent, upsertVenue } from '../data/repos.js';

const API = 'https://kudago.com/public-api/v1.4';
const TIMEOUT_MS = 10_000;

/** Постоянные экспозиции KudaGo отдаёт с концом в 9999 году. */
const FAR_FUTURE = new Date('2100-01-01').getTime();
const PERMANENT_AFTER_DAYS = 120;

/** Не досуг: промоакции магазинов и скидочные предложения. */
const EXCLUDED_CATEGORIES = new Set(['stock']);

interface KudagoPlace {
  id: number;
  title: string;
  address?: string | null;
  coords?: { lat: number; lon: number } | null;
}

interface KudagoEvent {
  id: number;
  title: string;
  dates: { start: number; end: number }[];
  place: KudagoPlace | null;
  price?: string | null;
  is_free?: boolean;
  categories?: string[];
  site_url: string;
}

interface KudagoPage {
  next: string | null;
  results: KudagoEvent[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`KudaGo ответил ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Один повтор — сеть моргает чаще, чем ломается. */
async function fetchWithRetry<T>(url: string): Promise<T> {
  try {
    return await fetchJson<T>(url);
  } catch {
    return fetchJson<T>(url);
  }
}

export interface SyncResult {
  events: number;
  venuesCreated: number;
  skipped: number;
}

export async function syncCity(
  citySlug: string,
  cityName: string,
  tz: string,
): Promise<SyncResult> {
  const city = await ensureCity(citySlug, cityName, tz);
  const since = Math.floor(Date.now() / 1000);

  const fields = 'id,title,dates,price,is_free,categories,site_url,place';
  let url =
    `${API}/events/?location=${citySlug}&actual_since=${since}&page_size=100` +
    `&fields=${fields}&expand=place&order_by=dates`;

  const venueCache = new Map<number, number>();
  const seen = new Set<string>();
  let events = 0;
  let venuesCreated = 0;
  let skipped = 0;
  let pages = 0;

  while (url && pages < 10) {
    const page = await fetchWithRetry<KudagoPage>(url);
    pages++;

    for (const raw of page.results) {
      if (raw.categories?.some((c) => EXCLUDED_CATEGORIES.has(c))) {
        skipped++;
        continue;
      }

      const slot = pickSlot(raw.dates);
      if (!slot) {
        skipped++;
        continue;
      }

      let venueId: number | null = null;
      if (raw.place) {
        const cached = venueCache.get(raw.place.id);
        if (cached) {
          venueId = cached;
        } else {
          const created = await upsertVenue({
            cityId: city.id,
            name: raw.place.title,
            address: raw.place.address ?? null,
            lat: raw.place.coords?.lat ?? null,
            lon: raw.place.coords?.lon ?? null,
            kudagoPlaceId: raw.place.id,
          });
          venueCache.set(raw.place.id, created);
          venueId = created;
          venuesCreated++;
        }
      }

      const key = `${raw.id}:${slot.start.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      await upsertEvent({
        cityId: city.id,
        venueId,
        title: normalizeTitle(raw.title),
        startsAt: slot.start,
        endsAt: slot.end,
        price: raw.price?.trim() || null,
        isFree: Boolean(raw.is_free),
        category: raw.categories?.[0] ?? null,
        sourceUrl: raw.site_url,
        externalId: String(raw.id),
        isPermanent: slot.permanent,
      });
      events++;
    }

    url = page.next ?? '';
  }

  await dropExcluded();
  return { events, venuesCreated, skipped };
}

/** Убирает события исключённых категорий, загруженные прежними версиями. */
async function dropExcluded(): Promise<void> {
  await deleteEventsByCategories([...EXCLUDED_CATEGORIES]);
}

/**
 * Выбирает показ, который ещё актуален.
 *
 * У постоянных экспозиций начало в прошлом, а конец — в далёком будущем;
 * такие события остаются в выдаче и помечаются как идущие сейчас.
 */
export function pickSlot(
  dates: { start: number; end: number }[],
): { start: Date; end: Date | null; permanent: boolean } | null {
  const now = Date.now();
  let best: { start: Date; end: Date | null; permanent: boolean } | null = null;

  for (const d of dates) {
    const start = new Date(d.start * 1000);
    const rawEnd = d.end ? new Date(d.end * 1000) : null;
    const endMs = rawEnd?.getTime() ?? 0;
    if (rawEnd && endMs < now) continue;

    const permanent =
      endMs > FAR_FUTURE ||
      (rawEnd !== null && endMs - start.getTime() > PERMANENT_AFTER_DAYS * 864e5);

    const end = rawEnd && endMs <= FAR_FUTURE ? rawEnd : null;
    const candidate = { start, end, permanent };

    if (!best) best = candidate;
    else if (start.getTime() >= now && start.getTime() < best.start.getTime()) best = candidate;
    else if (best.start.getTime() < now && start.getTime() >= now) best = candidate;
  }

  return best;
}

function normalizeTitle(title: string): string {
  return title.charAt(0).toUpperCase() + title.slice(1);
}
