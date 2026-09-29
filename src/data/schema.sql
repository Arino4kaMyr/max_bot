-- Схема создаётся идемпотентно при старте приложения.
-- Города, площадки и события — переменная часть; словарь признаков живёт в коде.

CREATE TABLE IF NOT EXISTS cities (
  id    SERIAL PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  tz    TEXT NOT NULL DEFAULT 'Europe/Moscow'
);

CREATE TABLE IF NOT EXISTS venues (
  id               SERIAL PRIMARY KEY,
  city_id          INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  address          TEXT,
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  kudago_place_id  INTEGER UNIQUE,
  status           TEXT NOT NULL DEFAULT 'unmapped',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS venues_city_idx ON venues(city_id);

-- Атомарный факт о признаке площадки. Основа всего остального:
-- свежести, доверия, верификации и генерации карточки.
CREATE TABLE IF NOT EXISTS venue_features (
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT 'unknown',
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'user',
  agree       INTEGER NOT NULL DEFAULT 0,
  disagree    INTEGER NOT NULL DEFAULT 0,
  checked_at  TIMESTAMPTZ,
  PRIMARY KEY (venue_id, key)
);

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  city_id     INTEGER NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  venue_id    INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  price       TEXT,
  is_free     BOOLEAN NOT NULL DEFAULT false,
  category    TEXT,
  source      TEXT NOT NULL DEFAULT 'kudago',
  source_url  TEXT NOT NULL,
  external_id TEXT NOT NULL,
  is_permanent BOOLEAN NOT NULL DEFAULT false,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id, starts_at)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS events_lookup_idx ON events(city_id, starts_at);

-- Переопределение признака для конкретного события:
-- экскурсия с тифлокомментированием в месте, где его обычно нет.
CREATE TABLE IF NOT EXISTS event_overrides (
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  note      TEXT,
  PRIMARY KEY (event_id, key)
);

CREATE TABLE IF NOT EXISTS users (
  max_user_id   BIGINT PRIMARY KEY,
  name          TEXT,
  city_id       INTEGER REFERENCES cities(id) ON DELETE SET NULL,
  -- ситуации самого пользователя: ["wheelchair", "companion"]
  situations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- групповой профиль: [["wheelchair"], ["stroller"], ["stairs_hard"]]
  group_profile JSONB,
  digest_optin  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Состояние диалога хранится в базе, а не в памяти процесса:
-- перезапуск контейнера не теряет прогресс онбординга.
CREATE TABLE IF NOT EXISTS user_sessions (
  max_user_id BIGINT PRIMARY KEY REFERENCES users(max_user_id) ON DELETE CASCADE,
  scene       TEXT,
  step        INTEGER NOT NULL DEFAULT 0,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один пользователь — один голос по каждому признаку каждой площадки.
CREATE TABLE IF NOT EXISTS verifications (
  max_user_id BIGINT NOT NULL REFERENCES users(max_user_id) ON DELETE CASCADE,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  answer      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (max_user_id, venue_id, key)
);

CREATE TABLE IF NOT EXISTS venue_photos (
  id          SERIAL PRIMARY KEY,
  venue_id    INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  max_user_id BIGINT REFERENCES users(max_user_id) ON DELETE SET NULL,
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'entrance',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- «Я пойду» — отсюда берутся адресаты вопросов после события.
CREATE TABLE IF NOT EXISTS attendance (
  max_user_id BIGINT NOT NULL REFERENCES users(max_user_id) ON DELETE CASCADE,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  asked_at    TIMESTAMPTZ,
  PRIMARY KEY (max_user_id, event_id)
);
