import type { Context } from '@maxhub/max-bot-api';
import type { City, SessionRow, UserRow } from '../data/repos.js';
import { clearSession, ensureUser, getSession, saveSession } from '../data/repos.js';

export interface AppState {
  user: UserRow;
  city: City;
  session: SessionRow;
}

export function stateOf(ctx: Context): AppState {
  const state = ctx.state.app as AppState | undefined;
  if (!state) throw new Error('Состояние не загружено');
  return state;
}

export function userIdOf(ctx: Context): number | null {
  const user = (ctx.update as { user?: { user_id?: number } }).user;
  return user?.user_id ?? null;
}

export function userNameOf(ctx: Context): string | null {
  const user = (ctx.update as { user?: { first_name?: string; name?: string } }).user;
  return user?.first_name ?? user?.name ?? null;
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
    if (id == null) return next();

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
    await clearSession(user.maxUserId);
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
  const callback = (ctx.update as { callback?: { callback_id?: string } }).callback;
  if (!callback?.callback_id) return;
  try {
    await ctx.answerOnCallback(notification ? { message: { text: notification } } : {});
  } catch {
    // Устаревший callback — не повод ронять обработку.
  }
}
