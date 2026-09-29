import { z } from 'zod';

/** Окружение валидируется при старте: лучше упасть сразу, чем на первом апдейте. */
const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN не задан — бот не сможет подключиться к MAX'),
  DATABASE_URL: z.string().min(1),
  CITY_SLUG: z.string().default('kzn'),
  CITY_TZ: z.string().default('Europe/Moscow'),
  SYNC_CRON: z.string().default('0 * * * *'),
  DIGEST_CRON: z.string().default('0 12 * * 4'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректное окружение:\n${problems.join('\n')}`);
  }
  return parsed.data;
}

export const CITY_NAMES: Record<string, string> = {
  kzn: 'Казань',
  msk: 'Москва',
  spb: 'Санкт-Петербург',
  ekb: 'Екатеринбург',
  nnv: 'Нижний Новгород',
};
