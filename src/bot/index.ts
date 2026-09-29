import { Bot, Keyboard, type Context } from '@maxhub/max-bot-api';
import type { City } from '../data/repos.js';
import { setDigestOptin } from '../data/repos.js';
import { ack, stateOf, withState } from './context.js';
import { kb, mainMenu, periodRows } from './keyboards.js';
import { registerContribute } from './scenes/contribute.js';
import { registerDiscover } from './scenes/discover.js';
import { registerOnboarding } from './scenes/onboarding.js';
import { registerVerify } from './scenes/verify.js';
import { situationsOf } from '../services/recommend.js';

const { callback } = Keyboard.button;

const GREETING =
  'Привет! Я помогаю находить места и события в Казани, куда реально можно попасть.\n\n' +
  'Показываю не значок «доступно», а что именно есть на площадке: ступени на входе, ' +
  'лифт, туалет, места для колясок, перевод на РЖЯ. И всегда пишу, откуда эти данные.';

export function createBot(token: string, city: City): Bot<Context> {
  const bot = new Bot(token);

  bot.use(withState(city));

  bot.command('start', async (ctx) => {
    const { user } = stateOf(ctx);
    await ctx.reply(GREETING, kb(mainMenu(situationsOf(user).length > 0)));
  });

  bot.on('bot_started', async (ctx) => {
    const { user } = stateOf(ctx);
    await ctx.reply(GREETING, kb(mainMenu(situationsOf(user).length > 0)));
  });

  bot.command(['help', 'помощь'], async (ctx) => {
    await ctx.reply(
      'Что я умею:\n\n' +
        '• подобрать события под твои потребности — «Подобрать, куда сходить»\n' +
        '• собрать профиль компании — «Идём компанией»\n' +
        '• принять данные о доступности от тебя — «Помочь с данными»\n\n' +
        'Команды: /start — начать заново, /profile — изменить профиль.',
      kb([[callback('🏠 В начало', 'menu')]]),
    );
  });

  bot.command(['profile', 'профиль'], async (ctx) => {
    await ctx.reply('Настроим профиль заново.', kb([[callback('⚙️ Изменить профиль', 'onb:start')]]));
  });

  bot.action('menu', async (ctx) => {
    await ack(ctx);
    const { user } = stateOf(ctx);
    await ctx.reply('Чем помочь?', kb(mainMenu(situationsOf(user).length > 0)));
  });

  bot.action('digest:off', async (ctx) => {
    const { user } = stateOf(ctx);
    await setDigestOptin(user.maxUserId, false);
    await ack(ctx, 'Больше не пишу');
    await ctx.reply('Хорошо, напоминания выключил. Включить обратно — /start.', kb(periodRows()));
  });

  registerOnboarding(bot);
  registerDiscover(bot);
  registerContribute(bot);
  registerVerify(bot);

  // Текст вне сценария: подсказываем, а не молчим.
  bot.on('message_created', async (ctx) => {
    const { user } = stateOf(ctx);
    await ctx.reply(
      'Я понимаю кнопки — так быстрее и меньше шансов ошибиться.',
      kb(mainMenu(situationsOf(user).length > 0)),
    );
  });

  /** Ни одна ошибка не должна оставлять человека в тупике. */
  bot.catch(async (error, ctx) => {
    console.error('Ошибка обработки:', error);
    try {
      await ack(ctx);
      await ctx.reply(
        'Что-то пошло не так с моей стороны. Данные не потерялись — давай попробуем снова.',
        kb([[callback('🏠 В начало', 'menu')]]),
      );
    } catch (replyError) {
      console.error('Не удалось сообщить об ошибке:', replyError);
    }
  });

  return bot;
}
