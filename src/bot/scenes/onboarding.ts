/**
 * Онбординг: профиль собирается через ситуацию, а не через диагноз.
 *
 * Человек должен узнать себя в формулировке, не причисляя себя к категории.
 */

import type { Composer, Context } from '@maxhub/max-bot-api';
import { isSituation, SITUATION_DEFS, type Situation } from '../../domain/profile.js';
import { saveGroupProfile, saveSituations } from '../../data/repos.js';
import { ack, patchPayload, setScene, stateOf } from '../context.js';
import { HOME_ROW, kb, mainMenu, periodRows, situationRows } from '../keyboards.js';

const INTRO =
  'Привет! Я помогаю находить места и события в Казани, куда реально можно попасть.\n\n' +
  'Подбираю не по значку «доступно», а по тому, что важно именно тебе: ' +
  'ступени на входе, лифт, туалет, места для колясок, перевод на РЖЯ.';

const ASK = 'Что для тебя важно при выборе места?\n\nМожно выбрать несколько.';

export function registerOnboarding(bot: Composer<Context>): void {
  bot.action('onb:start', async (ctx) => {
    await ack(ctx);
    const { user } = stateOf(ctx);
    await setScene(ctx, 'onboarding', { situations: user.situations ?? [] });
    await ctx.reply(ASK, kb([...situationRows(user.situations ?? [], 'onb'), HOME_ROW]));
  });

  bot.action(/^onb:sit:(.+)$/, async (ctx) => {
    const id = ctx.match?.[1];
    if (!id || !isSituation(id)) return ack(ctx);

    const { session } = stateOf(ctx);
    const current = (session.payload.situations as Situation[] | undefined) ?? [];
    const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
    await patchPayload(ctx, { situations: next });
    await ack(ctx);

    await ctx.editMessage({
      text: ASK,
      attachments: kb([...situationRows(next, 'onb'), HOME_ROW]).attachments,
    });
  });

  bot.action('onb:done', async (ctx) => {
    await ack(ctx);
    const { user, session } = stateOf(ctx);
    const situations = (session.payload.situations as Situation[] | undefined) ?? [];

    await saveSituations(user.maxUserId, situations);
    user.situations = situations;
    user.groupProfile = null;
    await setScene(ctx, null);

    await ctx.reply(profileSummary(situations), kb(periodRows()));
  });

  // --- компания ---

  bot.action('grp:start', async (ctx) => {
    await ack(ctx);
    await setScene(ctx, 'group', { members: [], current: [] });
    await ctx.reply(
      'Собираем компанию. Расскажи про первого участника — что для него важно?',
      kb([...situationRows([], 'grp'), HOME_ROW]),
    );
  });

  bot.action(/^grp:sit:(.+)$/, async (ctx) => {
    const id = ctx.match?.[1];
    if (!id || !isSituation(id)) return ack(ctx);

    const { session } = stateOf(ctx);
    const current = (session.payload.current as Situation[] | undefined) ?? [];
    const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
    await patchPayload(ctx, { current: next });
    await ack(ctx);

    const members = (session.payload.members as Situation[][] | undefined) ?? [];
    await ctx.editMessage({
      text: memberPrompt(members.length),
      attachments: kb([
        ...situationRows(next, 'grp'),
        [{ type: 'callback', text: '👤 Следующий участник', payload: 'grp:next' }],
        [{ type: 'callback', text: '✅ Все в сборе', payload: 'grp:finish' }],
        ...[HOME_ROW],
      ]).attachments,
    });
  });

  bot.action('grp:next', async (ctx) => {
    await ack(ctx);
    const { session } = stateOf(ctx);
    const members = (session.payload.members as Situation[][] | undefined) ?? [];
    const current = (session.payload.current as Situation[] | undefined) ?? [];

    const updated = current.length ? [...members, current] : members;
    await patchPayload(ctx, { members: updated, current: [] });

    await ctx.reply(memberPrompt(updated.length), kb([
      ...situationRows([], 'grp'),
      [{ type: 'callback', text: '✅ Все в сборе', payload: 'grp:finish' }],
      HOME_ROW,
    ]));
  });

  bot.action(['grp:finish', 'grp:done'], async (ctx) => {
    await ack(ctx);
    const { user, session } = stateOf(ctx);
    const members = (session.payload.members as Situation[][] | undefined) ?? [];
    const current = (session.payload.current as Situation[] | undefined) ?? [];
    const all = current.length ? [...members, current] : members;

    if (all.length === 0) {
      await setScene(ctx, null);
      await ctx.reply('Никого не добавили — вернёмся в начало.', kb(mainMenu(false)));
      return;
    }

    await saveGroupProfile(user.maxUserId, all);
    user.groupProfile = all;
    await setScene(ctx, null);

    await ctx.reply(groupSummary(all), kb(periodRows()));
  });
}

function memberPrompt(index: number): string {
  return `Участник №${index + 1}. Что для него важно?\n\nМожно выбрать несколько или сразу нажать «Все в сборе».`;
}

export function profileSummary(situations: Situation[]): string {
  if (situations.length === 0) {
    return (
      'Профиль пустой — буду показывать всё подряд.\n' +
      'Заполнить можно в любой момент: «Мой профиль».\n\nЧто ищем?'
    );
  }
  const list = situations.map((s) => `• ${SITUATION_DEFS[s].label}`).join('\n');
  return `Запомнил:\n${list}\n\nТеперь подбираю только то, что тебе подходит.\n\nЧто ищем?`;
}

export function groupSummary(members: Situation[][]): string {
  const list = members
    .map((m, i) => `• Участник ${i + 1}: ${m.map((s) => SITUATION_DEFS[s].short).join(', ') || 'без ограничений'}`)
    .join('\n');
  return (
    `Компания из ${members.length}:\n${list}\n\n` +
    'Ищу места, куда сможете попасть все — требования участников объединяются.\n\nЧто ищем?'
  );
}
