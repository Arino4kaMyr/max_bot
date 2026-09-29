import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { createBot } from './bot/index.js';
import { askAfterEvents, sendWeekendDigest } from './bot/jobs.js';
import { CITY_NAMES, loadEnv } from './config/env.js';
import { closeDb, connectDb, migrate, waitForDb } from './data/db.js';
import { ensureCity } from './data/repos.js';
import { seedIfEmpty } from './data/seed.js';
import { syncCity } from './sync/kudago.js';

// API платформы MAX работает на сертификате НУЦ Минцифры, которого нет
// в наборе доверенных сертификатов Node. Без него соединение падает с
// UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Подключаем сертификаты до первого вызова.
ensureCaBundle();

const env = loadEnv();
const cityName = CITY_NAMES[env.CITY_SLUG] ?? env.CITY_SLUG;

const sql = connectDb(env.DATABASE_URL);
await waitForDb(sql);
await migrate(sql);

const city = await ensureCity(env.CITY_SLUG, cityName, env.CITY_TZ);
await seedIfEmpty(env.CITY_SLUG);

const bot = createBot(env.BOT_TOKEN, city);

// Первая синхронизация — в фоне: бот должен отвечать сразу, даже если
// внешний источник тормозит или недоступен.
void runSync('стартовая');

const syncJob = cron.schedule(env.SYNC_CRON, () => void runSync('плановая'));
const digestJob = cron.schedule(env.DIGEST_CRON, async () => {
  const sent = await sendWeekendDigest(bot.api, city);
  console.log(`Сводка на выходные отправлена: ${sent}`);
});
// Вопросы после событий — раз в час, отдельно от афиши.
const askJob = cron.schedule('30 * * * *', async () => {
  const asked = await askAfterEvents(bot.api, city);
  if (asked > 0) console.log(`Вопросов после событий отправлено: ${asked}`);
});

async function runSync(kind: string): Promise<void> {
  try {
    const result = await syncCity(env.CITY_SLUG, cityName, env.CITY_TZ);
    console.log(
      `Синхронизация (${kind}): событий ${result.events}, новых площадок ${result.venuesCreated}, пропущено ${result.skipped}`,
    );
  } catch (error) {
    // Источник недоступен — работаем на сохранённых данных.
    console.error(`Синхронизация (${kind}) не удалась, работаем на данных из базы:`, error);
  }
}

// Проверяем доступность MAX до запуска опроса: так понятна причина,
// если токен неверен или сети нет.
const me = await withRetry(() => bot.api.getMyInfo(), 'подключение к MAX');
console.log(`Бот @${me.username} запущен. Город: ${cityName} (${env.CITY_SLUG}).`);

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Опрос обновлений не возвращает управление — запускаем без await.
void bot.start().catch((error) => {
  console.error('Опрос обновлений остановлен:', error);
  process.exitCode = 1;
});

/**
 * Сеть до MAX может моргнуть на старте — это не повод падать.
 * Контейнер, который умирает при первом же сбое, теряет и работающую базу.
 */
async function withRetry<T>(action: () => Promise<T>, what: string, attempts = 10): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt === attempts) throw error;
      const delay = Math.min(30, 2 ** attempt);
      console.error(`Не удалось: ${what} (попытка ${attempt}/${attempts}), повтор через ${delay} с:`, error);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
  }
  throw new Error('unreachable');
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Получен ${signal}, останавливаюсь…`);
  syncJob.stop();
  digestJob.stop();
  askJob.stop();
  bot.stopPolling();
  await closeDb();
  process.exit(0);
}

/**
 * NODE_EXTRA_CA_CERTS читается Node только при запуске процесса, поэтому
 * задать её из кода нельзя — приходится один раз перезапуститься с ней.
 * В Docker переменная задана в образе, и перезапуск не происходит.
 */
function ensureCaBundle(): void {
  if (process.env.NODE_EXTRA_CA_CERTS || process.env.CA_BUNDLE_APPLIED) return;

  const here = dirname(fileURLToPath(import.meta.url));
  const bundle = resolve(join(here, '..', 'certs', 'max-ru-ca.pem'));
  if (!existsSync(bundle)) return;

  // execArgv сохраняет загрузчики (например, tsx) при перезапуске.
  const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: bundle, CA_BUNDLE_APPLIED: '1' },
  });
  process.exit(result.status ?? 0);
}
