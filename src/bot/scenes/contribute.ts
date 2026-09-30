/**
 * Вклад посетителя.
 *
 * Разметку делает тот, кто и так туда пришёл: чтобы заметить ступеньку,
 * экспертиза не нужна. Поэтому вопросы — без терминов, а экспертные признаки
 * у случайного посетителя не спрашиваются вовсе.
 */

import type { Composer, Context } from '@maxhub/max-bot-api';
import { Keyboard } from '@maxhub/max-bot-api';
import { isFeatureKey, type FeatureKey } from '../../domain/features.js';
import {
  contributionCount,
  findVenueByName,
  getVenue,
  nearestVenues,
  savePhoto,
  venuesNeedingData,
  type Venue,
} from '../../data/repos.js';
import { checklist, questionFor, submitAnswer, venueLine } from '../../services/contribute.js';
import { ack, patchPayload, screen, setScene, stateOf } from '../context.js';
import { HOME_ROW, kb, type Row } from '../keyboards.js';

const { callback, requestGeoLocation } = Keyboard.button;

export function registerContribute(bot: Composer<Context>): void {
  bot.action('con:start', async (ctx) => {
    await ack(ctx);
    await setScene(ctx, 'contribute_pick');
    await screen(ctx, 
      'Спасибо.\n\n' +
        'Единой базы доступности не существует: её собирают те, кто был на месте. ' +
        'Твои ответы увидят люди, которые будут решать, идти им туда или нет.\n\n' +
        'Где ты был?',
      kb([
        [callback('📋 Выбрать из списка', 'con:list')],
        [requestGeoLocation('📍 Рядом со мной')],
        [callback('🔤 Найти по названию', 'con:search')],
        HOME_ROW,
      ]),
    );
  });

  bot.action('con:list', async (ctx) => {
    await ack(ctx);
    const { city } = stateOf(ctx);
    const venues = await venuesNeedingData(city.id);
    await replyVenueList(ctx, venues, 'Об этих местах пока известно меньше всего:');
  });

  bot.action('con:search', async (ctx) => {
    await ack(ctx);
    await setScene(ctx, 'contribute_search');
    await screen(ctx, 'Напиши название места — поищу его в справочнике.', kb([HOME_ROW]));
  });

  bot.action(/^con:v:(\d+)$/, async (ctx) => {
    const venueId = Number(ctx.match?.[1]);
    await ack(ctx);
    await startChecklist(ctx, venueId);
  });

  bot.action(/^con:a:(yes|no|skip)$/, async (ctx) => {
    const answer = ctx.match?.[1] as 'yes' | 'no' | 'skip';
    const { user, session } = stateOf(ctx);

    const venueId = session.payload.venueId as number | undefined;
    const keys = (session.payload.keys as FeatureKey[] | undefined) ?? [];
    const index = session.step;

    if (venueId == null || index >= keys.length) {
      await ack(ctx);
      return finishChecklist(ctx, venueId);
    }

    const key = keys[index]!;
    if (answer !== 'skip' && isFeatureKey(key)) {
      await submitAnswer({ maxUserId: user.maxUserId, venueId, key, answer });
    }
    await ack(ctx);
    await patchPayload(ctx, {}, index + 1);
    await askNext(ctx);
  });

  bot.action(/^con:photo:(\d+)$/, async (ctx) => {
    const venueId = Number(ctx.match?.[1]);
    await ack(ctx);
    await setScene(ctx, 'contribute_photo', { venueId });
    await screen(ctx, 
      'Если получится, пришли фотографию входа.\n\n' +
        'Она говорит больше любых ответов: «пандус есть» звучит одинаково и для удобного ' +
        'съезда, и для крутой горки. По снимку человек поймёт сам.',
      kb([[callback('Не сейчас', 'menu')]]),
    );
  });

  // --- ввод текста и геолокации внутри сцен ---

  bot.on('message_created', async (ctx, next) => {
    const { session, city, user } = stateOf(ctx);

    if (session.scene === 'contribute_search') {
      const query = ctx.message?.body?.text?.trim();
      if (!query) return next();
      const venues = await findVenueByName(city.id, query);
      if (venues.length === 0) {
        await screen(ctx, 
          'Такого места в справочнике Казани не нашлось.\n' +
            'Попробуй часть названия — или посмотри список.',
          kb([[callback('📋 Показать список', 'con:list')], HOME_ROW]),
        );
        return;
      }
      await replyVenueList(ctx, venues, 'Вот что нашлось:');
      return;
    }

    if (session.scene === 'contribute_photo') {
      const url = photoUrlOf(ctx);
      const venueId = session.payload.venueId as number | undefined;
      if (!url || venueId == null) return next();

      await savePhoto({ venueId, maxUserId: user.maxUserId, url });
      await setScene(ctx, null);
      await screen(ctx, 
        'Фотография сохранена. Её увидит каждый, кто будет присматриваться к этому месту.',
        kb([[callback('✍️ Рассказать о другом месте', 'con:start')], HOME_ROW]),
      );
      return;
    }

    const location = ctx.location;
    if (location && session.scene === 'contribute_pick') {
      const venues = await nearestVenues(city.id, location.latitude, location.longitude);
      await replyVenueList(ctx, venues, 'Вот что есть поблизости:');
      return;
    }

    return next();
  });
}

async function replyVenueList(ctx: Context, venues: Venue[], intro: string): Promise<void> {
  if (venues.length === 0) {
    await screen(ctx, 'В справочнике пока пусто.', kb([HOME_ROW]));
    return;
  }
  const rows: Row[] = venues.map((v) => [callback(trim(venueLine(v)), `con:v:${v.id}`)]);
  rows.push(HOME_ROW);
  await screen(ctx, intro, kb(rows));
}

async function startChecklist(ctx: Context, venueId: number): Promise<void> {
  const venue = await getVenue(venueId);
  if (!venue) {
    await screen(ctx, 'Не могу найти это место в справочнике.', kb([HOME_ROW]));
    return;
  }
  const keys = checklist().map((q) => q.key);
  await setScene(ctx, 'contribute_checklist', { venueId, keys }, 0);
  await screen(ctx, `${venue.name}. Отвечай как помнишь — если не уверен, так и скажи.`);
  await askNext(ctx);
}

async function askNext(ctx: Context): Promise<void> {
  const { session } = stateOf(ctx);
  const keys = (session.payload.keys as FeatureKey[] | undefined) ?? [];
  const venueId = session.payload.venueId as number | undefined;
  const index = session.step;

  if (index >= keys.length) {
    await finishChecklist(ctx, venueId);
    return;
  }

  const question = questionFor(keys[index]!);
  if (!question) {
    await patchPayload(ctx, {}, index + 1);
    return askNext(ctx);
  }

  await screen(ctx, 
    `${index + 1} из ${keys.length}. ${question.text}`,
    kb([
      [callback('Да', 'con:a:yes'), callback('Нет', 'con:a:no')],
      [callback('Не обратил внимания', 'con:a:skip')],
    ]),
  );
}

async function finishChecklist(ctx: Context, venueId: number | undefined): Promise<void> {
  const { user } = stateOf(ctx);
  await setScene(ctx, null);

  const total = await contributionCount(user.maxUserId);
  const rows: Row[] = [];
  if (venueId != null) rows.push([callback('📷 Добавить фото входа', `con:photo:${venueId}`)]);
  rows.push([callback('✍️ Рассказать о другом месте', 'con:start')]);
  rows.push(HOME_ROW);

  await screen(ctx, 
    'Готово. Спасибо — это правда важно.\n\n' +
      'Твои ответы увидит каждый, кто будет выбирать это место.\n' +
      `Всего с твоей помощью собрано: ${total} ${factPlural(total)}.`,
    kb(rows),
  );
}

/** URL фотографии из вложения сообщения. */
function photoUrlOf(ctx: Context): string | null {
  const attachments = (ctx.message?.body as { attachments?: unknown[] } | undefined)?.attachments;
  if (!Array.isArray(attachments)) return null;
  for (const raw of attachments) {
    const item = raw as { type?: string; payload?: { url?: string; token?: string } };
    if (item.type === 'image' && item.payload?.url) return item.payload.url;
  }
  return null;
}

function factPlural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'факт';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'факта';
  return 'фактов';
}

function trim(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}
