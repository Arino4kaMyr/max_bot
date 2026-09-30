/**
 * Подтверждение фактов после посещения.
 *
 * Спрашиваем ровно то, что критично для профиля этого человека — то есть то,
 * что он действительно проверял на себе. Два вопроса; третий — по его кнопке.
 */

import type { Composer, Context } from '@maxhub/max-bot-api';
import { Keyboard } from '@maxhub/max-bot-api';
import { isFeatureKey, VISITOR_ASKABLE, type FeatureKey } from '../../domain/features.js';
import { getVenue } from '../../data/repos.js';
import {
  ASK_AFTER_EVENT,
  questionFor,
  questionsAfterEvent,
  submitAnswer,
} from '../../services/contribute.js';
import { situationsOf } from '../../services/recommend.js';
import { ack, patchPayload, screen, setScene, stateOf } from '../context.js';
import { HOME_ROW, kb, type Row } from '../keyboards.js';

const { callback } = Keyboard.button;

export function registerVerify(bot: Composer<Context>): void {
  bot.action(/^vrf:(yes|no|skip)$/, async (ctx) => {
    const answer = ctx.match?.[1] as 'yes' | 'no' | 'skip';
    const { user, session } = stateOf(ctx);

    const venueId = session.payload.venueId as number | undefined;
    const keys = (session.payload.keys as FeatureKey[] | undefined) ?? [];
    const index = session.step;

    if (venueId == null) {
      await ack(ctx);
      return;
    }

    const key = keys[index];
    if (key && answer !== 'skip' && isFeatureKey(key)) {
      await submitAnswer({ maxUserId: user.maxUserId, venueId, key, answer });
    }
    await ack(ctx, answer === 'skip' ? undefined : 'Записал, спасибо');
    await patchPayload(ctx, {}, index + 1);
    await askNextVerification(ctx);
  });

  bot.action(/^vrf:more:(\d+)$/, async (ctx) => {
    const venueId = Number(ctx.match?.[1]);
    await ack(ctx);

    const { session } = stateOf(ctx);
    const asked = (session.payload.keys as FeatureKey[] | undefined) ?? [];
    const extra = VISITOR_ASKABLE.filter((k) => !asked.includes(k));

    if (extra.length === 0) {
      await screen(ctx, 'Больше спрашивать нечего. Спасибо!', kb([HOME_ROW]));
      return;
    }

    await setScene(ctx, 'verify', { venueId, keys: [...asked, ...extra] }, asked.length);
    await askNextVerification(ctx);
  });
}

/** Задаёт следующий вопрос или закрывает опрос. */
export async function askNextVerification(ctx: Context): Promise<void> {
  const { session } = stateOf(ctx);
  const keys = (session.payload.keys as FeatureKey[] | undefined) ?? [];
  const venueId = session.payload.venueId as number | undefined;
  const index = session.step;

  if (venueId == null) return;

  if (index >= keys.length) {
    await setScene(ctx, null);
    await screen(ctx, 'Спасибо, данные обновлены.', kb([HOME_ROW]));
    return;
  }

  // Первые ASK_AFTER_EVENT вопросов задаём сами, дальше — только по просьбе.
  if (index === ASK_AFTER_EVENT && keys.length > ASK_AFTER_EVENT) {
    const rows: Row[] = [
      [callback('➕ Ответить ещё на несколько', `vrf:more:${venueId}`)],
      [callback('На сегодня всё', 'menu')],
    ];
    await setScene(ctx, null);
    await screen(ctx, 'Этого достаточно. Спасибо, что нашёл время.', kb(rows));
    return;
  }

  const question = questionFor(keys[index]!);
  if (!question) {
    await patchPayload(ctx, {}, index + 1);
    return askNextVerification(ctx);
  }

  await screen(ctx, 
    question.text,
    kb([
      [callback('Да', 'vrf:yes'), callback('Нет', 'vrf:no')],
      [callback('Не помню', 'vrf:skip')],
    ]),
  );
}

/** Текст первого вопроса после события — отправляется фоновой задачей. */
export async function buildAfterEventPrompt(
  venueId: number,
  situations: Parameters<typeof questionsAfterEvent>[1],
): Promise<{ intro: string; keys: FeatureKey[]; first: string } | null> {
  const venue = await getVenue(venueId);
  const questions = await questionsAfterEvent(venueId, situations);
  const first = questions[0];
  if (!venue || !first) return null;

  return {
    intro: `Ты был в месте «${venue.name}». Расскажешь, как там на самом деле?`,
    keys: questions.map((q) => q.key),
    first: first.text,
  };
}

export { situationsOf };
