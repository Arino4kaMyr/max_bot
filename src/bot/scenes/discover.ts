/**
 * Подбор событий: период, фильтры, колода карточек.
 *
 * События с вердиктом «не подходит» и «нет данных» не выбрасываются —
 * они лежат отдельными наборами, чтобы решение оставалось за человеком.
 */

import type { Composer, Context } from '@maxhub/max-bot-api';
import { Keyboard } from '@maxhub/max-bot-api';
import type { Verdict } from '../../domain/matching.js';
import { categoriesInUse, getEvent, markAttendance, type UserRow } from '../../data/repos.js';
import {
  matchOne,
  recommend,
  situationsOf,
  type RecommendFilter,
  type RecommendResult,
} from '../../services/recommend.js';
import { PERIOD_LABEL, periodRange, type Period } from '../../services/time.js';
import { ack, patchPayload, screen, stateOf } from '../context.js';
import { HOME_ROW, kb, periodRows, type Row } from '../keyboards.js';
import { categoryOf } from '../render/categories.js';
import { deckKeyboard, renderCard, type DeckState } from '../render/deck.js';

const { callback } = Keyboard.button;

/** Сколько событий кладём в колоду — дальше листать никто не будет. */
const DECK_LIMIT = 20;

const BUCKET_PRIORITY: Verdict[] = ['fits', 'partial', 'unknown', 'unfit'];

export function registerDiscover(bot: Composer<Context>): void {
  bot.action('find:menu', async (ctx) => {
    await ack(ctx);
    await screen(ctx, 'Когда планируешь выбраться?', kb(periodRows()));
  });

  bot.action(/^find:(today|weekend|week)$/, async (ctx) => {
    const period = ctx.match?.[1] as Period;
    await ack(ctx);
    await openDeck(ctx, period);
  });

  // --- листание колоды ---

  bot.action(['deck:prev', 'deck:next'], async (ctx) => {
    const forward = ctx.callback?.payload === 'deck:next';
    const deck = deckOf(ctx);
    if (!deck) return ack(ctx);

    const index = Math.min(Math.max(deck.index + (forward ? 1 : -1), 0), deck.ids.length - 1);
    await ack(ctx);
    await showCard(ctx, { ...deck, index });
  });

  bot.action(/^deck:tab:(fits|partial|unknown|unfit)$/, async (ctx) => {
    const bucket = ctx.match?.[1] as Verdict;
    const deck = deckOf(ctx);
    const ids = (deck?.all?.[bucket] ?? []).slice(0, DECK_LIMIT);
    if (!deck || ids.length === 0) return ack(ctx);

    await ack(ctx);
    await showCard(ctx, { ...deck, bucket, ids, index: 0 });
  });

  // Края колоды и счётчик — кнопки без действия, но «часики» снять нужно.
  bot.action(['deck:edge', 'deck:noop'], async (ctx) => {
    await ack(ctx);
  });

  // --- фильтры ---

  bot.action('filter:menu', async (ctx) => {
    await ack(ctx);
    const { city, session } = stateOf(ctx);
    const { from } = periodRange('week', city.tz);
    const categories = await categoriesInUse(city.id, from);
    const active = filterOf(session.payload);

    const rows = chunk(
      categories.map((c) =>
        callback(
          `${active.category === c ? '☑️ ' : ''}${categoryOf(c).icon} ${categoryOf(c).label}`,
          `filter:cat:${c}`,
        ),
      ),
      2,
    );
    rows.push([callback(`${active.freeOnly ? '☑️' : '▫️'} Только бесплатные`, 'filter:free')]);
    rows.push([callback('Сбросить фильтры', 'filter:reset')]);
    rows.push([callback('⬅️ К выбору периода', 'find:menu')]);

    await screen(ctx, 'Что показывать?', kb(rows));
  });

  bot.action(/^filter:cat:(.+)$/, async (ctx) => {
    const category = ctx.match?.[1] ?? null;
    const current = filterOf(stateOf(ctx).session.payload);
    await patchPayload(ctx, {
      filter: { ...current, category: current.category === category ? null : category },
    });
    await ack(ctx, 'Фильтр обновлён');
    await screen(ctx, 'Когда планируешь выбраться?', kb(periodRows()));
  });

  bot.action('filter:free', async (ctx) => {
    const current = filterOf(stateOf(ctx).session.payload);
    await patchPayload(ctx, { filter: { ...current, freeOnly: !current.freeOnly } });
    await ack(ctx, 'Фильтр обновлён');
    await screen(ctx, 'Когда планируешь выбраться?', kb(periodRows()));
  });

  bot.action('filter:reset', async (ctx) => {
    await patchPayload(ctx, { filter: { category: null, freeOnly: false } });
    await ack(ctx, 'Фильтры сброшены');
    await screen(ctx, 'Когда планируешь выбраться?', kb(periodRows()));
  });

  // --- действия по карточке ---

  bot.action(/^go:(\d+)$/, async (ctx) => {
    const eventId = Number(ctx.match?.[1]);
    const { user } = stateOf(ctx);
    await markAttendance(user.maxUserId, eventId);

    const event = await getEvent(eventId);
    await ack(ctx, `Записал: ${event?.title ?? 'событие'}`);

    // Остаёмся в колоде: отметка события не должна сбивать просмотр.
    const deck = deckOf(ctx);
    if (deck) {
      await showCard(ctx, deck);
      return;
    }
    await screen(
      ctx,
      'Записал. Когда сходишь, спрошу, как там оказалось на деле — это поможет тем, кто пойдёт следом.',
      kb([[callback('🔎 Найти ещё', 'find:menu')], HOME_ROW]),
    );
  });

  bot.action(/^req:(\d+)$/, async (ctx) => {
    await ack(ctx, 'Добавил в очередь проверки');
    await screen(ctx, 
      'Отметил: по этому месту нужны данные.\n\n' +
        'Если вдруг окажешься там — расскажи, как всё устроено на входе.',
      kb([[callback('✍️ Рассказать о месте', 'con:start')], HOME_ROW]),
    );
  });
}

/** Состояние колоды вместе с полным раскладом по наборам. */
interface StoredDeck extends DeckState {
  all: Partial<Record<Verdict, number[]>>;
  tz: string;
}

function deckOf(ctx: Context): StoredDeck | null {
  const deck = stateOf(ctx).session.payload.deck as StoredDeck | undefined;
  return deck?.ids?.length ? deck : null;
}

async function openDeck(ctx: Context, period: Period): Promise<void> {
  const { user, city, session } = stateOf(ctx);
  await patchPayload(ctx, { period });

  await screen(ctx, 'Ищу события…');

  const filter = filterOf(session.payload);
  const result = await recommend(user, city.id, period, city.tz, filter);

  if (result.total === 0) {
    await screen(ctx, 
      `${PERIOD_LABEL[period]} в афише пусто. Попробуй другой период или сними фильтры.`,
      kb(periodRows()),
    );
    return;
  }

  const all: Partial<Record<Verdict, number[]>> = {};
  const counts: Partial<Record<Verdict, number>> = {};
  for (const bucket of BUCKET_PRIORITY) {
    const ids = result.buckets[bucket].map((r) => r.event.id).slice(0, DECK_LIMIT);
    all[bucket] = ids;
    counts[bucket] = ids.length;
  }

  const bucket = BUCKET_PRIORITY.find((b) => (counts[b] ?? 0) > 0)!;
  const deck: StoredDeck = { ids: all[bucket]!, index: 0, bucket, counts, all, tz: city.tz };

  await screen(ctx, summary(user, period, result));
  await showCard(ctx, deck);
}

/** Показывает карточку в том же сообщении-экране. */
async function showCard(ctx: Context, deck: StoredDeck): Promise<void> {
  const { user } = stateOf(ctx);
  const eventId = deck.ids[deck.index];
  if (eventId == null) return;

  const item = await matchOne(user, eventId);
  if (!item) {
    await screen(ctx, 'Это событие уже прошло.', kb(periodRows()));
    return;
  }

  await patchPayload(ctx, { deck });

  await screen(ctx, renderCard(item, deck, deck.tz), kb(deckKeyboard(item, deck)));
}

function summary(user: UserRow, period: Period, result: RecommendResult): string {
  const situations = situationsOf(user);
  const suitable = result.buckets.fits.length + result.buckets.partial.length;
  const when = PERIOD_LABEL[period].toLowerCase();

  if (situations.length === 0) {
    return `Нашёл ${result.total} ${plural(result.total)} ${when}. Профиль не задан — показываю всё.`;
  }

  const who = user.groupProfile?.length ? `вашей компании` : 'тебя';
  if (suitable === 0) {
    return (
      `Из ${result.total} ${plural(result.total)} ${when} для ${who} не подошло ничего.\n` +
      'По большинству мест сведений пока нет, а неизвестное я не выдаю за доступное.'
    );
  }

  return `Из ${result.total} ${plural(result.total)} ${when} для ${who} подходит ${suitable}. Листай карточки.`;
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'события';
  return 'событий';
}

function filterOf(payload: Record<string, unknown>): RecommendFilter {
  const raw = payload.filter as RecommendFilter | undefined;
  return { category: raw?.category ?? null, freeOnly: raw?.freeOnly ?? false };
}

function chunk(items: Row, size: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
