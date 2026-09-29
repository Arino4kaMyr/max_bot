import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export type Sql = postgres.Sql;

let client: Sql | undefined;

export function db(): Sql {
  if (!client) throw new Error('База не инициализирована — вызовите connectDb()');
  return client;
}

export function connectDb(url: string): Sql {
  client = postgres(url, { max: 10, onnotice: () => {} });
  return client;
}

export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
}

/** Схема применяется идемпотентно при каждом старте. */
export async function migrate(sql: Sql): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const ddl = await readFile(join(here, 'schema.sql'), 'utf8');
  await sql.unsafe(ddl);
}

/** Ждёт готовности базы — в docker compose приложение стартует раньше неё. */
export async function waitForDb(sql: Sql, attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (error) {
      if (i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
