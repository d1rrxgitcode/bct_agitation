require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./db');

const authRoutes = require('./routes/auth');
const lookupRoutes = require('./routes/lookups');
const personnelRoutes = require('./routes/personnel');
const docsRoutes = require('./routes/docs');
const activityRoutes = require('./routes/activities');
const adminRoutes = require('./routes/admin');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'change-this-secret-in-.env',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true',
    },
  })
);

// API
app.use('/api/auth', authRoutes);
app.use('/api', lookupRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/session-check', requireAuth, (req, res) => res.json({ ok: true }));

// Статика
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Единый обработчик ошибок API (ловит и async-ошибки через express-async-errors)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (err.code === '23505') return res.status(409).json({ error: 'Такое значение уже существует' });
  if (err.code === '23503') return res.status(409).json({ error: 'Запись связана с другими данными — сначала удалите их' });
  res.status(500).json({ error: 'Ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`✓ Сервер запущен: http://localhost:${PORT}`);
});
