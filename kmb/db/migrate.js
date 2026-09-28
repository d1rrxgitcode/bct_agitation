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
