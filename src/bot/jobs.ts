/**
 * Фоновые задачи бота.
 *
 * Проактивное сообщение — то, чего веб-сервис не умеет: человеку не нужно
 * помнить про бота, бот сам приходит с готовой подборкой.
 */

import { Keyboard, type Api } from '@maxhub/max-bot-api';
import type { City } from '../data/repos.js';
import {
  getSession,
  markAsked,
  pendingAskAfterEvent,
  saveSession,
  usersForDigest,
  ensureUser,
} from '../data/repos.js';
import { countSuitable, recommend, situationsOf } from '../services/recommend.js';
import { adoptScreen } from './context.js';
import { questionsAfterEvent } from '../services/contribute.js';
import { getVenue } from '../data/repos.js';

const { callback } = Keyboard.button;

function keyboard(rows: ReturnType<typeof callback>[][]) {
  return { attachments: [Keyboard.inlineKeyboard(rows)] };
}

/** Четверг: сводка по выходным для тех, у кого заполнен профиль. */
export async function sendWeekendDigest(api: Api, city: City): Promise<number> {
  const users = await usersForDigest(city.id);
  let sent = 0;

  for (const user of users) {
    try {
      const result = await recommend(user, city.id, 'weekend', city.tz);
      const count = countSuitable(result);
      if (count === 0) continue;

      const message = await api.sendMessageToUser(
        user.maxUserId,
        `На выходных в Казани нашлось ${count} ${plural(count)}, куда ты сможешь попасть.`,
        keyboard([
          [callback('Посмотреть', 'find:weekend')],
          [callback('Не писать мне', 'digest:off')],
        ]),
      );
      // Сообщение становится новым экраном — дальше бот правит его.
      await adoptScreen(user.maxUserId, message.body.mid);
      sent++;
    } catch (error) {
      console.error(`Сводка не доставлена пользователю ${user.maxUserId}:`, error);
    }
  }

  return sent;
}

/**
 * После события — вопрос о доступности.
 *
 * Спрашиваем только тех, кто отметил «я пойду», и только про то,
 * что критично для их профиля.
 */
export async function askAfterEvents(api: Api, city: City): Promise<number> {
  const pending = await pendingAskAfterEvent(new Date());
  let asked = 0;

  for (const item of pending) {
    if (item.venueId == null) continue;
    try {
      const user = await ensureUser(item.maxUserId, null, city.id);
      const questions = await questionsAfterEvent(item.venueId, situationsOf(user));
      const first = questions[0];
      const venue = await getVenue(item.venueId);
      if (!first || !venue) {
        await markAsked(item.maxUserId, item.eventId);
        continue;
      }

      const session = await getSession(item.maxUserId);
      session.scene = 'verify';
      session.step = 0;
      session.payload = { venueId: item.venueId, keys: questions.map((q) => q.key) };
      await saveSession(item.maxUserId, session);

      const message = await api.sendMessageToUser(
        item.maxUserId,
        `Ты был в месте «${venue.name}». Расскажешь, как там на самом деле?\n\n${first.text}`,
        keyboard([
          [callback('Да', 'vrf:yes'), callback('Нет', 'vrf:no')],
          [callback('Не помню', 'vrf:skip')],
        ]),
      );
      await adoptScreen(item.maxUserId, message.body.mid);
      await markAsked(item.maxUserId, item.eventId);
      asked++;
    } catch (error) {
      console.error(`Вопрос после события не доставлен ${item.maxUserId}:`, error);
    }
  }

  return asked;
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'события';
  return 'событий';
}
