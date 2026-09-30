import type { Context } from '@maxhub/max-bot-api';
import type { City, SessionRow, UserRow } from '../data/repos.js';
import { clearScene, ensureUser, getSession, saveSession, setScreenMid } from '../data/repos.js';


export interface AppState {
  user: UserRow;
  city: City;
  session: SessionRow;
}

type SendAttachments = Parameters<Context['reply']>[1] extends infer E
  ? E extends { attachments?: infer A }
    ? A
    : never
  : never;

export function stateOf(ctx: Context): AppState {
  const state = ctx.state.app as AppState | undefined;
  if (!state) throw new Error('Состояние не загружено');
  return state;
}

/**
 * Пользователь лежит в разных местах в зависимости от типа обновления:
 * в корне, в `callback.user` при нажатии кнопки, в `message.sender` у сообщения.
 * Геттер SDK знает про все три случая — свой разбор здесь только плодил бы ошибки.
 */
export function userIdOf(ctx: Context): number | null {
  return ctx.user?.user_id ?? null;
}

export function userNameOf(ctx: Context): string | null {
  return ctx.user?.first_name ?? ctx.user?.name ?? null;
}

/**
 * Загружает пользователя и состояние диалога перед каждым обновлением.
 *
 * Состояние живёт в базе, а не в памяти: перезапуск контейнера посреди
 * онбординга не теряет прогресс.
 */
export function withState(city: City) {
  return async (ctx: Context, next: () => Promise<void>): Promise<void> => {
    const id = userIdOf(ctx);
    if (id == null) {
      // Обновление без пользователя (например, бот добавлен в чат) — пропускаем:
      // сценарии без профиля всё равно не работают.
      return;
    }

    const user = await ensureUser(id, userNameOf(ctx), city.id);
    const session = await getSession(id);
    ctx.state.app = { user, city, session } satisfies AppState;
    await next();
  };
}

export async function setScene(
  ctx: Context,
  scene: string | null,
  payload: Record<string, unknown> = {},
  step = 0,
): Promise<void> {
  const { user, session } = stateOf(ctx);
  if (scene === null) {
    await clearScene(user.maxUserId, session.screenMid);
    session.scene = null;
    session.step = 0;
    session.payload = {};
    return;
  }
  session.scene = scene;
  session.step = step;
  session.payload = payload;
  await saveSession(user.maxUserId, session);
}

export async function patchPayload(
  ctx: Context,
  patch: Record<string, unknown>,
  step?: number,
): Promise<void> {
  const { user, session } = stateOf(ctx);
  session.payload = { ...session.payload, ...patch };
  if (step !== undefined) session.step = step;
  await saveSession(user.maxUserId, session);
}

/** Снимает «часики» с нажатой кнопки — иначе интерфейс выглядит зависшим. */
export async function ack(ctx: Context, notification?: string): Promise<void> {
  if (!ctx.callback?.callback_id) return;
  try {
    await ctx.answerOnCallback(notification ? { message: { text: notification } } : {});
  } catch {
    // Устаревший callback — не повод ронять обработку.
  }
}

/**
 * Показывает экран бота.
 *
 * Бот держит одно сообщение и правит его: лента не разрастается, прошлые
 * состояния не остаются мусором, и человеку не нужно прокручивать чат,
 * чтобы найти актуальные кнопки. Новое сообщение отправляется только если
 * экрана ещё нет или он больше не редактируется.
 */
export async function screen(
  ctx: Context,
  text: string,
  extra?: { attachments?: unknown[] },
): Promise<void> {
  const { user, session } = stateOf(ctx);
  const attachments = extra?.attachments as SendAttachments;

  // Когда человек пишет сам, экран уезжает вверх и правка остаётся
  // незамеченной — в этом случае заводим новый экран внизу диалога.
  const pushedUp = ctx.updateType === 'message_created';

  if (session.screenMid && !pushedUp) {
    try {
      await ctx.api.editMessage(session.screenMid, { text, attachments });
      return;
    } catch {
      // Экран удалён или слишком стар для правки — заведём новый.
    }
  }

  const message = await ctx.reply(text, attachments ? { attachments } : {});
  session.screenMid = message.body.mid;
  await setScreenMid(user.maxUserId, message.body.mid);
}

/** Регистрирует как экран сообщение, отправленное фоновой задачей. */
export async function adoptScreen(maxUserId: number, mid: string): Promise<void> {
  await setScreenMid(maxUserId, mid);
}
