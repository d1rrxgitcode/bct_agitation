(async function () {
  const user = await requireSession();
  if (!user) return;
  if (!CAN_ADMIN.includes(user.role)) {
    document.body.innerHTML = '<div style="padding:40px">Доступ запрещён.</div>';
    return;
  }
  renderShell('admin');

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="topbar">
      <div><h1>Админ-панель</h1><div class="sub">Пользователи и привилегии доступа (модерация). Военная должность задаётся в личном деле.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="log-activity-btn">Записать активность</button>
        <button class="btn-primary" id="add-user-btn">+ Создать пользователя</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Логин</th><th>Привилегия</th><th>Привязка к личному делу</th><th>Статус</th><th>Создан</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  `;

  let personnelList = [];

  async function loadPersonnel() {
    personnelList = await api('/personnel');
  }

  async function loadUsers() {
    const users = await api('/admin/users');
    document.getElementById('rows').innerHTML = users.map(u => `
      <tr>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="role-pill">${ROLE_LABELS[u.role]}</span></td>
        <td>${escapeHtml(u.personnel_callsign || '—')}</td>
        <td>${u.is_active ? 'Активен' : 'Заблокирован'}</td>
        <td>${new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
        <td style="display:flex;gap:6px">
          <button class="btn-sm" onclick="editUser(${u.id})">Изм.</button>
          <button class="btn-sm btn-danger" onclick="deleteUser(${u.id})" ${u.id === user.id ? 'disabled' : ''}>Удал.</button>
        </td>
      </tr>
    `).join('');
  }

  function userFormHtml(u = {}) {
    return `
      <div class="field"><label>Логин</label><input id="u-username" value="${escapeHtml(u.username || '')}" ${u.id ? 'disabled' : ''}></div>
      <div class="field"><label>${u.id ? 'Новый пароль (оставьте пустым, чтобы не менять)' : 'Пароль'}</label><input type="password" id="u-password"></div>
      <div class="field"><label>Привилегия (доступ, не должность)</label>
        <select id="u-role">
          <option value="commander" ${u.role==='commander'?'selected':''}>Командир — полный доступ</option>
          <option value="deputy" ${u.role==='deputy'?'selected':''}>Заместитель командира — полный доступ</option>
          <option value="moderator" ${u.role==='moderator'?'selected':''}>Модератор — правка состава и документов</option>
          <option value="member" ${(!u.role || u.role==='member')?'selected':''}>Военнослужащий — просмотр и своя активность</option>
        </select>
        <div class="hint">Военную должность (командир 91, зам. и т.д.) назначайте в личном деле, не здесь.</div>
      </div>
      <div class="field"><label>Привязать к личному делу (необязательно)</label>
        <select id="u-personnel">
          <option value="">— не привязан —</option>
          ${personnelList.map(p => `<option value="${p.id}" ${u.personnel_id===p.id?'selected':''}>${escapeHtml(p.callsign)} (${p.idn})</option>`).join('')}
        </select>
      </div>
      ${u.id ? `<div class="field"><label><input type="checkbox" id="u-active" style="width:auto" ${u.is_active?'checked':''}> Активен</label></div>` : ''}
      <div class="error-msg" id="u-error" style="display:none"></div>
    `;
  }

  document.getElementById('add-user-btn').addEventListener('click', async () => {
    await loadPersonnel();
    openModal(`<h2>Новый пользователь</h2>${userFormHtml()}
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="u-save">Создать</button></div>`);
    document.getElementById('u-save').addEventListener('click', () => saveUser(null));
  });

  window.editUser = async function (id) {
    await loadPersonnel();
    const users = await api('/admin/users');
    const u = users.find(x => x.id === id);
    openModal(`<h2>Пользователь: ${escapeHtml(u.username)}</h2>${userFormHtml(u)}
      <div class="modal-actions"><button onclick="closeModal()">Отмена</button><button class="btn-primary" id="u-save">Сохранить</button></div>`);
    document.getElementById('u-save').addEventListener('click', () => saveUser(id));
  };

  async function saveUser(id) {
    try {
      const password = document.getElementById('u-password').value;
      const body = {
        role: document.getElementById('u-role').value,
        personnel_id: document.getElementById('u-personnel').value || null,
      };
      if (password) body.password = password;
      if (id) {
        const activeEl = document.getElementById('u-active');
        if (activeEl) body.is_active = activeEl.checked;
        await api(`/admin/users/${id}`, { method: 'PUT', body });
      } else {
        body.username = document.getElementById('u-username').value.trim();
        await api('/admin/users', { method: 'POST', body });
      }
      closeModal(); loadUsers();
    } catch (e) {
      const err = document.getElementById('u-error'); err.textContent = e.message; err.style.display = 'block';
    }
  }

  window.deleteUser = async function (id) {
    if (!confirm('Удалить пользователя?')) return;
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    loadUsers();
  };

  document.getElementById('log-activity-btn')?.addEventListener('click', () => openActivityModal());

  loadUsers();
})();
