import { Bot, Keyboard, type Context } from '@maxhub/max-bot-api';
import type { City } from '../data/repos.js';
import { setDigestOptin } from '../data/repos.js';
import { ack, screen, stateOf, withState } from './context.js';
import { kb, mainMenu, periodRows } from './keyboards.js';
import { registerContribute } from './scenes/contribute.js';
import { registerDiscover } from './scenes/discover.js';
import { registerOnboarding } from './scenes/onboarding.js';
import { registerVerify } from './scenes/verify.js';
import { situationsOf } from '../services/recommend.js';

const { callback } = Keyboard.button;

const GREETING =
  'Привет! Я помогаю находить в Казани места и события, куда правда можно попасть.\n\n' +
  'Вместо значка «доступно» — конкретика: ступени на входе, лифт, туалет, места ' +
  'для колясок, перевод на РЖЯ. И всегда видно, откуда эти сведения и когда их проверяли.';

export function createBot(token: string, city: City): Bot<Context> {
  const bot = new Bot(token);

  bot.use(withState(city));

  bot.command('start', async (ctx) => {
    const { user } = stateOf(ctx);
    await screen(ctx, GREETING, kb(mainMenu(situationsOf(user).length > 0)));
  });

  bot.on('bot_started', async (ctx) => {
    const { user } = stateOf(ctx);
    await screen(ctx, GREETING, kb(mainMenu(situationsOf(user).length > 0)));
  });

  bot.command(['help', 'помощь'], async (ctx) => {
    await screen(ctx, 
      'Вот что я умею:\n\n' +
        '• искать события, которые тебе подойдут — «Подобрать, куда сходить»\n' +
        '• учитывать всю компанию сразу — «Идём компанией»\n' +
        '• сохранить то, что ты знаешь о месте — «Рассказать о месте»\n\n' +
        'Откуда я беру события: афиша KudaGo, обновляю её каждый час.\n' +
        'Откуда сведения о доступности: часть собрали мы, часть — посетители. ' +
        'Под каждой карточкой написано, кто это проверял и когда.\n\n' +
        '/start — начать сначала, /profile — изменить, что для тебя важно.',
      kb([[callback('🏠 В начало', 'menu')]]),
    );
  });

  bot.command(['profile', 'профиль'], async (ctx) => {
    await screen(
      ctx,
      'Давай уточним, что для тебя важно.',
      kb([[callback('⚙️ Изменить профиль', 'onb:start')]]),
    );
  });

  bot.action('menu', async (ctx) => {
    await ack(ctx);
    const { user } = stateOf(ctx);
    await screen(ctx, 'Чем могу помочь?', kb(mainMenu(situationsOf(user).length > 0)));
  });

  bot.action('digest:off', async (ctx) => {
    const { user } = stateOf(ctx);
    await setDigestOptin(user.maxUserId, false);
    await ack(ctx, 'Хорошо, не буду писать');
    await screen(
      ctx,
      'Больше не напоминаю о выходных. Если передумаешь — набери /start.',
      kb(periodRows()),
    );
  });

  registerOnboarding(bot);
  registerDiscover(bot);
  registerContribute(bot);
  registerVerify(bot);

  // Текст вне сценария: подсказываем, а не молчим.
  bot.on('message_created', async (ctx) => {
    const { user } = stateOf(ctx);
    await screen(ctx, 
      'Я отвечаю на кнопки — так надёжнее. Выбери, с чего начнём.',
      kb(mainMenu(situationsOf(user).length > 0)),
    );
  });

  /** Ни одна ошибка не должна оставлять человека в тупике. */
  bot.catch(async (error, ctx) => {
    console.error('Ошибка обработки:', error);
    try {
      await ack(ctx);
      await screen(ctx, 
        'Что-то сломалось на моей стороне. Ничего не потерялось — попробуем ещё раз.',
        kb([[callback('🏠 В начало', 'menu')]]),
      );
    } catch (replyError) {
      console.error('Не удалось сообщить об ошибке:', replyError);
    }
  });

  return bot;
}
