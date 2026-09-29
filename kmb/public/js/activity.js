(async function () {
  const user = await requireSession();
  if (!user) return;
  renderShell('activity');
  const canEdit = CAN_EDIT_ROSTER.includes(user.role);

  const main = document.getElementById('main-content');
  const params = new URLSearchParams(window.location.search);
  const state = {
    page: 1,
    pages: 1,
    items: [],
    total: 0,
    type_id: params.get('type_id') || '',
    personnel_id: params.get('personnel_id') || '',
    from: '',
    to: '',
  };
  const PER_PAGE = 6;

  let personnel = [];

  main.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Активность</h1>
        <div class="sub">Журнал деятельности ${escapeHtml(FORMATION_NAME)}: категории, участники и фотографии</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${canEdit ? '<button id="manage-types-btn">Категории деятельности</button>' : ''}
        <button class="btn-primary" id="add-activity-btn">+ Записать активность</button>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <select id="f-type"><option value="">Все категории</option></select>
        <select id="f-person"><option value="">Все участники</option></select>
        <input type="date" id="f-from" title="Дата с">
        <input type="date" id="f-to" title="Дата по">
        <button id="reset-filters-btn">Сбросить</button>
      </div>
      <div class="activity-grid" id="cards"></div>
      <div id="pager"></div>
    </div>
  `;

  async function loadFilters() {
    const [types, people] = await Promise.all([loadActivityTypes(true), api('/personnel')]);
    personnel = people;
    const typeSel = document.getElementById('f-type');
    typeSel.innerHTML = '<option value="">Все категории</option>' +
      types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    typeSel.value = state.type_id;
    const personSel = document.getElementById('f-person');
    personSel.innerHTML = '<option value="">Все участники</option>' +
      people.map(p => `<option value="${p.id}">${escapeHtml(p.callsign)} (${escapeHtml(p.idn)})</option>`).join('');
    personSel.value = state.personnel_id;
  }

  async function loadRows() {
    const q = new URLSearchParams();
    q.set('page', state.page);
    q.set('limit', PER_PAGE);
    if (state.type_id) q.set('type_id', state.type_id);
    if (state.personnel_id) q.set('personnel_id', state.personnel_id);
    if (state.from) q.set('from', state.from);
    if (state.to) q.set('to', state.to);
    const res = await api(`/activities?${q.toString()}`);
    state.page = res.page; state.pages = res.pages; state.items = res.items; state.total = res.total;
    renderRows();
  }

  function renderRows() {
    const canManage = (a) => canEdit || String(a.conducted_by) === String(user.id);
    document.getElementById('cards').innerHTML = state.items.map(a => activityCardHtml(a, {
      canEdit: canManage(a),
      canDelete: canManage(a),
    })).join('') || `<div class="hint">Записей нет — нажмите «+ Записать активность»</div>`;
    const pagerEl = document.getElementById('pager');
    pagerEl.innerHTML = `<div class="hint" style="margin-bottom:6px">Всего записей: ${state.total}</div>` + pagerHtml(state.page, state.pages);
    bindPager(pagerEl, state, loadRows);
    bindActivityDelete(main, loadRows);
    bindActivityEdit(main, (id) => state.items.find(x => x.id === id), loadRows);
  }

  document.getElementById('f-type').addEventListener('change', (e) => { state.type_id = e.target.value; state.page = 1; loadRows(); });
  document.getElementById('f-person').addEventListener('change', (e) => { state.personnel_id = e.target.value; state.page = 1; loadRows(); });
  document.getElementById('f-from').addEventListener('change', (e) => { state.from = e.target.value; state.page = 1; loadRows(); });
  document.getElementById('f-to').addEventListener('change', (e) => { state.to = e.target.value; state.page = 1; loadRows(); });
  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    state.type_id = ''; state.personnel_id = ''; state.from = ''; state.to = ''; state.page = 1;
    document.getElementById('f-type').value = '';
    document.getElementById('f-person').value = '';
    document.getElementById('f-from').value = '';
    document.getElementById('f-to').value = '';
    loadRows();
  });

  document.getElementById('add-activity-btn').addEventListener('click', () => {
    openActivityModal({ onSaved: () => { state.page = 1; loadRows(); loadFilters(); } });
  });

  // ---------- Категории деятельности ----------
  document.getElementById('manage-types-btn')?.addEventListener('click', openTypesModal);

  async function openTypesModal() {
    const types = await loadActivityTypes(true);
    openModal(`
      <h2>Категории деятельности</h2>
      <p class="hint" style="margin-top:0">Гибкий список типов активности. Цвет точки совпадает с цветом категории на графиках дашборда.</p>
      <div class="types-list" id="types-list"></div>
      <div class="types-add">
        <input id="new-type" placeholder="Новая категория, например: Патруль">
        <button class="btn-sm btn-primary" id="add-type">Добавить</button>
      </div>
      <div class="error-msg" id="types-error" style="display:none"></div>
      <div class="modal-actions"><button onclick="closeModal()">Закрыть</button></div>
    `);
    renderTypes(types);
    document.getElementById('add-type').addEventListener('click', async () => {
      const v = document.getElementById('new-type').value.trim();
      if (!v) return;
      try {
        await api('/activity-types', { method: 'POST', body: { name: v, sort_order: types.length + 1 } });
        await openTypesModal();
        loadFilters();
      } catch (e) { showTypesError(e.message); }
    });
  }

  function showTypesError(msg) {
    const el = document.getElementById('types-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function renderTypes(types) {
    const el = document.getElementById('types-list');
    el.innerHTML = types.map((t, i) => `
      <div class="type-row">
        <span class="type-dot" style="background:${typeColor(i)}"></span>
        <input value="${escapeHtml(t.name)}" data-id="${t.id}" class="rename-input" aria-label="Название категории">
        <span class="type-actions">
          <button class="btn-sm rename-btn" data-id="${t.id}" title="Сохранить название">✓</button>
          <button class="btn-sm btn-danger del-btn" data-id="${t.id}" title="Удалить категорию">✕</button>
        </span>
      </div>
    `).join('') || '<div class="hint">Список пуст — добавьте первую категорию ниже.</div>';

    el.querySelectorAll('.rename-btn').forEach(btn => btn.addEventListener('click', async () => {
      const input = el.querySelector(`.rename-input[data-id="${btn.dataset.id}"]`);
      const name = input.value.trim();
      if (!name) return;
      try {
        await api(`/activity-types/${btn.dataset.id}`, { method: 'PUT', body: { name } });
        await loadActivityTypes(true);
        await openTypesModal();
        loadFilters();
      } catch (e) { showTypesError(e.message); }
    }));
    el.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Удалить категорию? Записи останутся без категории.')) return;
      try {
        await api(`/activity-types/${btn.dataset.id}`, { method: 'DELETE' });
        await loadActivityTypes(true);
        await openTypesModal();
        loadFilters();
      } catch (e) { showTypesError(e.message); }
    }));
  }

  await loadFilters();
  await loadRows();
})();
