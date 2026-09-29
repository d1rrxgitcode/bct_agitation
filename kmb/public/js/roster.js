(async function () {
  const user = await requireSession();
  if (!user) return;
  renderShell('roster');
  const canEdit = CAN_EDIT_ROSTER.includes(user.role);

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="topbar">
      <div>
        <h1>Таблица состава</h1>
        <div class="sub">${escapeHtml(FORMATION_NAME)}</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        ${canEdit ? `
          <button id="manage-lists-btn">Звания / должности / подразделения</button>
          <button class="btn-primary" id="add-person-btn">+ Добавить бойца</button>
        ` : ''}
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="text" id="q" placeholder="Поиск: позывной / IDN / discord">
        <select id="f-unit"><option value="">Все подразделения</option></select>
        <select id="f-position"><option value="">Все должности</option></select>
        <select id="f-mercenary">
          <option value="">Наёмник: все</option>
          <option value="true">Только наёмники</option>
          <option value="false">Без наёмников</option>
        </select>
        <button id="reset-filters-btn">Сбросить</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" data-sort="idn">IDN</th>
              <th>Позывной</th>
              <th class="sortable" data-sort="rank">Звание</th>
              <th class="sortable" data-sort="position">Должность</th>
              <th>Steam ID</th>
              <th>Discord</th>
              <th class="sortable" data-sort="activity">Активность</th>
              <th class="sortable" data-sort="unit">Подразделение</th>
              <th class="sortable" data-sort="mercenary">Наёмник</th>
              ${canEdit ? '<th></th>' : ''}
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  `;

  let ranks = [], positions = [], units = [];
  let sort = 'idn', dir = 'asc';

  async function loadLookups() {
    [ranks, positions, units] = await Promise.all([api('/ranks'), api('/positions'), api('/units')]);
    const unitSel = document.getElementById('f-unit');
    units.forEach(u => unitSel.insertAdjacentHTML('beforeend', `<option value="${u.id}">${escapeHtml(u.name)}</option>`));
    const posSel = document.getElementById('f-position');
    positions.forEach(p => posSel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${escapeHtml(p.name)}</option>`));
  }

  function currentFilters() {
    const params = new URLSearchParams();
    params.set('sort', sort); params.set('dir', dir);
    const q = document.getElementById('q').value.trim();
    const unit_id = document.getElementById('f-unit').value;
    const position_id = document.getElementById('f-position').value;
    const mercenary = document.getElementById('f-mercenary').value;
    if (q) params.set('q', q);
    if (unit_id) params.set('unit_id', unit_id);
    if (position_id) params.set('position_id', position_id);
    if (mercenary) params.set('mercenary', mercenary);
    return params.toString();
  }

  async function loadRows() {
    const rows = await api(`/personnel?${currentFilters()}`);
    document.getElementById('rows').innerHTML = rows.map(p => `
      <tr>
        <td><a href="/profile.html?id=${p.id}">${escapeHtml(p.idn)}</a></td>
        <td><a href="/profile.html?id=${p.id}">${escapeHtml(p.callsign)}</a></td>
        <td>${escapeHtml(p.rank_name || '—')}</td>
        <td>${escapeHtml(p.position_name || '—')}</td>
        <td>${escapeHtml(p.steam_id || '—')}</td>
        <td>${escapeHtml(p.discord || '—')}</td>
        <td>${escapeHtml(p.activity || '—')}</td>
        <td>${escapeHtml(p.unit_name || '—')}</td>
        <td><span class="badge ${p.mercenary ? 'yes' : ''}">${p.mercenary ? 'Да' : 'Нет'}</span></td>
        ${canEdit ? `<td style="display:flex;gap:6px">
            <button class="btn-sm" onclick="editPerson(${p.id})">Изм.</button>
            <button class="btn-sm btn-danger" onclick="deletePerson(${p.id})">Удал.</button>
          </td>` : ''}
      </tr>
    `).join('') || `<tr><td colspan="10" style="color:var(--text-muted)">Никого не найдено</td></tr>`;
  }

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sort === key) dir = dir === 'asc' ? 'desc' : 'asc'; else { sort = key; dir = 'asc'; }
      document.querySelectorAll('th.sortable .arrow').forEach(a => a.remove());
      th.insertAdjacentHTML('beforeend', `<span class="arrow">${dir === 'asc' ? '▲' : '▼'}</span>`);
      loadRows();
    });
  });

  ['q'].forEach(id => document.getElementById(id).addEventListener('input', debounce(loadRows, 300)));
  ['f-unit', 'f-position', 'f-mercenary'].forEach(id => document.getElementById(id).addEventListener('change', loadRows));
  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('f-unit').value = '';
    document.getElementById('f-position').value = '';
    document.getElementById('f-mercenary').value = '';
    loadRows();
  });

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ---------- Добавление / редактирование бойца ----------
  function personFormHtml(p = {}) {
    return `
      <div class="grid grid-2">
        <div class="field"><label>IDN (4 цифры)</label><input id="m-idn" value="${p.idn || ''}" maxlength="4"></div>
        <div class="field"><label>Позывной</label><input id="m-callsign" value="${escapeHtml(p.callsign || '')}"></div>
        <div class="field"><label>Звание</label>
          <select id="m-rank"><option value="">—</option>${ranks.map(r => `<option value="${r.id}" ${p.rank_id===r.id?'selected':''}>${r.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Военная должность</label>
          <select id="m-position"><option value="">—</option>${positions.map(x => `<option value="${x.id}" ${p.position_id===x.id?'selected':''}>${x.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Подразделение</label>
          <select id="m-unit"><option value="">— нет —</option>${units.map(u => `<option value="${u.id}" ${p.unit_id===u.id?'selected':''}>${u.name}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Активность (метки состава)</label><input id="m-activity" value="${escapeHtml(p.activity || '')}"></div>
        <div class="field"><label>Steam ID</label><input id="m-steam" value="${escapeHtml(p.steam_id || '')}"></div>
        <div class="field"><label>Discord</label><input id="m-discord" value="${escapeHtml(p.discord || '')}"></div>
      </div>
      <div class="field">
        <label><input type="checkbox" id="m-mercenary" style="width:auto" ${p.mercenary ? 'checked' : ''}> Наёмная единица</label>
      </div>
      <div class="error-msg" id="m-error" style="display:none"></div>
    `;
  }

  document.getElementById('add-person-btn')?.addEventListener('click', () => {
    openModal(`<h2>Новый боец</h2>${personFormHtml()}
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="m-save">Создать</button></div>`);
    document.getElementById('m-save').addEventListener('click', () => savePerson(null));
  });

  window.editPerson = async function (id) {
    const p = await api(`/personnel/${id}`);
    openModal(`<h2>Редактирование: ${escapeHtml(p.callsign)}</h2>${personFormHtml(p)}
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="m-save">Сохранить</button></div>`);
    document.getElementById('m-save').addEventListener('click', () => savePerson(id));
  };

  async function savePerson(id) {
    const body = {
      idn: document.getElementById('m-idn').value.trim(),
      callsign: document.getElementById('m-callsign').value.trim(),
      rank_id: document.getElementById('m-rank').value || null,
      position_id: document.getElementById('m-position').value || null,
      unit_id: document.getElementById('m-unit').value || null,
      activity: document.getElementById('m-activity').value,
      steam_id: document.getElementById('m-steam').value,
      discord: document.getElementById('m-discord').value,
      mercenary: document.getElementById('m-mercenary').checked,
    };
    try {
      if (id) await api(`/personnel/${id}`, { method: 'PUT', body });
      else await api('/personnel', { method: 'POST', body });
      closeModal(); loadRows();
    } catch (e) {
      const err = document.getElementById('m-error'); err.textContent = e.message; err.style.display = 'block';
    }
  }

  window.deletePerson = async function (id) {
    if (!confirm('Удалить личное дело безвозвратно?')) return;
    await api(`/personnel/${id}`, { method: 'DELETE' });
    loadRows();
  };

  // ---------- Управление списками (звания / должности / подразделения) ----------
  document.getElementById('manage-lists-btn')?.addEventListener('click', () => openListsModal());

  function listsModalHtml() {
    return `
      <h2>Справочники</h2>
      <p class="hint" style="margin-top:0">Должность — военная. Подразделения — внутренние структуры корпуса (91-й корпус — формирование, его сюда не добавляйте). Привилегии модерации задаются в админ-панели.</p>
      <div class="grid grid-4">
        <div>
          <div class="section-title" style="font-weight:600;margin-bottom:8px">Звания</div>
          <div id="ranks-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="new-rank" placeholder="Новое звание">
            <button class="btn-sm" id="add-rank">+</button>
          </div>
        </div>
        <div>
          <div class="section-title" style="font-weight:600;margin-bottom:8px">Должности</div>
          <div id="positions-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="new-position" placeholder="Новая должность">
            <button class="btn-sm" id="add-position">+</button>
          </div>
        </div>
        <div>
          <div class="section-title" style="font-weight:600;margin-bottom:8px">Подразделения</div>
          <div id="units-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="new-unit" placeholder="Новое подразделение">
            <button class="btn-sm" id="add-unit">+</button>
          </div>
        </div>
        <div>
          <div class="section-title" style="font-weight:600;margin-bottom:8px">Категории деятельности</div>
          <div id="types-list"></div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <input id="new-type" placeholder="Новая категория">
            <button class="btn-sm" id="add-type">+</button>
          </div>
        </div>
      </div>
      <div class="modal-actions"><button onclick="closeModal()">Закрыть</button></div>
    `;
  }

  function renderEditableList(containerId, items, table) {
    const el = document.getElementById(containerId);
    el.innerHTML = items.map(i => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input value="${escapeHtml(i.name)}" data-id="${i.id}" data-table="${table}" class="rename-input" style="flex:1">
        <button class="btn-sm rename-btn" data-id="${i.id}" data-table="${table}">✓</button>
        <button class="btn-sm btn-danger del-btn" data-id="${i.id}" data-table="${table}">✕</button>
      </div>
    `).join('') || `<div class="hint">Список пуст</div>`;

    el.querySelectorAll('.rename-btn').forEach(btn => btn.addEventListener('click', async () => {
      const input = el.querySelector(`.rename-input[data-id="${btn.dataset.id}"]`);
      await api(`/${btn.dataset.table}/${btn.dataset.id}`, { method: 'PUT', body: { name: input.value.trim() } });
      await refreshLists();
    }));
    el.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Удалить значение из списка?')) return;
      await api(`/${btn.dataset.table}/${btn.dataset.id}`, { method: 'DELETE' });
      await refreshLists();
    }));
  }

  async function refreshLists() {
    [ranks, positions, units] = await Promise.all([api('/ranks'), api('/positions'), api('/units')]);
    const types = await loadActivityTypes(true);
    renderEditableList('ranks-list', ranks, 'ranks');
    renderEditableList('positions-list', positions, 'positions');
    renderEditableList('units-list', units, 'units');
    renderEditableList('types-list', types, 'activity-types');
    const unitSel = document.getElementById('f-unit');
    const cur = unitSel.value;
    unitSel.innerHTML = '<option value="">Все подразделения</option>';
    units.forEach(u => unitSel.insertAdjacentHTML('beforeend', `<option value="${u.id}">${escapeHtml(u.name)}</option>`));
    unitSel.value = cur;
    const posSel = document.getElementById('f-position');
    const curP = posSel.value;
    posSel.innerHTML = '<option value="">Все должности</option>';
    positions.forEach(p => posSel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${escapeHtml(p.name)}</option>`));
    posSel.value = curP;
    await loadRows();
  }

  async function openListsModal() {
    openModal(listsModalHtml(), { wide: true });
    renderEditableList('ranks-list', ranks, 'ranks');
    renderEditableList('positions-list', positions, 'positions');
    renderEditableList('units-list', units, 'units');
    renderEditableList('types-list', await loadActivityTypes(), 'activity-types');
    document.getElementById('add-rank').addEventListener('click', async () => {
      const v = document.getElementById('new-rank').value.trim();
      if (!v) return;
      await api('/ranks', { method: 'POST', body: { name: v, sort_order: ranks.length + 1 } });
      document.getElementById('new-rank').value = '';
      await refreshLists();
    });
    document.getElementById('add-position').addEventListener('click', async () => {
      const v = document.getElementById('new-position').value.trim();
      if (!v) return;
      await api('/positions', { method: 'POST', body: { name: v, sort_order: positions.length + 1 } });
      document.getElementById('new-position').value = '';
      await refreshLists();
    });
    document.getElementById('add-unit').addEventListener('click', async () => {
      const v = document.getElementById('new-unit').value.trim();
      if (!v) return;
      await api('/units', { method: 'POST', body: { name: v, sort_order: units.length + 1 } });
      document.getElementById('new-unit').value = '';
      await refreshLists();
    });
    document.getElementById('add-type').addEventListener('click', async () => {
      const v = document.getElementById('new-type').value.trim();
      if (!v) return;
      const types = await loadActivityTypes();
      await api('/activity-types', { method: 'POST', body: { name: v, sort_order: types.length + 1 } });
      document.getElementById('new-type').value = '';
      await refreshLists();
    });
  }

  await loadLookups();
  await loadRows();
})();
