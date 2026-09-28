-- Базовые звания (можно редактировать через «Состав → Звания / должности / подразделения»)
INSERT INTO ranks (name, sort_order) VALUES
  ('PVT', 1), ('PFC', 2), ('CPL', 3), ('JSG', 4), ('SGT', 5),
  ('HSG', 6), ('LT', 7), ('SLT', 8), ('CPT', 9)
ON CONFLICT (name) DO NOTHING;

-- Военные должности (не привилегии доступа)
INSERT INTO positions (name, sort_order) VALUES
  ('Командир 91', 1),
  ('Заместитель командира 91', 2),
  ('Военнослужащий', 3)
ON CONFLICT (name) DO NOTHING;

-- Подразделения создаются командованием; формирование (91-й корпус) — не подразделение.
-- Базовая категория документации (видна всем)
INSERT INTO doc_categories (name, visibility, sort_order)
SELECT 'Общая документация', 'all', 1
WHERE NOT EXISTS (SELECT 1 FROM doc_categories WHERE name = 'Общая документация');
