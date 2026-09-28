(async function () {
  const user = await requireSession();
  if (!user) return;
  renderShell('docs');
  const canEdit = CAN_EDIT_ROSTER.includes(user.role);

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="topbar">
      <div><h1>Документация</h1><div class="sub">Категории и материалы формирования</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="log-activity-btn">Записать активность</button>
        ${canEdit ? '<button class="btn-primary" id="add-cat-btn">+ Новая категория</button>' : ''}
      </div>
    </div>
    <div class="grid" style="grid-template-columns: 260px 1fr; align-items: start">
      <div class="card">
        <div class="category-tree" id="cat-tree"></div>
      </div>
      <div class="card" id="cat-content">
        <div class="hint">Выберите категорию слева</div>
      </div>
    </div>
  `;

  const VIS_LABELS = { all: 'Всем', command_mod: 'Командование+мод.', unit: 'Подразделение', custom: 'Особые роли' };
  let categories = [], units = [], activeCatId = null;

  async function loadCategories() {
    [categories, units] = await Promise.all([api('/docs/categories'), api('/units')]);
    renderTree();
  }

  function renderTree() {
    const tree = document.getElementById('cat-tree');
    if (!categories.length) { tree.innerHTML = '<div class="hint">Категорий пока нет</div>'; return; }
    tree.innerHTML = categories.map(c => `
      <div class="cat-item ${c.id === activeCatId ? 'active' : ''}" data-id="${c.id}">
        <span>${escapeHtml(c.name)}</span>
        <span class="vis-badge">${VIS_LABELS[c.visibility] || ''}</span>
      </div>
    `).join('');
    tree.querySelectorAll('.cat-item').forEach(el => el.addEventListener('click', () => {
      activeCatId = Number(el.dataset.id);
      renderTree(); openCategory(activeCatId);
    }));
  }

  async function openCategory(catId) {
    const cat = categories.find(c => c.id === catId);
    const content = document.getElementById('cat-content');
    let docsList = [];
    try {
      docsList = await api(`/docs/categories/${catId}/documents`);
    } catch (e) {
      content.innerHTML = `<div class="error-msg">${e.message}</div>`;
      return;
    }
    content.innerHTML = `
      <div class="topbar" style="margin-bottom:14px">
        <div><strong>${escapeHtml(cat.name)}</strong></div>
        <div style="display:flex;gap:8px">
          ${canEdit ? `<button class="btn-sm" id="edit-cat-btn">Настройки категории</button>` : ''}
          ${canEdit ? `<button class="btn-sm btn-danger" id="del-cat-btn">Удалить категорию</button>` : ''}
          ${canEdit ? `<button class="btn-primary btn-sm" id="add-doc-btn">+ Документ</button>` : ''}
        </div>
      </div>
      <div id="doc-list">${docsList.map(d => `
        <div class="doc-list-item" data-id="${d.id}">
          <div>${escapeHtml(d.title)}</div>
          <div class="meta">Обновлено: ${new Date(d.updated_at).toLocaleString('ru-RU')}</div>
        </div>
      `).join('') || '<div class="hint">В этой категории пока нет документов</div>'}</div>
    `;
    content.querySelectorAll('.doc-list-item').forEach(el => el.addEventListener('click', () => openDoc(Number(el.dataset.id))));
    if (canEdit) {
      document.getElementById('edit-cat-btn').addEventListener('click', () => openCatModal(cat));
      document.getElementById('del-cat-btn').addEventListener('click', async () => {
        if (!confirm('Удалить категорию вместе со всеми документами?')) return;
        await api(`/docs/categories/${cat.id}`, { method: 'DELETE' });
        activeCatId = null; await loadCategories();
        document.getElementById('cat-content').innerHTML = '<div class="hint">Выберите категорию слева</div>';
      });
      document.getElementById('add-doc-btn').addEventListener('click', () => openDocModal(cat.id));
    }
  }

  async function openDoc(docId) {
    const doc = await api(`/docs/documents/${docId}`);
    openModal(`
      <h2>${escapeHtml(doc.title)}</h2>
      <div class="doc-content">${escapeHtml(doc.content)}</div>
      <div class="modal-actions">
        ${canEdit ? `<button class="btn-danger" id="del-doc-btn">Удалить</button><button id="edit-doc-btn">Редактировать</button>` : ''}
        <button onclick="closeModal()">Закрыть</button>
      </div>
    `);
    if (canEdit) {
      document.getElementById('del-doc-btn').addEventListener('click', async () => {
        if (!confirm('Удалить документ?')) return;
        await api(`/docs/documents/${docId}`, { method: 'DELETE' });
        closeModal(); openCategory(activeCatId);
      });
      document.getElementById('edit-doc-btn').addEventListener('click', () => openDocModal(activeCatId, doc));
    }
  }

  function openDocModal(catId, doc = null) {
    openModal(`
      <h2>${doc ? 'Редактирование документа' : 'Новый документ'}</h2>
      <div class="field"><label>Заголовок</label><input id="d-title" value="${escapeHtml(doc?.title || '')}"></div>
      <div class="field"><label>Содержание</label><textarea id="d-content" rows="10">${escapeHtml(doc?.content || '')}</textarea></div>
      <div class="error-msg" id="d-error" style="display:none"></div>
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="d-save">Сохранить</button></div>
    `);
    document.getElementById('d-save').addEventListener('click', async () => {
      try {
        const body = { title: document.getElementById('d-title').value, content: document.getElementById('d-content').value };
        if (doc) await api(`/docs/documents/${doc.id}`, { method: 'PUT', body });
        else await api(`/docs/categories/${catId}/documents`, { method: 'POST', body });
        closeModal(); openCategory(catId);
      } catch (e) {
        const err = document.getElementById('d-error'); err.textContent = e.message; err.style.display = 'block';
      }
    });
  }

  function openCatModal(cat = null) {
    openModal(`
      <h2>${cat ? 'Настройки категории' : 'Новая категория'}</h2>
      <div class="field"><label>Название</label><input id="c-name" value="${escapeHtml(cat?.name || '')}"></div>
      <div class="field"><label>Видимость</label>
        <select id="c-vis">
          <option value="all" ${cat?.visibility==='all'?'selected':''}>Все пользователи</option>
          <option value="command_mod" ${cat?.visibility==='command_mod'?'selected':''}>Командный состав и модераторы</option>
          <option value="unit" ${cat?.visibility==='unit'?'selected':''}>Только конкретное подразделение</option>
          <option value="custom" ${cat?.visibility==='custom'?'selected':''}>Особые роли (выбрать вручную)</option>
        </select>
      </div>
      <div class="field" id="c-unit-field" style="display:${cat?.visibility==='unit'?'block':'none'}">
        <label>Подразделение</label>
        <select id="c-unit">${units.map(u => `<option value="${u.id}" ${cat?.visible_unit_id===u.id?'selected':''}>${u.name}</option>`).join('')}</select>
      </div>
      <div class="field" id="c-roles-field" style="display:${cat?.visibility==='custom'?'block':'none'}">
        <label>Роли, которым видна категория</label>
        ${['commander','deputy','moderator','member'].map(r => `
          <label style="display:block;font-size:13px;color:var(--text);margin:3px 0">
            <input type="checkbox" value="${r}" class="c-role-cb" style="width:auto" ${(cat?.visible_roles||[]).includes(r)?'checked':''}> ${ROLE_LABELS[r]}
          </label>`).join('')}
      </div>
      <div class="error-msg" id="c-error" style="display:none"></div>
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="c-save">Сохранить</button></div>
    `);
    document.getElementById('c-vis').addEventListener('change', (e) => {
      document.getElementById('c-unit-field').style.display = e.target.value === 'unit' ? 'block' : 'none';
      document.getElementById('c-roles-field').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    document.getElementById('c-save').addEventListener('click', async () => {
      try {
        const visibility = document.getElementById('c-vis').value;
        const body = {
          name: document.getElementById('c-name').value,
          visibility,
          visible_unit_id: visibility === 'unit' ? document.getElementById('c-unit').value : null,
          visible_roles: visibility === 'custom' ? [...document.querySelectorAll('.c-role-cb:checked')].map(cb => cb.value) : null,
        };
        if (cat) await api(`/docs/categories/${cat.id}`, { method: 'PUT', body });
        else await api('/docs/categories', { method: 'POST', body });
        closeModal(); await loadCategories();
        if (activeCatId) openCategory(activeCatId);
      } catch (e) {
        const err = document.getElementById('c-error'); err.textContent = e.message; err.style.display = 'block';
      }
    });
  }

  document.getElementById('log-activity-btn')?.addEventListener('click', () => openActivityModal());
  document.getElementById('add-cat-btn')?.addEventListener('click', () => openCatModal());

  await loadCategories();
})();
