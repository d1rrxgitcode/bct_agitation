-- ============================================================
--  Схема БД: Учётная система личного состава
--  PostgreSQL 13+
-- ============================================================

-- Внутренние подразделения корпуса (не само формирование «91-й корпус»)
CREATE TABLE IF NOT EXISTS units (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ranks (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0
);

-- Военные должности (Командир 91, зам. командира, …). Не путать с привилегией в users.role.
CREATE TABLE IF NOT EXISTS positions (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0
);

-- Привилегия доступа (модерация): commander, deputy, moderator, member
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('commander','deputy','moderator','member')),
  personnel_id   INT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personnel (
  id                SERIAL PRIMARY KEY,
  idn               CHAR(4) NOT NULL UNIQUE,
  callsign          TEXT NOT NULL,
  rank_id           INT REFERENCES ranks(id) ON DELETE SET NULL,
  position_id       INT REFERENCES positions(id) ON DELETE SET NULL,
  unit_id           INT REFERENCES units(id) ON DELETE SET NULL,
  steam_id          TEXT,
  discord           TEXT,
  activity          TEXT,                -- произвольная метка активности
  mercenary         BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'АКТИВЕН',
  affiliation       TEXT NOT NULL DEFAULT 'ГАЛАКТИЧЕСКАЯ РЕСПУБЛИКА',
  subordination     TEXT NOT NULL DEFAULT 'ВЕЛИКАЯ АРМИЯ РЕСПУБЛИКИ',
  formation         TEXT NOT NULL DEFAULT '91-й разведывательный корпус',
  specialization    TEXT,                -- Специализация(и), через запятую
  awards            TEXT[] NOT NULL DEFAULT '{}',  -- Внутренние награды
  service_date      DATE,                -- Дата создания/поступления на службу
  corps_join_date   DATE,                -- Дата зачисления в корпус/подразделение
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT fk_users_personnel
    FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rank_history (
  id            SERIAL PRIMARY KEY,
  personnel_id  INT NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  rank_id       INT NOT NULL REFERENCES ranks(id) ON DELETE CASCADE,
  awarded_at    DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Категории документации: гибкая приватность
-- visibility: 'all' | 'command_mod' | 'unit' | 'custom'
CREATE TABLE IF NOT EXISTS doc_categories (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  parent_id      INT NULL REFERENCES doc_categories(id) ON DELETE CASCADE,
  visibility     TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','command_mod','unit','custom')),
  visible_unit_id INT NULL REFERENCES units(id) ON DELETE SET NULL,
  visible_roles  TEXT[] NULL,          -- используется при visibility = 'custom'
  sort_order     INT NOT NULL DEFAULT 0,
  created_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  category_id   INT NOT NULL REFERENCES doc_categories(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  created_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Журнал активностей для дашборда
CREATE TABLE IF NOT EXISTS activities (
  id            SERIAL PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('agitation','training','recon','combat')),
  title         TEXT NOT NULL,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  conducted_by  INT REFERENCES users(id) ON DELETE SET NULL,
  personnel_id  INT REFERENCES personnel(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personnel_idn ON personnel(idn);
CREATE INDEX IF NOT EXISTS idx_personnel_unit ON personnel(unit_id);
CREATE INDEX IF NOT EXISTS idx_activities_type_date ON activities(type, activity_date);
