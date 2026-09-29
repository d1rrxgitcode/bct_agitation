// ---------- Тема ----------
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme(checked) {
  const theme = checked ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  window.dispatchEvent(new Event('themechange'));
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

// Категории деятельности хранятся в БД и создаются командованием
let ACTIVITY_TYPES = [];
// Контрастные палитры: серые тона сливались с фоном в тёмной теме
const TYPE_PALETTE_LIGHT = ['#1d4ed8', '#b91c1c', '#15803d', '#a21caf', '#b45309', '#0f766e', '#be185d', '#4d7c0f'];
const TYPE_PALETTE_DARK = ['#60a5fa', '#f87171', '#4ade80', '#e879f9', '#fbbf24', '#2dd4bf', '#f472b6', '#a3e635'];

async function loadActivityTypes(force = false) {
  if (!force && ACTIVITY_TYPES.length) return ACTIVITY_TYPES;
  try {
    ACTIVITY_TYPES = await api('/activity-types');
  } catch (e) {
    ACTIVITY_TYPES = [];
  }
  return ACTIVITY_TYPES;
}

function typeLabel(id) {
  if (id === null || id === undefined) return 'Без категории';
  const t = ACTIVITY_TYPES.find(x => String(x.id) === String(id));
  return t ? t.name : 'Без категории';
}

function typeColor(index) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const palette = dark ? TYPE_PALETTE_DARK : TYPE_PALETTE_LIGHT;
  return palette[index % palette.length];
}

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
    { id: 'activity', href: '/activity.html', label: 'Активность' },
    { id: 'docs', href: '/docs.html', label: 'Документация' },
  ];
  if (canAdmin) links.push({ id: 'admin', href: '/admin.html', label: 'Админ-панель' });

  shell.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
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
  back.innerHTML = `<div class="modal${opts.wide ? ' wide' : ''}${opts.modalClass ? ' ' + opts.modalClass : ''}">${html}</div>`;
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
  const editing = opts.activity || null;
  const title = opts.title || (editing ? 'Редактирование активности' : 'Записать активность');
  const onSaved = opts.onSaved || (() => {});
  const canEdit = CURRENT_USER && CAN_EDIT_ROSTER.includes(CURRENT_USER.role);

  (async () => {
    const [types, personnel] = await Promise.all([loadActivityTypes(true), api('/personnel')]);
    const images = [];
    const existingImages = editing ? (editing.images || []).map(im => ({ id: im.id, path: im.path })) : [];
    const removedImageIds = [];
    const preselect = new Set(
      editing
        ? (editing.participants || []).map(p => String(p.id))
        : (opts.participant_ids || []).map(String)
    );
    if (!editing && !preselect.size && CURRENT_USER && CURRENT_USER.personnel_id) {
      preselect.add(String(CURRENT_USER.personnel_id));
    }
    const conductorDefault = String(opts.conductor_id || (editing ? editing.conductor_id : CURRENT_USER?.personnel_id) || '');

    openModal(`
      <h2>${escapeHtml(title)}</h2>
      <p class="hint" style="margin-top:0">${editing
        ? 'Изменения сохранятся в журнале активности и в личных делах участников.'
        : 'Запись попадает в журнал активности и в личные дела участников.'}</p>
      <div class="grid grid-2">
        <div class="field"><label>Категория деятельности</label>
          <div class="type-select-row">
            <select id="act-type">${types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select>
            ${canEdit ? '<button class="btn-sm" type="button" id="act-type-add" title="Создать категорию">+</button>' : ''}
          </div>
          ${canEdit ? `
          <div class="type-inline-add" id="act-type-form" hidden>
            <input id="act-type-new" placeholder="Название новой категории">
            <button class="btn-sm btn-primary" type="button" id="act-type-save">Создать</button>
            <button class="btn-sm" type="button" id="act-type-cancel">Отмена</button>
          </div>` : ''}
        </div>
        <div class="field"><label>Дата</label><input type="date" id="act-date" value="${editing ? isoDate(editing.activity_date) : localToday()}"></div>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>Проводящий / Командир</label>
          <select id="act-conductor">
            <option value="">— не указан —</option>
            ${personnel.map(p => `<option value="${p.id}" ${conductorDefault === String(p.id) ? 'selected' : ''}>${escapeHtml(p.callsign)} (${escapeHtml(p.idn)})</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Название</label><input id="act-title" value="${escapeHtml(editing?.title || '')}" placeholder="Например: Патруль сектора 7"></div>
      </div>
      <div class="field"><label>Кто участвовал</label>
        <div class="participants-box" id="act-participants">
          ${personnel.map(p => `
            <label class="participant-check">
              <input type="checkbox" value="${p.id}" ${preselect.has(String(p.id)) ? 'checked' : ''}>
              <span>${escapeHtml(p.callsign)} <span class="hint">(${escapeHtml(p.idn)})</span></span>
            </label>`).join('') || '<div class="hint">В составе пока никого нет</div>'}
        </div>
        <div class="hint">Можно отметить несколько человек.</div>
      </div>
      <div class="field"><label>Фотографии</label>
        <input type="file" id="act-files" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="padding:6px">
        <div class="activity-images" id="act-previews" style="margin-top:8px"></div>
        <div class="hint">PNG/JPEG/WebP/GIF, до 4 МБ на файл. Крестик убирает фото из записи.</div>
      </div>
      <div class="field"><label>Заметки</label><textarea id="act-notes" rows="3">${escapeHtml(editing?.notes || '')}</textarea></div>
      <div class="error-msg" id="act-error" style="display:none"></div>
      <div class="modal-actions">
        <button type="button" onclick="closeModal()">Отмена</button>
        <button class="btn-primary" type="button" id="act-save">Сохранить</button>
      </div>
    `, { wide: true });

    if (editing && editing.type_id) {
      document.getElementById('act-type').value = String(editing.type_id);
    }

    function showError(msg) {
      const err = document.getElementById('act-error');
      err.textContent = msg;
      err.style.display = 'block';
    }

    function renderPreviews() {
      const el = document.getElementById('act-previews');
      el.innerHTML =
        existingImages.map(im => `
          <span class="img-preview-wrap">
            <img class="img-thumb" src="${escapeHtml(im.path)}" alt="Превью">
            <button class="btn-sm btn-danger img-remove" type="button" data-imgid="${im.id}" title="Убрать фото из записи">✕</button>
          </span>`).join('') +
        images.map((im, i) => `
          <span class="img-preview-wrap">
            <img class="img-thumb" src="${im.data}" alt="Превью">
            <button class="btn-sm btn-danger img-remove" type="button" data-idx="${i}">✕</button>
          </span>`).join('');
      el.querySelectorAll('.img-remove[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          images.splice(Number(btn.dataset.idx), 1);
          renderPreviews();
        });
      });
      el.querySelectorAll('.img-remove[data-imgid]').forEach(btn => {
        btn.addEventListener('click', () => {
          const imgId = Number(btn.dataset.imgid);
          const idx = existingImages.findIndex(x => x.id === imgId);
          if (idx > -1) {
            removedImageIds.push(imgId);
            existingImages.splice(idx, 1);
          }
          renderPreviews();
        });
      });
    }
    renderPreviews();

    document.getElementById('act-files').addEventListener('change', (e) => {
      const files = [...e.target.files].slice(0, 8);
      files.forEach(file => {
        if (file.size > 4 * 1024 * 1024) { showError(`Файл «${file.name}» больше 4 МБ`); return; }
        const reader = new FileReader();
        reader.onload = () => { images.push({ data: reader.result }); renderPreviews(); };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });

    const typeForm = document.getElementById('act-type-form');
    document.getElementById('act-type-add')?.addEventListener('click', () => {
      typeForm.hidden = !typeForm.hidden;
      if (!typeForm.hidden) document.getElementById('act-type-new').focus();
    });
    document.getElementById('act-type-cancel')?.addEventListener('click', () => {
      typeForm.hidden = true;
      document.getElementById('act-type-new').value = '';
    });
    document.getElementById('act-type-save')?.addEventListener('click', async () => {
      const name = document.getElementById('act-type-new').value.trim();
      if (!name) return;
      try {
        const created = await api('/activity-types', { method: 'POST', body: { name, sort_order: types.length + 1 } });
        types.push(created);
        await loadActivityTypes(true);
        const sel = document.getElementById('act-type');
        sel.insertAdjacentHTML('beforeend', `<option value="${created.id}">${escapeHtml(created.name)}</option>`);
        sel.value = String(created.id);
        typeForm.hidden = true;
        document.getElementById('act-type-new').value = '';
      } catch (e) { showError(e.message); }
    });

    document.getElementById('act-save').addEventListener('click', async () => {
      const saveBtn = document.getElementById('act-save');
      saveBtn.disabled = true;
      try {
        const body = {
          type_id: document.getElementById('act-type').value || null,
          title: document.getElementById('act-title').value,
          activity_date: document.getElementById('act-date').value,
          conductor_id: document.getElementById('act-conductor').value || null,
          notes: document.getElementById('act-notes').value,
          participant_ids: [...document.querySelectorAll('#act-participants input:checked')].map(i => Number(i.value)),
        };
        let target = editing;
        if (editing) {
          await api(`/activities/${editing.id}`, { method: 'PUT', body });
          for (const imgId of removedImageIds) {
            await api(`/activities/${editing.id}/images/${imgId}`, { method: 'DELETE' });
          }
        } else {
          target = await api('/activities', { method: 'POST', body });
        }
        for (const im of images) {
          await api(`/activities/${target.id}/images`, { method: 'POST', body: { data: im.data } });
        }
        closeModal();
        onSaved();
      } catch (e) {
        saveBtn.disabled = false;
        showError(e.message);
      }
    });
  })();
}

// ---------- Пагинация и карточки активности ----------
function pagerHtml(page, pages) {
  if (pages <= 1) return '';
  return `
    <div class="pager">
      <button class="btn-sm" type="button" data-pager="prev" ${page <= 1 ? 'disabled' : ''}>← Назад</button>
      <span class="pager-info">Страница ${page} из ${pages}</span>
      <button class="btn-sm" type="button" data-pager="next" ${page >= pages ? 'disabled' : ''}>Вперёд →</button>
    </div>`;
}

function bindPager(root, state, onChange) {
  root.querySelectorAll('[data-pager]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.pager === 'prev') state.page = Math.max(1, state.page - 1);
      else state.page = Math.min(state.pages, state.page + 1);
      onChange();
    });
  });
}

function activityCardHtml(a, opts = {}) {
  return `
    <div class="activity-card">
      <div class="activity-card-head">
        <span class="badge">${escapeHtml(typeLabel(a.type_id))}</span>
        <span class="activity-date">${fmtDate(a.activity_date)}</span>
      </div>
      <div class="activity-title">${escapeHtml(a.title)}</div>
      ${a.notes ? `<div class="activity-notes">${escapeHtml(a.notes)}</div>` : ''}
      ${(a.participants || []).length ? `
        <div class="activity-participants">
          ${a.participants.map(p => `<span class="role-pill" title="IDN ${escapeHtml(p.idn)}">${escapeHtml(p.callsign)}</span>`).join('')}
        </div>` : ''}
      ${(a.images || []).length ? `
        <div class="activity-images">
          ${a.images.map(im => `<img class="img-thumb" src="${escapeHtml(im.path)}" data-img="${escapeHtml(im.path)}" alt="Фото к записи «${escapeHtml(a.title)}»">`).join('')}
        </div>` : ''}
      <div class="activity-card-foot">
        <span class="hint">${a.conductor_name
          ? `Проводящий: ${escapeHtml(a.conductor_name)}`
          : `Автор: ${escapeHtml(a.conducted_by_name || '—')}`}</span>
        ${(opts.canEdit || opts.canDelete) ? `<span style="display:flex;gap:6px">
          ${opts.canEdit ? `<button class="btn-sm" type="button" data-edit-activity="${a.id}">Изменить</button>` : ''}
          ${opts.canDelete ? `<button class="btn-sm btn-danger" type="button" data-del-activity="${a.id}">Удалить</button>` : ''}
        </span>` : ''}
      </div>
    </div>`;
}

function bindActivityEdit(root, findActivity, onEdited) {
  root.querySelectorAll('[data-edit-activity]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = findActivity(Number(btn.dataset.editActivity));
      if (a) openActivityModal({ activity: a, onSaved: onEdited });
    });
  });
}

function bindActivityDelete(root, onDeleted) {
  root.querySelectorAll('[data-del-activity]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить запись активности вместе с фото?')) return;
      await api(`/activities/${btn.dataset.delActivity}`, { method: 'DELETE' });
      onDeleted();
    });
  });
}

// Просмотр фото в крупном размере
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-img]');
  if (!img) return;
  openModal(`
    <div style="text-align:center">
      <img src="${escapeHtml(img.dataset.img)}" alt="Фото активности" style="max-width:100%;max-height:74vh;border-radius:8px">
      <div class="modal-actions"><button type="button" onclick="closeModal()">Закрыть</button></div>
    </div>`, { wide: true });
});
