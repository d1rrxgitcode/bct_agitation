require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');

  console.log('→ Применяю schema.sql ...');
  await pool.query(schema);

  console.log('→ Применяю seed.sql (справочники по умолчанию) ...');
  await pool.query(seed);

  console.log('→ Применяю точечные обновления схемы ...');
  await pool.query(`
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS personnel_id INT REFERENCES personnel(id) ON DELETE SET NULL;
    ALTER TABLE personnel ALTER COLUMN formation SET DEFAULT '91-й разведывательный корпус';
    UPDATE personnel SET formation = '91-й разведывательный корпус'
      WHERE formation IS NULL OR TRIM(formation) = '';
  `);

  // Гибкие категории деятельности вместо жёсткого списка type
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_types (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      sort_order  INT NOT NULL DEFAULT 0
    );
    INSERT INTO activity_types (name, sort_order) VALUES
      ('Агитация', 1), ('Тренировка', 2), ('Разведка', 3), ('Боевые действия', 4)
    ON CONFLICT (name) DO NOTHING;

    CREATE TABLE IF NOT EXISTS activity_participants (
      activity_id   INT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      personnel_id  INT NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
      PRIMARY KEY (activity_id, personnel_id)
    );
    CREATE TABLE IF NOT EXISTS activity_images (
      id          SERIAL PRIMARY KEY,
      activity_id INT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      path        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE activities ADD COLUMN IF NOT EXISTS type_id INT REFERENCES activity_types(id) ON DELETE SET NULL;
    ALTER TABLE activities ADD COLUMN IF NOT EXISTS conductor_id INT REFERENCES personnel(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_activities_type_date ON activities(type_id, activity_date);
    CREATE INDEX IF NOT EXISTS idx_activity_participants_personnel ON activity_participants(personnel_id);
    CREATE INDEX IF NOT EXISTS idx_activity_images_activity ON activity_images(activity_id);
  `);

  const hasColumn = async (col) => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name='activities' AND column_name=$1`, [col]
    );
    return rows.length > 0;
  };

  if (await hasColumn('type')) {
    await pool.query(`
      UPDATE activities a SET type_id = t.id
        FROM activity_types t
       WHERE a.type_id IS NULL
         AND lower(t.name) = CASE a.type
               WHEN 'agitation' THEN 'агитация'
               WHEN 'training'  THEN 'тренировка'
               WHEN 'recon'     THEN 'разведка'
               WHEN 'combat'    THEN 'боевые действия'
             END;

      INSERT INTO activity_types (name)
      SELECT DISTINCT a.type FROM activities a
       WHERE a.type IS NOT NULL AND a.type_id IS NULL
      ON CONFLICT (name) DO NOTHING;

      UPDATE activities a SET type_id = t.id
        FROM activity_types t
       WHERE a.type_id IS NULL AND a.type IS NOT NULL AND t.name = a.type;

      ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
      ALTER TABLE activities DROP COLUMN type;
    `);
  }

  if (await hasColumn('personnel_id')) {
    await pool.query(`
      INSERT INTO activity_participants (activity_id, personnel_id)
      SELECT id, personnel_id FROM activities WHERE personnel_id IS NOT NULL
      ON CONFLICT DO NOTHING;
      ALTER TABLE activities DROP COLUMN personnel_id;
    `);
  }

  // 91-й корпус — формирование, а не внутреннее подразделение
  await pool.query(`
    UPDATE personnel p SET unit_id = NULL
      FROM units u
     WHERE p.unit_id = u.id
       AND (u.name ILIKE '%91%разведывательн%' OR u.name ILIKE '%91-й разведывательн%');
    DELETE FROM units
     WHERE name ILIKE '%91%разведывательн%' OR name = '91-й разведывательный корпус';
  `);

  // «Модератор» — привилегия, не военная должность
  await pool.query(`
    UPDATE personnel SET position_id = NULL
     WHERE position_id IN (SELECT id FROM positions WHERE name = 'Модератор');
    DELETE FROM positions WHERE name = 'Модератор';
  `);

  const adminUser = process.env.ADMIN_USERNAME || 'commander';
  const adminPass = process.env.ADMIN_PASSWORD || 'change-me-please';

  const existing = await pool.query('SELECT id FROM users WHERE username=$1', [adminUser]);
  if (existing.rowCount === 0) {
    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)',
      [adminUser, hash, 'commander']
    );
    console.log(`→ Создан пользователь-командир: "${adminUser}" / "${adminPass}"`);
    console.log('  ⚠ Обязательно смените пароль после первого входа (Админ-панель → Пользователи).');
  } else {
    console.log(`→ Пользователь "${adminUser}" уже существует, пропускаю создание.`);
  }

  console.log('✓ Миграция завершена.');
  await pool.end();
}

run().catch((err) => {
  console.error('Ошибка миграции:', err);
  process.exit(1);
});
