// ---------- Тема ----------
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme(checked) {
  const theme = checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}
initTheme();

// ---------- API-хелпер ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* пусто */ }
  if (!res.ok) throw new Error((data && data.error) || 'Ошибка запроса');
  return data;
}

const ROLE_LABELS = {
  commander: 'Командир',
  deputy: 'Заместитель командира',
  moderator: 'Модератор',
  member: 'Военнослужащий',
};
const CAN_EDIT_ROSTER = ['commander', 'deputy', 'moderator'];
const CAN_ADMIN = ['commander', 'deputy'];
const FORMATION_NAME = '91-й разведывательный корпус';
const ACTIVITY_TYPES = [
  { id: 'agitation', label: 'Агитация' },
  { id: 'training', label: 'Тренировка' },
  { id: 'recon', label: 'Разведка' },
  { id: 'combat', label: 'Боевые действия' },
];

let CURRENT_USER = null;

async function requireSession() {
  try {
    const { user } = await api('/auth/me');
    CURRENT_USER = user;
    return user;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

function renderShell(activePage) {
  const shell = document.getElementById('app-shell');
  const canEdit = CAN_EDIT_ROSTER.includes(CURRENT_USER.role);
  const canAdmin = CAN_ADMIN.includes(CURRENT_USER.role);
  const savedTheme = localStorage.getItem('theme') || 'light';

  const links = [
    { id: 'dashboard', href: '/index.html', label: 'Дашборд' },
    { id: 'roster', href: '/roster.html', label: 'Состав' },
    { id: 'docs', href: '/docs.html', label: 'Документация' },
  ];
  if (canAdmin) links.push({ id: 'admin', href: '/admin.html', label: 'Админ-панель' });

  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <img src="/img/emblem.png" alt="91" class="brand-emblem">
        91-Й РАЗВЕДЫВАТЕЛЬНЫЙ КОРПУС<small>Учётная система личного состава</small>
      </div>
      ${links.map(l => `<a class="nav-link ${l.id === activePage ? 'active' : ''}" href="${l.href}">${l.label}</a>`).join('')}
      <a class="nav-link" href="/profile.html?id=${CURRENT_USER.personnel_id || ''}">Моё личное дело</a>
      <div class="sidebar-footer">
        <div class="theme-toggle">
          <span>Тёмная тема</span>
          <label class="switch">
            <input type="checkbox" id="theme-switch" ${savedTheme === 'dark' ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>
        <div class="nav-link" style="justify-content:space-between">
          <span>${CURRENT_USER.username} <span class="role-pill">${ROLE_LABELS[CURRENT_USER.role]}</span></span>
        </div>
        <button id="logout-btn" style="width:100%">Выйти</button>
      </div>
    </aside>
    <main class="main" id="main-content"></main>
  `;

  document.getElementById('theme-switch').addEventListener('change', (e) => toggleTheme(e.target.checked));
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

// ---------- Модальные окна (общие для всех страниц) ----------
function openModal(html, opts = {}) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.id = 'modal-backdrop';
  back.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}">${html}</div>`;
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  document.body.appendChild(back);
}
function closeModal() {
  const el = document.getElementById('modal-backdrop');
  if (el) el.remove();
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

function fmtDate(d) {
  if (!d) return '—';
  const s = isoDate(d);
  const [y, m, day] = s.split('-');
  if (!y || !m || !day) return s;
  return `${day}.${m}.${y}`;
}

function openActivityModal(opts = {}) {
  const title = opts.title || 'Записать активность';
  const onSaved = opts.onSaved || (() => {});
  openModal(`
    <h2>${escapeHtml(title)}</h2>
    <p class="hint" style="margin-top:0">Запись попадает в журнал дашборда. Заполнять может каждый военнослужащий.</p>
    <div class="field"><label>Тип</label>
      <select id="act-type">${ACTIVITY_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Название</label><input id="act-title" placeholder="Например: Патруль сектора 7"></div>
    <div class="field"><label>Дата</label><input type="date" id="act-date" value="${localToday()}"></div>
    <div class="field"><label>Заметки</label><textarea id="act-notes" rows="3"></textarea></div>
    <div class="error-msg" id="act-error" style="display:none"></div>
    <div class="modal-actions">
      <button type="button" onclick="closeModal()">Отмена</button>
      <button class="btn-primary" type="button" id="act-save">Сохранить</button>
    </div>
  `);
  document.getElementById('act-save').addEventListener('click', async () => {
    try {
      const body = {
        type: document.getElementById('act-type').value,
        title: document.getElementById('act-title').value,
        activity_date: document.getElementById('act-date').value,
        notes: document.getElementById('act-notes').value,
      };
      if (opts.personnel_id) body.personnel_id = opts.personnel_id;
      await api('/activities', { method: 'POST', body });
      closeModal();
      onSaved();
    } catch (e) {
      const err = document.getElementById('act-error');
      err.textContent = e.message;
      err.style.display = 'block';
    }
  });
}
