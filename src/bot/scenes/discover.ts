/**
 * Подбор событий: период, фильтры, карточки, «я пойду».
 *
 * События с вердиктом «не подходит» и «нет данных» не выбрасываются —
 * они сворачиваются в отдельные блоки, чтобы человек сам решал.
 */

import type { Composer, Context } from '@maxhub/max-bot-api';
import { Keyboard } from '@maxhub/max-bot-api';
import type { Verdict } from '../../domain/matching.js';
import {
  categoriesInUse,
  getEvent,
  markAttendance,
  type UserRow,
} from '../../data/repos.js';
import { recommend, situationsOf, type RecommendFilter } from '../../services/recommend.js';
import { PERIOD_LABEL, periodRange, type Period } from '../../services/time.js';
import { ack, patchPayload, stateOf } from '../context.js';
import { HOME_ROW, kb, eventRow, periodRows, type Row } from '../keyboards.js';
import { renderEvent } from '../render/event.js';

const { callback } = Keyboard.button;

const CATEGORY_LABEL: Record<string, string> = {
  exhibition: 'Выставки',
  theater: 'Театр',
  concert: 'Концерты',
  festival: 'Фестивали',
  education: 'Лекции',
  entertainment: 'Развлечения',
  kids: 'Детям',
  tour: 'Экскурсии',
  photo: 'Фото',
  cinema: 'Кино',
  party: 'Вечеринки',
};

const MAX_CARDS = 5;

export function registerDiscover(bot: Composer<Context>): void {
  bot.action('find:menu', async (ctx) => {
    await ack(ctx);
    await ctx.reply('Когда хочешь пойти?', kb(periodRows()));
  });

  bot.action(/^find:(today|weekend|week)$/, async (ctx) => {
    const period = ctx.match?.[1] as Period;
    await ack(ctx);
    await showResults(ctx, period);
  });

  bot.action('filter:menu', async (ctx) => {
    await ack(ctx);
    const { city, session } = stateOf(ctx);
    const { from } = periodRange('week', city.tz);
    const categories = await categoriesInUse(city.id, from);
    const active = filterOf(session.payload);

    const rows = chunk(
      categories.map((c) =>
        callback(`${active.category === c ? '☑️ ' : ''}${CATEGORY_LABEL[c] ?? c}`, `filter:cat:${c}`),
      ),
      2,
    );
    rows.push([callback(`${active.freeOnly ? '☑️' : '▫️'} Только бесплатные`, 'filter:free')]);
    rows.push([callback('Сбросить фильтры', 'filter:reset')]);
    rows.push([callback('⬅️ К выбору периода', 'find:menu')]);

    await ctx.reply('Что показывать?', kb(rows));
  });

  bot.action(/^filter:cat:(.+)$/, async (ctx) => {
    const category = ctx.match?.[1] ?? null;
    const { session } = stateOf(ctx);
    const current = filterOf(session.payload);
    await patchPayload(ctx, {
      filter: { ...current, category: current.category === category ? null : category },
    });
    await ack(ctx, 'Фильтр обновлён');
    await ctx.reply('Когда хочешь пойти?', kb(periodRows()));
  });

  bot.action('filter:free', async (ctx) => {
    const { session } = stateOf(ctx);
    const current = filterOf(session.payload);
    await patchPayload(ctx, { filter: { ...current, freeOnly: !current.freeOnly } });
    await ack(ctx, 'Фильтр обновлён');
    await ctx.reply('Когда хочешь пойти?', kb(periodRows()));
  });

  bot.action('filter:reset', async (ctx) => {
    await patchPayload(ctx, { filter: { category: null, freeOnly: false } });
    await ack(ctx, 'Фильтры сброшены');
    await ctx.reply('Когда хочешь пойти?', kb(periodRows()));
  });

  bot.action(/^more:(unknown|unfit)$/, async (ctx) => {
    const verdict = ctx.match?.[1] as Verdict;
    await ack(ctx);
    const { session } = stateOf(ctx);
    const period = (session.payload.period as Period | undefined) ?? 'weekend';
    await showResults(ctx, period, verdict);
  });

  bot.action(/^go:(\d+)$/, async (ctx) => {
    const eventId = Number(ctx.match?.[1]);
    const { user, city } = stateOf(ctx);
    await markAttendance(user.maxUserId, eventId);
    await ack(ctx, 'Отметил');

    const event = await getEvent(eventId);
    await ctx.reply(
      `Отметил: ${event?.title ?? 'событие'}.\n\n` +
        'После похода спрошу пару вопросов о доступности — это поможет следующим.',
      kb([[callback('🔎 Найти ещё', 'find:menu')], HOME_ROW]),
    );
    void city;
  });

  bot.action(/^req:(\d+)$/, async (ctx) => {
    await ack(ctx, 'Добавил в очередь проверки');
    await ctx.reply(
      'Отметил площадку как требующую проверки.\n\n' +
        'Если окажешься рядом — можешь заполнить данные сам, это пара кнопок.',
      kb([[callback('✍️ Помочь с данными', 'con:start')], HOME_ROW]),
    );
  });
}

async function showResults(ctx: Context, period: Period, only?: Verdict): Promise<void> {
  const { user, city, session } = stateOf(ctx);
  await patchPayload(ctx, { period });

  await ctx.reply('Ищу события…');

  const filter = filterOf(session.payload);
  const result = await recommend(user, city.id, period, city.tz, filter);

  if (result.total === 0) {
    await ctx.reply(
      `${PERIOD_LABEL[period]} в афише пусто.\n` +
        (result.lastSync ? `Афиша обновлялась ${result.lastSync.toLocaleString('ru-RU')}.` : '') +
        '\nПопробуй другой период или сбрось фильтры.',
      kb(periodRows()),
    );
    return;
  }

  if (only) {
    await renderBucket(ctx, result.buckets[only], only, city.tz);
    await ctx.reply('Что дальше?', kb(periodRows()));
    return;
  }

  const suitable = [...result.buckets.fits, ...result.buckets.partial];
  const header = summary(user, period, suitable.length, result.total);
  await ctx.reply(header);

  if (suitable.length === 0) {
    await ctx.reply(
      'Под твой профиль ничего не подошло. Так бывает: по большинству площадок ' +
        'данных пока нет, а «нет данных» я не выдаю за «доступно».',
    );
  }

  for (const item of suitable.slice(0, MAX_CARDS)) {
    await ctx.reply(
      renderEvent(item.event, item.match, city.tz),
      kb([eventRow(item.event.id, item.event.lat, item.event.lon)]),
    );
  }

  const rows: Row[] = [];
  if (result.buckets.unknown.length > 0) {
    rows.push([callback(`❓ Без данных — ${result.buckets.unknown.length}`, 'more:unknown')]);
  }
  if (result.buckets.unfit.length > 0) {
    rows.push([callback(`❌ Не подходят — ${result.buckets.unfit.length}`, 'more:unfit')]);
  }
  rows.push([callback('🔎 Другой период', 'find:menu')]);
  rows.push(HOME_ROW);

  await ctx.reply(sourceNote(result.lastSync), kb(rows));
}

async function renderBucket(
  ctx: Context,
  items: { event: Parameters<typeof renderEvent>[0]; match: Parameters<typeof renderEvent>[1] }[],
  verdict: Verdict,
  tz: string,
): Promise<void> {
  const intro =
    verdict === 'unknown'
      ? 'Эти места никто ещё не проверял. Если побываешь — отметь, что там с доступностью.'
      : 'Эти не подходят по твоему профилю. Показываю, чтобы решение было твоим.';
  await ctx.reply(intro);

  for (const item of items.slice(0, MAX_CARDS)) {
    const rows = [eventRow(item.event.id, item.event.lat, item.event.lon)];
    if (verdict === 'unknown' && item.event.venueId) {
      rows.push([callback('🔍 Запросить проверку', `req:${item.event.venueId}`)]);
    }
    await ctx.reply(renderEvent(item.event, item.match, tz), kb(rows));
  }
}

function summary(user: UserRow, period: Period, suitable: number, total: number): string {
  const situations = situationsOf(user);
  const who = user.groupProfile?.length
    ? `вашей компании (${user.groupProfile.length} чел.)`
    : 'твоего профиля';

  if (situations.length === 0) {
    return `${PERIOD_LABEL[period]}: нашёл ${total} ${plural(total)}. Профиль не задан, показываю всё.`;
  }
  return (
    `${PERIOD_LABEL[period]}: из ${total} ${plural(total)} под ${who} ` +
    `подходит ${suitable}.`
  );
}

function sourceNote(lastSync: Date | null): string {
  const when = lastSync ? lastSync.toLocaleDateString('ru-RU') : 'не обновлялась';
  return `Афиша: KudaGo, обновлена ${when}. Данные о доступности — наши и от посетителей.`;
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

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
